import { and, eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { activityLogs, contracts, rentRevisions } from "../db/schema";
import {
  authHeader,
  createContract,
  createInsurancePolicy,
  createManager,
  createProperty,
  createTenant,
  tokenCollaborateur,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Régression : les polices d'assurance n'avaient aucune borne — « 1e999 » est converti en Infinity par
 * z.coerce.number() et passait `positive()` (comme pour les dépenses), les textes n'avaient aucune limite —,
 * et leur création, modification ou suppression ne laissait aucune trace dans le journal d'activité.
 */
describe("polices d'assurance — valeurs aberrantes", () => {
  async function poster(corps: Record<string, unknown>) {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    return request(app)
      .post("/api/insurance-policies")
      .set(authHeader(tokenFor(manager)))
      .send({ propertyId: property.id, insurerName: "AXA Habitat", policyNumber: "AXA-1", expiryDate: "2027-01-01", ...corps });
  }

  it("refuse une prime infinie ou absurdement grande", async () => {
    expect((await poster({ premiumAmount: "1e999" })).status).toBe(400);
    expect((await poster({ premiumAmount: 1e15 })).status).toBe(400);
  });

  it("refuse des textes démesurés ou composés d'espaces", async () => {
    expect((await poster({ insurerName: "A".repeat(201) })).status).toBe(400);
    expect((await poster({ policyNumber: "P".repeat(101) })).status).toBe(400);
    expect((await poster({ notes: "n".repeat(5001) })).status).toBe(400);
    expect((await poster({ insurerName: "   " })).status).toBe(400);
  });

  it("accepte une police normale aux limites permises", async () => {
    const res = await poster({ insurerName: "A".repeat(200), policyNumber: "P".repeat(100), notes: "n".repeat(5000), premiumAmount: 2_500_000 });
    expect(res.status).toBe(201);
  });

  it("refuse aussi ces valeurs à la modification", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const policy = await createInsurancePolicy(property.id);

    const res = await request(app)
      .put(`/api/insurance-policies/${policy.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ propertyId: property.id, insurerName: "AXA", policyNumber: "AXA-1", premiumAmount: "1e999", expiryDate: "2027-01-01" });

    expect(res.status).toBe(400);
  });
});

describe("polices d'assurance — journal d'activité", () => {
  const trace = (managerId: string, action: string) =>
    testDb.select().from(activityLogs).where(and(eq(activityLogs.managerId, managerId), eq(activityLogs.action, action)));

  it("trace la création, la modification et la suppression", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const h = authHeader(tokenFor(manager));

    const created = await request(app)
      .post("/api/insurance-policies")
      .set(h)
      .send({ propertyId: property.id, insurerName: "AXA Habitat", policyNumber: "AXA-2026-001", expiryDate: "2027-01-01" });
    expect(created.status).toBe(201);
    await request(app)
      .put(`/api/insurance-policies/${created.body.id}`)
      .set(h)
      .send({ propertyId: property.id, insurerName: "AXA Habitat", policyNumber: "AXA-2026-001", expiryDate: "2028-01-01" })
      .expect(200);
    await request(app).delete(`/api/insurance-policies/${created.body.id}`).set(h).expect(200);

    for (const action of ["insurance.create", "insurance.update", "insurance.delete"]) {
      const lignes = await trace(manager.id, action);
      expect(lignes, action).toHaveLength(1);
      expect(lignes[0].entityType).toBe("insurance");
      expect(lignes[0].entityId).toBe(created.body.id);
      expect(lignes[0].details).toContain("AXA-2026-001");
    }
  });

  it("ne trace rien quand la suppression est refusée", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const policy = await createInsurancePolicy(property.id);
    const intrus = await createManager();

    const res = await request(app).delete(`/api/insurance-policies/${policy.id}`).set(authHeader(tokenFor(intrus)));

    expect(res.status).toBe(404);
    expect(await trace(manager.id, "insurance.delete")).toHaveLength(0);
    expect(await trace(intrus.id, "insurance.delete")).toHaveLength(0);
  });
});

describe("révision de loyer — attribution", () => {
  /**
   * Régression : `createdBy` recevait `req.user.userId`, c'est-à-dire l'id du PROPRIÉTAIRE de l'agence pour un
   * collaborateur (voir identiteJetonPourManager). Une révision de loyer créée par un agent était attribuée au
   * propriétaire : impossible de savoir qui avait réellement fixé le nouveau loyer. Les mises en demeure
   * utilisent déjà `collaboratorId ?? userId`.
   */
  it("attribue la révision au collaborateur qui l'a créée, pas au propriétaire", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, {
      rent: 500,
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2099-12-31T00:00:00Z"),
    });
    const collaborateur = await createTeamMemberToken(manager);

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/rent-revisions`)
      .set(authHeader(collaborateur.token))
      .send({ mode: "PERCENT", percent: 3, effectiveDate: "2099-06-01" });

    expect(res.status).toBe(201);
    const [rev] = await testDb.select().from(rentRevisions).where(eq(rentRevisions.contractId, contract.id));
    expect(rev.createdBy).toBe(collaborateur.id);
    expect(rev.createdBy).not.toBe(manager.id);
    const [bail] = await testDb.select().from(contracts).where(eq(contracts.id, contract.id));
    expect(bail.rent).toBe(500);
  });
});

async function createTeamMemberToken(owner: { id: string }) {
  const token = await tokenCollaborateur(owner, { teamRole: "AGENT" });
  // L'id du collaborateur est dans le jeton (claim collaboratorId).
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  return { token, id: payload.collaboratorId as string };
}
