import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import {
  authHeader,
  createContract,
  createManager,
  createProperty,
  createTenant,
  tokenFor,
} from "../test/authHelpers";

function tenantToken(tenantId: string, userId = "tenant-user") {
  return authHeader(tokenFor({ id: userId, role: "TENANT" }, tenantId));
}

describe("POST /api/issues", () => {
  it("refuse la création sans photo", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const res = await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Fuite sous l'évier de la cuisine");

    expect(res.status).toBe(400);
  });

  it("crée un signalement avec photo pour le locataire connecté", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const res = await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Fuite sous l'évier de la cuisine")
      .attach("photo", Buffer.from("fake-image-bytes"), { filename: "fuite.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Fuite d'eau");
    expect(res.body.status).toBe("OPEN");
    expect(res.body.photoUrl).toContain("http://test.local/signed/");
  });

  it("refuse un type de fichier non autorisé", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const res = await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Fuite sous l'évier de la cuisine")
      .attach("photo", Buffer.from("not-an-image"), { filename: "notes.txt", contentType: "text/plain" });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("refuse la création pour un contrat qui n'appartient pas au locataire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const otherTenant = await createTenant(manager.id);

    const res = await request(app)
      .post("/api/issues")
      .set(tenantToken(otherTenant.id))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Fuite sous l'évier de la cuisine")
      .attach("photo", Buffer.from("fake-image-bytes"), { filename: "fuite.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(403);
  });
});

describe("GET /api/issues/mine", () => {
  it("refuse l'accès à un gestionnaire", async () => {
    const manager = await createManager();
    const res = await request(app).get("/api/issues/mine").set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(403);
  });

  it("renvoie uniquement les signalements du locataire connecté", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const otherTenant = await createTenant(manager.id);
    const otherContract = await createContract(property.id, otherTenant.id);

    await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Mon incident")
      .field("description", "Description de mon incident")
      .attach("photo", Buffer.from("fake-image-bytes"), { filename: "a.jpg", contentType: "image/jpeg" });
    await request(app)
      .post("/api/issues")
      .set(tenantToken(otherTenant.id))
      .field("contractId", otherContract.id)
      .field("title", "Incident d'un autre")
      .field("description", "Description d'un autre incident")
      .attach("photo", Buffer.from("fake-image-bytes"), { filename: "b.jpg", contentType: "image/jpeg" });

    const res = await request(app).get("/api/issues/mine").set(tenantToken(tenant.id));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe("Mon incident");
  });
});

describe("GET /api/issues", () => {
  it("refuse l'accès à un locataire", async () => {
    const res = await request(app).get("/api/issues").set(tenantToken("some-tenant-id"));
    expect(res.status).toBe(403);
  });

  it("renvoie uniquement les signalements des biens du gestionnaire connecté", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Incident chez moi")
      .field("description", "Description de l'incident")
      .attach("photo", Buffer.from("fake-image-bytes"), { filename: "a.jpg", contentType: "image/jpeg" });

    const otherManager = await createManager();
    const otherProperty = await createProperty(otherManager.id);
    const otherTenant = await createTenant(otherManager.id);
    const otherContract = await createContract(otherProperty.id, otherTenant.id);
    await request(app)
      .post("/api/issues")
      .set(tenantToken(otherTenant.id))
      .field("contractId", otherContract.id)
      .field("title", "Incident chez un autre")
      .field("description", "Description")
      .attach("photo", Buffer.from("fake-image-bytes"), { filename: "b.jpg", contentType: "image/jpeg" });

    const res = await request(app).get("/api/issues").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].title).toBe("Incident chez moi");
  });

  it("filtre par statut", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const createRes = await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Incident à traiter")
      .field("description", "Description")
      .attach("photo", Buffer.from("fake-image-bytes"), { filename: "a.jpg", contentType: "image/jpeg" });

    await request(app)
      .put(`/api/issues/${createRes.body.id}/status`)
      .set(authHeader(tokenFor(manager)))
      .send({ status: "RESOLVED" });

    const res = await request(app)
      .get("/api/issues")
      .query({ status: "OPEN" })
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });
});

describe("PUT /api/issues/:id/status", () => {
  it("met à jour le statut et la note du gestionnaire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const createRes = await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Description")
      .attach("photo", Buffer.from("fake-image-bytes"), { filename: "a.jpg", contentType: "image/jpeg" });

    const res = await request(app)
      .put(`/api/issues/${createRes.body.id}/status`)
      .set(authHeader(tokenFor(manager)))
      .send({ status: "IN_PROGRESS", managerNote: "Plombier envoyé demain" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("IN_PROGRESS");
    expect(res.body.managerNote).toBe("Plombier envoyé demain");
  });

  it("refuse la mise à jour d'un signalement d'un autre gestionnaire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const createRes = await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Description")
      .attach("photo", Buffer.from("fake-image-bytes"), { filename: "a.jpg", contentType: "image/jpeg" });

    const otherManager = await createManager();
    const res = await request(app)
      .put(`/api/issues/${createRes.body.id}/status`)
      .set(authHeader(tokenFor(otherManager)))
      .send({ status: "RESOLVED" });

    expect(res.status).toBe(404);
  });

  it("rejette un statut invalide", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const createRes = await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Description")
      .attach("photo", Buffer.from("fake-image-bytes"), { filename: "a.jpg", contentType: "image/jpeg" });

    const res = await request(app)
      .put(`/api/issues/${createRes.body.id}/status`)
      .set(authHeader(tokenFor(manager)))
      .send({ status: "NIMPORTEQUOI" });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/issues/:id/photo", () => {
  it("le locataire propriétaire peut ajouter une photo supplémentaire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const createRes = await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Description")
      .attach("photo", Buffer.from("fake-image-bytes"), { filename: "a.jpg", contentType: "image/jpeg" });

    const res = await request(app)
      .post(`/api/issues/${createRes.body.id}/photo`)
      .set(tenantToken(tenant.id))
      .attach("photo", Buffer.from("autre-photo"), { filename: "b.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(200);
    const additional = JSON.parse(res.body.additionalPhotos);
    expect(additional).toHaveLength(1);
  });

  it("le gestionnaire propriétaire du bien peut aussi ajouter une photo", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const createRes = await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Description")
      .attach("photo", Buffer.from("fake-image-bytes"), { filename: "a.jpg", contentType: "image/jpeg" });

    const res = await request(app)
      .post(`/api/issues/${createRes.body.id}/photo`)
      .set(authHeader(tokenFor(manager)))
      .attach("photo", Buffer.from("autre-photo"), { filename: "b.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(200);
  });

  it("refuse l'ajout de photo par un locataire non concerné", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const createRes = await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Description")
      .attach("photo", Buffer.from("fake-image-bytes"), { filename: "a.jpg", contentType: "image/jpeg" });

    const otherTenant = await createTenant(manager.id);
    const res = await request(app)
      .post(`/api/issues/${createRes.body.id}/photo`)
      .set(tenantToken(otherTenant.id))
      .attach("photo", Buffer.from("autre-photo"), { filename: "b.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(403);
  });

  it("refuse l'ajout de photo par un gestionnaire n'ayant pas ce bien", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const createRes = await request(app)
      .post("/api/issues")
      .set(tenantToken(tenant.id))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Description")
      .attach("photo", Buffer.from("fake-image-bytes"), { filename: "a.jpg", contentType: "image/jpeg" });

    const otherManager = await createManager();
    const res = await request(app)
      .post(`/api/issues/${createRes.body.id}/photo`)
      .set(authHeader(tokenFor(otherManager)))
      .attach("photo", Buffer.from("autre-photo"), { filename: "b.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(403);
  });
});
