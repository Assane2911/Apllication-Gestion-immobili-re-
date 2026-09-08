import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { properties } from "../db/schema";
import {
  authHeader,
  createContract,
  createManager,
  createProperty,
  createTenant,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

describe("POST /api/properties", () => {
  it("crée un bien pour le gestionnaire connecté", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/properties")
      .set(authHeader(tokenFor(manager)))
      .send({ title: "Studio Centre-ville", address: "10 rue de la Paix", surface: 25, rent: 400 });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Studio Centre-ville");
    expect(res.body.managerId).toBe(manager.id);
    expect(res.body.status).toBe("AVAILABLE");
  });
});

describe("GET /api/properties/:id", () => {
  it("renvoie le bien avec ses contrats pour son propriétaire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id);

    const res = await request(app).get(`/api/properties/${property.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(property.id);
    expect(res.body.contracts).toHaveLength(1);
    expect(res.body.contracts[0].tenant.id).toBe(tenant.id);
  });

  it("refuse l'accès au bien d'un autre gestionnaire", async () => {
    const property = await createProperty((await createManager()).id);
    const otherManager = await createManager();

    const res = await request(app).get(`/api/properties/${property.id}`).set(authHeader(tokenFor(otherManager)));

    expect(res.status).toBe(404);
  });
});

describe("PUT /api/properties/:id", () => {
  it("met à jour un bien appartenant au gestionnaire connecté", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);

    const res = await request(app)
      .put(`/api/properties/${property.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ rent: 650 });

    expect(res.status).toBe(200);
    expect(res.body.rent).toBe(650);
  });

  it("refuse de modifier le bien d'un autre gestionnaire", async () => {
    const property = await createProperty((await createManager()).id);
    const otherManager = await createManager();

    const res = await request(app)
      .put(`/api/properties/${property.id}`)
      .set(authHeader(tokenFor(otherManager)))
      .send({ rent: 1 });

    expect(res.status).toBe(404);
    const [unchanged] = await testDb.select().from(properties).where(eq(properties.id, property.id));
    expect(unchanged.rent).toBe(500);
  });
});

describe("DELETE /api/properties/:id", () => {
  it("supprime un bien sans contrat actif", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);

    const res = await request(app).delete(`/api/properties/${property.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(204);
    const remaining = await testDb.select().from(properties).where(eq(properties.id, property.id));
    expect(remaining).toHaveLength(0);
  });

  it("refuse de supprimer un bien ayant un contrat actif", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id); // status ACTIVE par défaut

    const res = await request(app).delete(`/api/properties/${property.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(409);
    const stillThere = await testDb.select().from(properties).where(eq(properties.id, property.id));
    expect(stillThere).toHaveLength(1);
  });

  it("refuse de supprimer le bien d'un autre gestionnaire", async () => {
    const property = await createProperty((await createManager()).id);
    const otherManager = await createManager();

    const res = await request(app).delete(`/api/properties/${property.id}`).set(authHeader(tokenFor(otherManager)));

    expect(res.status).toBe(404);
  });
});

describe("GET /api/properties — isolation entre gestionnaires", () => {
  it("ne renvoie que les biens du gestionnaire connecté", async () => {
    const manager = await createManager();
    await createProperty(manager.id);
    await createProperty((await createManager()).id);

    const res = await request(app).get("/api/properties").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});
