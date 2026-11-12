import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { contracts } from "../db/schema";
import { testDb } from "../test/setupTestDb";
import { authHeader, createContract, createManager, createProperty, createTenant, createTenantPortalUser, tokenFor } from "../test/authHelpers";

const SIGNATURE = "data:image/png;base64," + "A".repeat(60_000);
const MARQUEUR = "AAAAAAAA";

async function bailSigne() {
  const manager = await createManager();
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id, {
    signedByManagerAt: new Date(),
    managerSignatureUrl: SIGNATURE,
    signedByTenantAt: new Date(),
    tenantSignatureUrl: SIGNATURE,
  });
  return { manager, property, tenant, contract };
}

describe("Baux — les images de signature ne voyagent pas dans les réponses de l'API", () => {
  it("la liste ne renvoie pas les images, seulement qui a signé et quand", async () => {
    const { manager } = await bailSigne();

    const res = await request(app).get("/api/contracts").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].signedByManagerAt).toBeTruthy();
    expect(res.body.items[0].signedByTenantAt).toBeTruthy();
    expect(res.body.items[0]).not.toHaveProperty("managerSignatureUrl");
    expect(res.body.items[0]).not.toHaveProperty("tenantSignatureUrl");
    expect(JSON.stringify(res.body)).not.toContain(MARQUEUR);
  });

  it("le détail d'un bail ne renvoie pas les images non plus", async () => {
    const { manager, contract } = await bailSigne();

    const res = await request(app).get(`/api/contracts/${contract.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.signedByTenantAt).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain(MARQUEUR);
  });

  it("la modification d'un bail ne renvoie pas les images", async () => {
    const { manager, contract } = await bailSigne();

    const res = await request(app)
      .put(`/api/contracts/${contract.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ status: "ACTIVE" });

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(MARQUEUR);
  });

  it("le portail locataire ne reçoit pas les images, mais voit les dates de signature", async () => {
    const { tenant } = await bailSigne();
    const portail = await createTenantPortalUser(tenant);

    const res = await request(app).get("/api/contracts/mine").set(authHeader(tokenFor(portail, tenant.id)));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].signedByManagerAt).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain(MARQUEUR);
  });

  it("les images restent bien enregistrées et figurent dans le document imprimable du bail", async () => {
    const { manager, contract } = await bailSigne();

    const doc = await request(app).get(`/api/documents/lease/${contract.id}`).set(authHeader(tokenFor(manager)));

    expect(doc.status).toBe(200);
    expect(String(doc.text) + JSON.stringify(doc.body)).toContain(MARQUEUR);
    const [ligne] = await testDb.select().from(contracts).where(eq(contracts.id, contract.id));
    expect(ligne.managerSignatureUrl).toBe(SIGNATURE);
    expect(ligne.tenantSignatureUrl).toBe(SIGNATURE);
  });
});
