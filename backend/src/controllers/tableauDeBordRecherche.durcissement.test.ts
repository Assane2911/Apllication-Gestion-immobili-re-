import { is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { contracts, invoices, properties, tenants, users } from "../db/schema";
import { authHeader, createContract, createExpense, createInvoice, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

afterEach(() => vi.restoreAllMocks());

const SIGNATURE = "data:image/png;base64," + "A".repeat(60_000);

async function agence() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) });
  const property = await createProperty(manager.id, { title: "Villa Ngor", currency: "EUR" });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow" });
  const contract = await createContract(property.id, tenant.id, {
    status: "ACTIVE",
    terms: "Clauses particulières. ".repeat(200),
    managerSignatureUrl: SIGNATURE,
    tenantSignatureUrl: SIGNATURE,
    currency: "EUR",
  });
  return { manager, property, tenant, contract, h: authHeader(tokenFor(manager)) };
}

/** Relève les tables lues EN ENTIER : `db.select().from(table)` (et ses jointures), ou une table passée telle quelle dans la liste des colonnes. */
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

describe("Recherche globale — ne charge ni les baux, ni les factures, ni les fiches entières", () => {
  it("garde les résultats et ne lit en entier que le compte de l'utilisateur (authentification)", async () => {
    const { contract, h } = await agence();
    await createInvoice(contract.id, { periodMonth: 11, periodYear: 2026, amount: 500, dueDate: new Date(2026, 10, 5) });
    const entieres = surveillerLecturesEntieres();

    const res = await request(app).get("/api/search").query({ q: "Ngor" }).set(h);

    expect(res.status).toBe(200);
    const types = res.body.results.map((r: { type: string }) => r.type).sort();
    expect(types).toEqual(["contract", "invoice", "property"]);
    const bail = res.body.results.find((r: { type: string }) => r.type === "contract");
    expect(bail.title).toBe("Villa Ngor — Awa Sow");
    expect(bail.subtitle).toBe("Contrat • ACTIVE");
    const facture = res.body.results.find((r: { type: string }) => r.type === "invoice");
    expect(facture.title).toBe("Facture 11/2026 — Villa Ngor");
    expect(JSON.stringify(res.body)).not.toContain("AAAAAAAA");
    for (const table of [contracts, invoices, tenants, properties]) expect(entieres).not.toContain(table);
    // La seule lecture entière tolérée est celle de l'authentification (le compte qui consulte).
    expect(entieres.filter((t) => t === users)).toHaveLength(1);
  });

  it("trouve aussi un locataire par son nom", async () => {
    const { h } = await agence();

    const res = await request(app).get("/api/search").query({ q: "Sow" }).set(h);

    expect(res.status).toBe(200);
    const locataire = res.body.results.find((r: { type: string }) => r.type === "tenant");
    expect(locataire.title).toBe("Awa Sow");
    expect(locataire.subtitle).toContain("@");
  });
});

describe("Tableau de bord — les totaux sont arrondis au centime (pas de bruit de virgule flottante)", () => {
  it("renvoie 30.3 et non 30.299999999999997", async () => {
    const { manager, property, contract, h } = await agence();
    const maintenant = new Date();
    const mois = maintenant.getMonth() + 1;
    const annee = maintenant.getFullYear();
    // 10,10 + 20,20 : en virgule flottante, la somme vaut 30.299999999999997.
    await createInvoice(contract.id, { periodMonth: mois, periodYear: annee, amount: 10.1, amountPaid: 10.1, status: "PAID", currency: "EUR", paidAt: maintenant, dueDate: maintenant });
    const [autreBail] = [await createContract((await createProperty(manager.id, { currency: "EUR" })).id, (await createTenant(manager.id)).id, { status: "ACTIVE", currency: "EUR" })];
    await createInvoice(autreBail.id, { periodMonth: mois, periodYear: annee, amount: 20.2, amountPaid: 20.2, status: "PAID", currency: "EUR", paidAt: maintenant, dueDate: maintenant });
    await createExpense(property.id, { amount: 10.1, currency: "EUR", expenseDate: maintenant });
    await createExpense(property.id, { amount: 20.2, currency: "EUR", expenseDate: maintenant });

    const res = await request(app).get("/api/dashboard/stats").set(h);

    expect(res.status).toBe(200);
    const cle = `${annee}-${String(mois).padStart(2, "0")}`;
    expect(res.body.monthlyExpectedByCurrency.EUR).toBe(30.3);
    expect(res.body.monthlyRevenueByCurrency.EUR).toBe(30.3);
    expect(res.body.revenueByMonth[cle].EUR).toBe(30.3);
    expect(res.body.expensesByMonth[cle].EUR).toBe(30.3);
  });
});
