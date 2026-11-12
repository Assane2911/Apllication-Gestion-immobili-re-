import { is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { contracts, tenants } from "../db/schema";
import { authHeader, createContract, createInvoice, createManager, createOwner, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

afterEach(() => vi.restoreAllMocks());

const SIGNATURE = "data:image/png;base64," + "A".repeat(60_000);

/** Un propriétaire, son bien, un locataire et un bail signé (clauses et images de signature lourdes), avec deux loyers encaissés ce mois-ci. */
async function agence() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) });
  const owner = await createOwner(manager.id, { managementFeeRate: 8.5 });
  const property = await createProperty(manager.id, { ownerId: owner.id, currency: "EUR" });
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id, {
    terms: "Clauses particulières. ".repeat(200),
    managerSignatureUrl: SIGNATURE,
    tenantSignatureUrl: SIGNATURE,
    currency: "EUR",
  });
  const maintenant = new Date();
  // 10,10 + 20,20 : en virgule flottante, la somme vaut 30.299999999999997.
  await createInvoice(contract.id, { status: "PAID", amount: 10.1, amountPaid: 10.1, currency: "EUR", periodMonth: 1, periodYear: 2026, paidAt: maintenant });
  await createInvoice(contract.id, { status: "PAID", amount: 20.2, amountPaid: 20.2, currency: "EUR", periodMonth: 2, periodYear: 2026, paidAt: maintenant });
  return { manager, owner, h: authHeader(tokenFor(manager)), annee: maintenant.getFullYear(), mois: maintenant.getMonth() + 1 };
}

/**
 * Relève les tables lues EN ENTIER : `db.select().from(table)` (ligne entière), ou une table passée telle quelle dans la liste des
 * colonnes (`db.select({ contract: contracts })`). Une liste de colonnes (`{ id: contracts.id }`) n'en fait pas partie.
 */
function surveillerLecturesEntieres() {
  const entieres: unknown[] = [];
  const origine = testDb.select.bind(testDb);
  vi.spyOn(testDb, "select").mockImplementation(((...args: unknown[]) => {
    const requete = origine(...(args as []));
    const champs = args[0] as Record<string, unknown> | undefined;
    if (champs) {
      for (const valeur of Object.values(champs)) if (valeur && is(valeur as never, PgTable)) entieres.push(valeur);
    } else {
      const depuis = requete.from.bind(requete);
      requete.from = (table: unknown) => {
        entieres.push(table);
        return depuis(table);
      };
    }
    return requete;
  }) as never);
  return entieres;
}

describe("Rapports — ne chargent pas les baux et les locataires entiers", () => {
  it("la synthèse fiscale, le grand livre, le FEC et le SYSCOHADA ne lisent ni les baux ni les locataires en entier", async () => {
    const { h, annee } = await agence();
    const entieres = surveillerLecturesEntieres();

    for (const chemin of ["synthese", "grand-livre", "fec", "syscohada"]) {
      const res = await request(app).get(`/api/fiscal/${chemin}`).query({ year: annee }).set(h);
      expect(res.status, chemin).toBe(200);
    }

    expect(entieres).not.toContain(contracts);
    expect(entieres).not.toContain(tenants);
  });

  it("l'export du rapport financier ne lit ni les baux ni les locataires en entier, et garde le nom du locataire et du bien", async () => {
    const { h } = await agence();
    const entieres = surveillerLecturesEntieres();

    const res = await request(app).get("/api/expenses/export").set(h);

    expect(res.status).toBe(200);
    expect(entieres).not.toContain(contracts);
    expect(entieres).not.toContain(tenants);
    expect(res.text).toContain("Revenu");
    expect(res.text).toMatch(/Fatou|Diop|Awa|Ndiaye|Test|Locataire|Mamadou|Moussa/);
  });

  it("le compte-rendu de gestion (mensuel, annuel et synthèse des reversements) ne lit pas les baux en entier", async () => {
    const { h, owner, annee, mois } = await agence();
    const entieres = surveillerLecturesEntieres();

    const mensuel = await request(app).get(`/api/crg/${owner.id}`).query({ month: mois, year: annee }).set(h);
    const annuel = await request(app).get(`/api/crg/${owner.id}/annual`).query({ year: annee }).set(h);
    const reversements = await request(app).get("/api/crg/payouts/summary").query({ month: mois, year: annee }).set(h);

    expect(mensuel.status).toBe(200);
    expect(annuel.status).toBe(200);
    expect(reversements.status).toBe(200);
    expect(entieres).not.toContain(contracts);
    // Le résultat est celui d'avant : 30,30 de loyers encaissés sur le bien.
    expect(mensuel.body.totalLoyersByCurrency.EUR).toBeCloseTo(30.3, 2);
  });
});

describe("Rapports — les montants sont arrondis au centime (pas de bruit de virgule flottante)", () => {
  it("le compte-rendu de gestion renvoie 30.3 et non 30.299999999999997", async () => {
    const { h, owner, annee, mois } = await agence();

    const res = await request(app).get(`/api/crg/${owner.id}`).query({ month: mois, year: annee }).set(h);

    expect(res.status).toBe(200);
    const ligne = res.body.properties[0];
    expect(ligne.loyersEncaisses).toBe(30.3);
    expect(res.body.totalLoyersByCurrency.EUR).toBe(30.3);
    // Commission 8,5 % de 30,30 = 2,5755 → 2,58 ; net = 30,30 − 2,58.
    expect(ligne.commission).toBe(2.58);
    expect(ligne.netAReverser).toBe(27.72);
    expect(res.body.totalNetByCurrency.EUR).toBe(27.72);
    expect(res.body.totalCommissionByCurrency.EUR).toBe(2.58);
  });

  it("la synthèse fiscale et le résumé financier renvoient des totaux au centime", async () => {
    const { h, annee } = await agence();

    const fiscale = await request(app).get("/api/fiscal/synthese").query({ year: annee }).set(h);
    const resume = await request(app).get("/api/expenses/summary").set(h);

    expect(fiscale.status).toBe(200);
    expect(fiscale.body.totalRevenueByCurrency.EUR).toBe(30.3);
    expect(fiscale.body.netResultByCurrency.EUR).toBe(30.3);
    expect(fiscale.body.bilanParBien[0].revenue).toBe(30.3);
    expect(fiscale.body.bilanParBien[0].net).toBe(30.3);
    expect(resume.status).toBe(200);
    expect(resume.body.totalRevenueByCurrency.EUR).toBe(30.3);
    expect(resume.body.netCashFlowByCurrency.EUR).toBe(30.3);
  });
});
