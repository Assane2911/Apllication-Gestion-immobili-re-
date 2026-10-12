import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { contracts } from "../db/schema";
import { authHeader, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Audit du compte gestionnaire, défaut n°2 : le titre du bail était toujours
 * « Bail d'habitation », même pour un local commercial, avec la mention
 * « Conforme à la législation en vigueur » sans préciser laquelle.
 */
async function contexte() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id);
  const corps = (extra: Record<string, unknown> = {}) => ({
    propertyId: property.id,
    tenantId: tenant.id,
    rent: 500,
    deposit: 1000,
    startDate: "2026-01-01",
    endDate: "2027-01-01",
    ...extra,
  });
  return { manager, h: authHeader(tokenFor(manager)), corps };
}

describe("type de bail et droit applicable", () => {
  it("sans précision : bail d'habitation, sans droit applicable (comportement des contrats d'avant)", async () => {
    const { h, corps } = await contexte();
    const res = await request(app).post("/api/contracts").set(h).send(corps());
    expect(res.status).toBe(201);
    expect(res.body.leaseType).toBe("HABITATION");
    expect(res.body.applicableLaw).toBeNull();
    const bail = await request(app).get(`/api/documents/lease/${res.body.id}`).set(h);
    expect(bail.text).toContain("CONTRAT DE BAIL D'HABITATION");
    expect(bail.text).not.toContain("Conforme à la législation");
  });

  it("un bail commercial porte son titre et le droit applicable saisi", async () => {
    const { h, corps } = await contexte();
    const res = await request(app).post("/api/contracts").set(h).send(corps({ leaseType: "COMMERCIAL", applicableLaw: "  Droit OHADA — Acte uniforme  " }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ leaseType: "COMMERCIAL", applicableLaw: "Droit OHADA — Acte uniforme" });
    const bail = await request(app).get(`/api/documents/lease/${res.body.id}`).set(h);
    expect(bail.text).toContain("CONTRAT DE BAIL COMMERCIAL");
    expect(bail.text).toContain("Droit applicable : Droit OHADA");
    expect(bail.text).not.toContain("Surface habitable");
  });

  it("refuse un type inconnu et un droit applicable trop long", async () => {
    const { h, corps } = await contexte();
    expect((await request(app).post("/api/contracts").set(h).send(corps({ leaseType: "GARAGE" }))).status).toBe(400);
    expect((await request(app).post("/api/contracts").set(h).send(corps({ applicableLaw: "x".repeat(301) }))).status).toBe(400);
  });

  it("un droit applicable vide est enregistré comme absent", async () => {
    const { h, corps } = await contexte();
    const res = await request(app).post("/api/contracts").set(h).send(corps({ applicableLaw: "   " }));
    expect(res.body.applicableLaw).toBeNull();
  });

  it("se modifie tant que le locataire n'a pas signé, puis est verrouillé (contenu du bail)", async () => {
    const { h, corps } = await contexte();
    const cree = await request(app).post("/api/contracts").set(h).send(corps());
    const maj = await request(app).put(`/api/contracts/${cree.body.id}`).set(h).send({ leaseType: "MEUBLE", applicableLaw: "Droit français" });
    expect(maj.status).toBe(200);
    expect(maj.body).toMatchObject({ leaseType: "MEUBLE", applicableLaw: "Droit français" });

    await testDb.update(contracts).set({ signedByTenantAt: new Date() }).where(eq(contracts.id, cree.body.id));
    const verrou = await request(app).put(`/api/contracts/${cree.body.id}`).set(h).send({ leaseType: "COMMERCIAL" });
    expect(verrou.status).toBe(409);
    const verrouDroit = await request(app).put(`/api/contracts/${cree.body.id}`).set(h).send({ applicableLaw: "Autre" });
    expect(verrouDroit.status).toBe(409);
    const [relu] = await testDb.select().from(contracts).where(eq(contracts.id, cree.body.id));
    expect(relu.leaseType).toBe("MEUBLE");
    expect(relu.applicableLaw).toBe("Droit français");
  });

  it("le renouvellement garde le type et le droit applicable", async () => {
    const { h, corps } = await contexte();
    const cree = await request(app).post("/api/contracts").set(h).send(corps({ leaseType: "PROFESSIONNEL", applicableLaw: "Droit sénégalais" }));
    const res = await request(app).post(`/api/contracts/${cree.body.id}/renew`).set(h).send({ months: 12 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ leaseType: "PROFESSIONNEL", applicableLaw: "Droit sénégalais" });
  });
});
