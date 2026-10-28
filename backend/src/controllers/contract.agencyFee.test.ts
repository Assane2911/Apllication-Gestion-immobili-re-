import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { contracts } from "../db/schema";
import { authHeader, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Frais d'agence à la charge du locataire : un montant facultatif, imprimé sur le bail et jamais facturé par la plateforme.
 * Contenu du bail, donc verrouillé après la signature du locataire ; ponctuel, donc non repris au renouvellement.
 */
async function contexte() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id);
  const corps = (extra: Record<string, unknown> = {}) => ({
    propertyId: property.id,
    tenantId: tenant.id,
    rent: 200000,
    deposit: 400000,
    currency: "XOF",
    startDate: "2026-01-01",
    endDate: "2029-01-01",
    ...extra,
  });
  return { manager, h: authHeader(tokenFor(manager)), corps };
}

describe("frais d'agence — enregistrement et impression", () => {
  it("sans frais : null en réponse et aucune ligne sur le bail (comportement des contrats d'avant)", async () => {
    const { h, corps } = await contexte();
    const res = await request(app).post("/api/contracts").set(h).send(corps());
    expect(res.status).toBe(201);
    expect(res.body.agencyFee).toBeNull();
    const bail = await request(app).get(`/api/documents/lease/${res.body.id}`).set(h);
    expect(bail.text).not.toContain("Frais d'agence");
  });

  it("enregistre le montant, le relit et l'imprime sur le bail", async () => {
    const { h, corps } = await contexte();
    const res = await request(app).post("/api/contracts").set(h).send(corps({ agencyFee: 100000 }));
    expect(res.status).toBe(201);
    expect(res.body.agencyFee).toBe(100000);

    const lu = await request(app).get(`/api/contracts/${res.body.id}`).set(h);
    expect(lu.body.agencyFee).toBe(100000);
    const bail = await request(app).get(`/api/documents/lease/${res.body.id}`).set(h);
    expect(bail.text).toContain("Frais d'agence à la charge du locataire :</strong>");
    expect(bail.text).toMatch(/100[\s  ]000/);
  });

  it("un montant à zéro ou null n'imprime aucune ligne", async () => {
    const { h, corps } = await contexte();
    // Deux baux sur le même bien : le second commence après la fin du premier, sans chevauchement.
    for (const [i, agencyFee] of [0, null].entries()) {
      const debut = 2026 + 4 * i;
      const res = await request(app).post("/api/contracts").set(h).send(corps({ agencyFee, startDate: `${debut}-01-01`, endDate: `${debut + 3}-01-01` }));
      expect(res.status, String(agencyFee)).toBe(201);
      const bail = await request(app).get(`/api/documents/lease/${res.body.id}`).set(h);
      expect(bail.text, String(agencyFee)).not.toContain("Frais d'agence");
    }
  });

  it("refuse un montant négatif, illisible ou excessif", async () => {
    const { h, corps } = await contexte();
    for (const agencyFee of [-1, "abc", 1e15]) {
      const res = await request(app).post("/api/contracts").set(h).send(corps({ agencyFee }));
      expect(res.status, String(agencyFee)).toBe(400);
    }
  });
});

describe("frais d'agence — modification, verrou et renouvellement", () => {
  it("se modifie et s'efface tant que le locataire n'a pas signé, puis est verrouillé", async () => {
    const { h, corps } = await contexte();
    const cree = await request(app).post("/api/contracts").set(h).send(corps());
    const maj = await request(app).put(`/api/contracts/${cree.body.id}`).set(h).send({ agencyFee: 90000 });
    expect(maj.status).toBe(200);
    expect(maj.body.agencyFee).toBe(90000);
    const efface = await request(app).put(`/api/contracts/${cree.body.id}`).set(h).send({ agencyFee: null });
    expect(efface.body.agencyFee).toBeNull();
    await request(app).put(`/api/contracts/${cree.body.id}`).set(h).send({ agencyFee: 90000 });

    await testDb.update(contracts).set({ signedByTenantAt: new Date() }).where(eq(contracts.id, cree.body.id));
    const verrou = await request(app).put(`/api/contracts/${cree.body.id}`).set(h).send({ agencyFee: 1 });
    expect(verrou.status).toBe(409);
    expect(verrou.body.code).toBe("LEASE_SIGNED_LOCKED");
    const [relu] = await testDb.select().from(contracts).where(eq(contracts.id, cree.body.id));
    expect(relu.agencyFee).toBe(90000);
  });

  it("le renouvellement ne reprend pas les frais d'agence, dus une seule fois à la signature", async () => {
    const { h, corps } = await contexte();
    const cree = await request(app).post("/api/contracts").set(h).send(corps({ agencyFee: 100000 }));
    const res = await request(app).post(`/api/contracts/${cree.body.id}/renew`).set(h).send({ months: 36 });
    expect(res.status).toBe(201);
    expect(res.body.agencyFee).toBeNull();
  });
});
