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

describe("GET /api/messages/conversations", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).get("/api/messages/conversations");
    expect(res.status).toBe(401);
  });

  it("renvoie les conversations du gestionnaire avec le dernier message", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(tenantToken(tenant.id))
      .send({ content: "Bonjour, j'ai une question" });

    const res = await request(app).get("/api/messages/conversations").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].contractId).toBe(contract.id);
    expect(res.body[0].lastMessage.content).toBe("Bonjour, j'ai une question");
  });

  it("renvoie uniquement la conversation du locataire connecté", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const otherTenant = await createTenant(manager.id);
    await createContract(property.id, otherTenant.id);

    const res = await request(app).get("/api/messages/conversations").set(tenantToken(tenant.id));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].contractId).toBe(contract.id);
  });

  it("isole les conversations d'un gestionnaire de celles d'un autre", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id);

    const otherManager = await createManager();
    const res = await request(app).get("/api/messages/conversations").set(authHeader(tokenFor(otherManager)));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

describe("GET /api/messages/:contractId", () => {
  it("renvoie 404 pour un contrat inexistant", async () => {
    const manager = await createManager();
    const res = await request(app).get("/api/messages/introuvable").set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(404);
  });

  it("refuse l'accès à un gestionnaire qui n'est pas propriétaire du bien", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const otherManager = await createManager();
    const res = await request(app)
      .get(`/api/messages/${contract.id}`)
      .set(authHeader(tokenFor(otherManager)));

    expect(res.status).toBe(403);
  });

  it("refuse l'accès à un autre locataire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const otherTenant = await createTenant(manager.id);

    const res = await request(app).get(`/api/messages/${contract.id}`).set(tenantToken(otherTenant.id));

    expect(res.status).toBe(403);
  });

  it("renvoie l'historique et marque les messages comme lus", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(tenantToken(tenant.id))
      .send({ content: "Premier message" });
    await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ content: "Réponse du gestionnaire" });

    const res = await request(app).get(`/api/messages/${contract.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.messages[0].content).toBe("Premier message");
    expect(res.body.messages[1].content).toBe("Réponse du gestionnaire");
    expect(res.body.contract.tenant.id).toBe(tenant.id);

    // Un second appel confirme que les messages ont bien été marqués lus
    // (isRead passé à "true" par le premier GET).
    const secondRes = await request(app).get(`/api/messages/${contract.id}`).set(authHeader(tokenFor(manager)));
    expect(secondRes.body.messages.every((m: { isRead: string }) => m.isRead === "true")).toBe(true);
  });
});

describe("POST /api/messages/:contractId", () => {
  it("rejette un message vide", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const res = await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(tenantToken(tenant.id))
      .send({ content: "" });

    expect(res.status).toBe(400);
  });

  it("permet au locataire d'envoyer un message sur son propre contrat", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const res = await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(tenantToken(tenant.id))
      .send({ content: "Bonjour" });

    expect(res.status).toBe(201);
    expect(res.body.senderRole).toBe("TENANT");
    expect(res.body.isRead).toBe("false");
  });

  it("permet au gestionnaire propriétaire d'envoyer un message", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const res = await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ content: "Bonjour, votre loyer est bien reçu" });

    expect(res.status).toBe(201);
    expect(res.body.senderRole).toBe("MANAGER");
  });

  it("refuse l'envoi par un gestionnaire n'ayant pas ce bien", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const otherManager = await createManager();
    const res = await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(authHeader(tokenFor(otherManager)))
      .send({ content: "Tentative" });

    expect(res.status).toBe(403);
  });

  it("refuse l'envoi par un locataire non concerné", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const otherTenant = await createTenant(manager.id);

    const res = await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(tenantToken(otherTenant.id))
      .send({ content: "Tentative" });

    expect(res.status).toBe(403);
  });
});
