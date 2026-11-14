import { is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { agencySettings, contracts } from "../db/schema";
import { createContract, createInsurancePolicy, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

afterEach(() => vi.restoreAllMocks());

const CRON_SECRET = process.env.CRON_SECRET!;
const SIGNATURE = "data:image/png;base64," + "A".repeat(60_000);
const JOUR = 24 * 3600 * 1000;

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

/**
 * Le cron quotidien s'exécute sur TOUTE la plateforme. Un bail entier porte ses clauses (jusqu'à 10 Ko) et ses deux images de
 * signature en base64 : les relire pour chaque bail actif, à chaque passage, charge en mémoire des centaines de mégaoctets que
 * personne n'utilise. Chaque étape ne doit lire que les colonnes dont elle se sert.
 */
describe("Cron quotidien — ne charge jamais un bail entier", () => {
  it("garde le travail du jour (fin de bail, factures, avis, relances, assurance) sans lire la table des baux en entier", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: new Date(Date.now() + 30 * JOUR) });
    await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "Agence Teranga", overdueRemindersEnabled: true, overdueGraceDays: 5, overdueIntervalDays: 10 });
    const property = await createProperty(manager.id, { title: "Villa Ngor" });
    const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow", email: "awa@test.local" });
    const maintenant = new Date();
    const contract = await createContract(property.id, tenant.id, {
      status: "ACTIVE",
      startDate: new Date(maintenant.getFullYear(), maintenant.getMonth() - 3, 1),
      endDate: new Date(Date.now() + 10 * JOUR),
      terms: "Clauses particulières. ".repeat(200),
      managerSignatureUrl: SIGNATURE,
      tenantSignatureUrl: SIGNATURE,
    });
    // Deux loyers en retard déjà facturés : les relances passent AVANT la génération des factures du mois.
    for (const decalage of [2, 1]) {
      const echeance = new Date(maintenant.getFullYear(), maintenant.getMonth() - decalage, 1);
      await createInvoice(contract.id, { periodMonth: echeance.getMonth() + 1, periodYear: echeance.getFullYear(), amount: 500, status: "LATE", dueDate: echeance });
    }
    await createInsurancePolicy(property.id, { expiryDate: new Date(Date.now() + 10 * JOUR) });
    const entieres = surveillerLecturesEntieres();

    const res = await request(app).get("/api/cron/daily").set({ Authorization: `Bearer ${CRON_SECRET}` });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.contractEndingRemindersSent).toBe(1);
    expect(res.body.rentDueRemindersSent).toBeGreaterThanOrEqual(1);
    expect(res.body.overdueRemindersSent).toBeGreaterThanOrEqual(1);
    expect(res.body.insuranceRemindersSent).toBe(1);
    expect(contract.id).toBeTruthy();
    expect(entieres).not.toContain(contracts);
  });
});
