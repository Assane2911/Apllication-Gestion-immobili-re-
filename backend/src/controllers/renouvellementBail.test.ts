import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { contracts, invoices } from "../db/schema";
import {
  authHeader,
  createContract,
  createManager,
  createProperty,
  createTenant,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Renouveler un bail, c'est trois écritures indissociables : créer le nouveau
 * contrat, clore l'ancien, générer les factures. La transaction garantissait
 * déjà qu'elles réussissent ou échouent ensemble — mais le contrôle « seul un
 * contrat ACTIF peut être renouvelé » était une simple LECTURE, faite avant, et
 * la clôture de l'ancien n'était conditionnée à rien.
 *
 * Deux requêtes simultanées lisaient donc toutes les deux « ACTIVE », passaient
 * toutes les deux la garde, et créaient chacune leur contrat. Deux baux actifs
 * sur le même bien — ce que createContract et updateContract s'échinent à
 * empêcher — et deux jeux de factures pour la même période, donc un loyer
 * réclamé deux fois chaque mois au locataire.
 */
describe("Renouvellement d'un bail", () => {
  async function bailActif() {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, {
      startDate: new Date(2026, 0, 1),
      endDate: new Date(2026, 11, 31),
      status: "ACTIVE",
    });
    return { manager, property, contract };
  }

  it("renouvelle un bail actif et clôt l'ancien", async () => {
    const { manager, contract } = await bailActif();

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/renew`)
      .set(authHeader(tokenFor(manager)))
      .send({ months: 12 });

    expect(res.status).toBe(201);
    const [ancien] = await testDb.select().from(contracts).where(eq(contracts.id, contract.id));
    expect(ancien.status).toBe("ENDED");
  });

  it("ne crée jamais deux baux actifs quand deux requêtes arrivent ensemble", async () => {
    const { manager, property, contract } = await bailActif();
    const entete = authHeader(tokenFor(manager));

    const [a, b] = await Promise.all([
      request(app).post(`/api/contracts/${contract.id}/renew`).set(entete).send({ months: 12 }),
      request(app).post(`/api/contracts/${contract.id}/renew`).set(entete).send({ months: 12 }),
    ]);

    const statuts = [a.status, b.status].sort();
    expect(statuts).toEqual([201, 409]);

    const tous = await testDb.select().from(contracts).where(eq(contracts.propertyId, property.id));
    const actifs = tous.filter((c: typeof contracts.$inferSelect) => c.status === "ACTIVE");
    expect(actifs).toHaveLength(1);
  });

  it("ne facture la période renouvelée qu'une seule fois", async () => {
    // La conséquence que le locataire, lui, verrait : deux avis d'échéance
    // par mois pour le même logement.
    const { manager, contract } = await bailActif();
    const entete = authHeader(tokenFor(manager));

    await Promise.all([
      request(app).post(`/api/contracts/${contract.id}/renew`).set(entete).send({ months: 3 }),
      request(app).post(`/api/contracts/${contract.id}/renew`).set(entete).send({ months: 3 }),
    ]);

    const nouveaux = (await testDb.select().from(contracts)).filter((c: typeof contracts.$inferSelect) => c.id !== contract.id);
    expect(nouveaux).toHaveLength(1);

    const facturesDuNouveau = await testDb.select().from(invoices).where(eq(invoices.contractId, nouveaux[0].id));
    const periodes = facturesDuNouveau.map((f: typeof invoices.$inferSelect) => `${f.periodMonth}-${f.periodYear}`);
    expect(new Set(periodes).size).toBe(periodes.length);
  });

  it("refuse de renouveler un bail déjà clos", async () => {
    const { manager, contract } = await bailActif();
    await testDb.update(contracts).set({ status: "ENDED" }).where(eq(contracts.id, contract.id));

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/renew`)
      .set(authHeader(tokenFor(manager)))
      .send({ months: 12 });

    expect(res.status).toBe(409);
  });
});
