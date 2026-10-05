import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { issueReports, vendors } from "../db/schema";
import { authHeader, createContract, createManager, createProperty, createTenant, createVendor, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

describe("GET /api/vendors", () => {
  it("liste les prestataires du gestionnaire connecté, triés par nom", async () => {
    const manager = await createManager();
    await createVendor(manager.id, { name: "Zinc Toiture", trade: "Couvreur" });
    await createVendor(manager.id, { name: "Ampère Électricité", trade: "Électricien" });

    const res = await request(app).get("/api/vendors").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.map((v: { name: string }) => v.name)).toEqual(["Ampère Électricité", "Zinc Toiture"]);
  });

  it("ne fait pas fuiter les prestataires d'un autre gestionnaire", async () => {
    const manager = await createManager();
    const autreManager = await createManager();
    await createVendor(autreManager.id, { name: "Prestataire Confidentiel" });

    const res = await request(app).get("/api/vendors").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

describe("POST /api/vendors", () => {
  it("crée un prestataire avec un numéro converti au format international", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/vendors")
      .set(authHeader(tokenFor(manager)))
      .send({ name: "Plomberie Sow", trade: "Plombier", phone: "+221770001122", email: "sow@example.com" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Plomberie Sow");
    expect(res.body.phone).toMatch(/^\+/);
  });

  it("rejette un numéro de téléphone invalide", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/vendors")
      .set(authHeader(tokenFor(manager)))
      .send({ name: "Plomberie Sow", phone: "pas-un-numero" });

    expect(res.status).toBe(400);
  });

  it("rejette un nom vide", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/vendors")
      .set(authHeader(tokenFor(manager)))
      .send({ name: "", phone: "0770001122" });

    expect(res.status).toBe(400);
  });
});

describe("PUT /api/vendors/:id", () => {
  it("modifie un prestataire existant", async () => {
    const manager = await createManager();
    const vendor = await createVendor(manager.id, { name: "Ancien Nom" });

    const res = await request(app)
      .put(`/api/vendors/${vendor.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ name: "Nouveau Nom" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Nouveau Nom");
  });

  it("refuse de modifier le prestataire d'un autre gestionnaire", async () => {
    const manager = await createManager();
    const autreManager = await createManager();
    const vendor = await createVendor(autreManager.id);

    const res = await request(app)
      .put(`/api/vendors/${vendor.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ name: "Tentative" });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/vendors/:id", () => {
  it("supprime un prestataire", async () => {
    const manager = await createManager();
    const vendor = await createVendor(manager.id);

    const res = await request(app).delete(`/api/vendors/${vendor.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(204);
    expect(await testDb.select().from(vendors).where(eq(vendors.id, vendor.id))).toHaveLength(0);
  });

  it("désassigne (sans le bloquer) le prestataire d'un incident en cours, qui garde son historique", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const vendor = await createVendor(manager.id);
    const [issue] = await testDb
      .insert(issueReports)
      .values({
        contractId: contract.id,
        tenantId: tenant.id,
        title: "Fuite d'eau",
        description: "Description",
        photoUrl: "issues/fake.jpg",
        vendorId: vendor.id,
      })
      .returning();

    const res = await request(app).delete(`/api/vendors/${vendor.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(204);
    const [issueApres] = await testDb.select().from(issueReports).where(eq(issueReports.id, issue.id));
    expect(issueApres.vendorId).toBeNull();
    expect(issueApres.title).toBe("Fuite d'eau");
  });

  it("refuse de supprimer le prestataire d'un autre gestionnaire", async () => {
    const manager = await createManager();
    const autreManager = await createManager();
    const vendor = await createVendor(autreManager.id);

    const res = await request(app).delete(`/api/vendors/${vendor.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(404);
    expect(await testDb.select().from(vendors).where(eq(vendors.id, vendor.id))).toHaveLength(1);
  });
});
