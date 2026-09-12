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

describe("Messages API (/api/messages)", () => {
  it("GET /api/messages/conversations — liste les conversations du gestionnaire avec le dernier message", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id, { title: "Résidence Almadies" });
    const tenant = await createTenant(manager.id, { firstName: "Fatou", lastName: "Diop" });
    const contract = await createContract(property.id, tenant.id);
    const managerToken = tokenFor(manager);

    // Initialement pas de message
    const initialRes = await request(app)
      .get("/api/messages/conversations")
      .set(authHeader(managerToken));
    expect(initialRes.status).toBe(200);
    expect(initialRes.body).toHaveLength(1);
    expect(initialRes.body[0].contractId).toBe(contract.id);
    expect(initialRes.body[0].lastMessage).toBeNull();

    // Envoi d'un premier message par le gestionnaire
    const sendRes = await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(authHeader(managerToken))
      .send({ content: "Bonjour Fatou, bienvenue dans votre nouveau logement." });
    expect(sendRes.status).toBe(201);
    expect(sendRes.body.content).toBe("Bonjour Fatou, bienvenue dans votre nouveau logement.");

    // La conversation affiche maintenant le dernier message
    const updatedRes = await request(app)
      .get("/api/messages/conversations")
      .set(authHeader(managerToken));
    expect(updatedRes.status).toBe(200);
    expect(updatedRes.body[0].lastMessage).not.toBeNull();
    expect(updatedRes.body[0].lastMessage.content).toBe(
      "Bonjour Fatou, bienvenue dans votre nouveau logement."
    );
  });

  it("GET /api/messages/:id — marque les messages comme lus", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const managerToken = tokenFor(manager);

    await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(authHeader(managerToken))
      .send({ content: "Message test" });

    // Consultation des messages du contrat
    const res = await request(app)
      .get(`/api/messages/${contract.id}`)
      .set(authHeader(managerToken));
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0].content).toBe("Message test");
  });

  it("GET /api/messages/:id — interdit l'accès à un autre gestionnaire", async () => {
    const managerA = await createManager();
    const managerB = await createManager();
    const propertyA = await createProperty(managerA.id);
    const tenantA = await createTenant(managerA.id);
    const contractA = await createContract(propertyA.id, tenantA.id);

    const res = await request(app)
      .get(`/api/messages/${contractA.id}`)
      .set(authHeader(tokenFor(managerB)));

    expect(res.status).toBe(403);
  });
});
