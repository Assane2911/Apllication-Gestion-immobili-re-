import { is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { contracts, ownerPayouts, properties, rentRevisions } from "../db/schema";
import { authHeader, createContract, createInvoice, createManager, createOwner, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

afterEach(() => vi.restoreAllMocks());

const SIGNATURE = "data:image/png;base64," + "A".repeat(60_000);
const JOUR_MS = 24 * 3600 * 1000;

async function agence() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: new Date(Date.now() + 30 * JOUR_MS) });
  const owner = await createOwner(manager.id, { managementFeeRate: 0 });
  const property = await createProperty(manager.id, { ownerId: owner.id, currency: "EUR" });
  const tenant = await createTenant(manager.id);
  return { manager, owner, property, tenant, h: authHeader(tokenFor(manager)) };
}

/**
 * Relève les tables lues EN ENTIER : `db.select().from(table)` et ses jointures (une jointure sans liste de colonnes en ramène toutes
 * les colonnes), ou une table passée telle quelle dans la liste des colonnes (`db.select({ contrat: contracts })`).
 */
function surveillerLecturesEntieres() {
  const entieres: unknown[] = [];
  const origine = testDb.select.bind(testDb);
  vi.spyOn(testDb, "select").mockImplementation(((...args: unknown[]) => {
    const requete = origine(...(args as [])) as unknown as Record<string, (...a: unknown[]) => unknown>;
    const champs = args[0] as Record<string, unknown> | undefined;
    if (champs) {
      for (const valeur of Object.values(champs)) if (valeur && is(valeur as never, PgTable)) entieres.push(valeur);
    } else {
      const depuis = requete.from.bind(requete);
      requete.from = (table: unknown) => {
        entieres.push(table);
        const suite = depuis(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
        // Les jointures n'existent qu'après `from` ; une jointure sans liste de colonnes ramène toutes celles de sa table.
        for (const methode of ["innerJoin", "leftJoin"]) {
          const initiale = suite[methode]?.bind(suite);
          if (!initiale) continue;
          suite[methode] = (jointe: unknown, ...reste: unknown[]) => {
            entieres.push(jointe);
            return initiale(jointe, ...reste);
          };
        }
        return suite;
      };
    }
    return requete;
  }) as never);
  return entieres;
}

describe("Reversements — un montant qui s'arrondit à zéro n'est pas un reversement", () => {
  async function agenceAvecLoyerEncaisse() {
    const ctx = await agence();
    const contract = await createContract(ctx.property.id, ctx.tenant.id, { currency: "EUR" });
    await createInvoice(contract.id, { status: "PAID", amount: 100, amountPaid: 100, currency: "EUR", periodMonth: 1, periodYear: 2026, paidAt: new Date() });
    const maintenant = new Date();
    return { ...ctx, mois: maintenant.getMonth() + 1, annee: maintenant.getFullYear(), jour: maintenant.toISOString().slice(0, 10) };
  }

  it("0,004 est refusé (400 PAYOUT_AMOUNT_POSITIVE) et rien n'est enregistré", async () => {
    const { owner, h, mois, annee, jour } = await agenceAvecLoyerEncaisse();

    const res = await request(app).post(`/api/crg/${owner.id}/payouts`).set(h).send({ month: mois, year: annee, currency: "EUR", amount: 0.004, paidAt: jour, method: "CASH" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PAYOUT_AMOUNT_POSITIVE");
    expect(await testDb.select().from(ownerPayouts).where(eq(ownerPayouts.ownerId, owner.id))).toHaveLength(0);
  });

  it("un reversement normal reste enregistré, au centime", async () => {
    const { owner, h, mois, annee, jour } = await agenceAvecLoyerEncaisse();

    const res = await request(app).post(`/api/crg/${owner.id}/payouts`).set(h).send({ month: mois, year: annee, currency: "EUR", amount: 40.005, paidAt: jour, method: "CASH" });

    expect(res.status).toBe(201);
    expect(res.body.amount).toBe(40.01);
  });
});

describe("Baux à réviser — la liste ne charge ni les baux ni les biens entiers", () => {
  it("GET /api/contracts/revisions-due garde le résultat et ne lit en entier ni les baux ni les biens", async () => {
    const { manager, owner, property, tenant, h } = await agence();
    // Anniversaire du bail dans 20 jours : dans la fenêtre de rappel. Le bail porte des clauses et deux signatures lourdes.
    const debut = new Date(Date.now() - 365 * JOUR_MS + 20 * JOUR_MS);
    const contract = await createContract(property.id, tenant.id, {
      status: "ACTIVE",
      startDate: debut,
      endDate: new Date(Date.now() + 700 * JOUR_MS),
      terms: "Clauses particulières. ".repeat(200),
      managerSignatureUrl: SIGNATURE,
      tenantSignatureUrl: SIGNATURE,
    });
    // Une révision annulée d'un autre bail : la seconde lecture (révisions de l'agence) doit s'exécuter.
    const autreBail = await createContract((await createProperty(manager.id, { ownerId: owner.id })).id, (await createTenant(manager.id)).id, { status: "ACTIVE" });
    await testDb.insert(rentRevisions).values({ contractId: autreBail.id, previousRent: 500, newRent: 520, effectiveDate: new Date(Date.UTC(2026, 0, 1)), method: "AMOUNT", status: "APPLIED" });
    const entieres = surveillerLecturesEntieres();

    const res = await request(app).get("/api/contracts/revisions-due").set(h);

    expect(res.status).toBe(200);
    expect(res.body.map((b: { contractId: string }) => b.contractId)).toContain(contract.id);
    const ligne = res.body.find((b: { contractId: string }) => b.contractId === contract.id);
    expect(ligne.rent).toBe(500);
    expect(ligne.currency).toBeTruthy();
    expect(ligne.propertyTitle).toBe(property.title);
    expect(JSON.stringify(res.body)).not.toContain("AAAAAAAA");
    expect(entieres).not.toContain(contracts);
    expect(entieres).not.toContain(properties);
  });
});
