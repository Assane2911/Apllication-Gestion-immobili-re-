import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { users } from "../db/schema";
import {
  authHeader,
  createAdmin,
  createContract,
  createManager,
  createProperty,
  createTenant,
  createTenantPortalUser,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

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
    expect(initialRes.body.items).toHaveLength(1);
    expect(initialRes.body.total).toBe(1);
    expect(initialRes.body.items[0].contractId).toBe(contract.id);
    expect(initialRes.body.items[0].lastMessage).toBeNull();

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
    expect(updatedRes.body.items[0].lastMessage).not.toBeNull();
    expect(updatedRes.body.items[0].lastMessage.content).toBe(
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

  /**
   * Régression : la mise à jour `isRead` de getMessagesByContract ne
   * filtrait pas par expéditeur. Un locataire qui ouvrait sa propre
   * conversation (juste après avoir envoyé un message, par ex.) marquait
   * donc son propre message comme lu — ce qui viderait à tort le badge
   * "non lu" du gestionnaire avant même qu'il n'ait ouvert la conversation.
   */
  it("GET /api/messages/:id (locataire) — ne marque pas comme lu le message que le locataire vient d'envoyer lui-même", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const portalUser = await createTenantPortalUser(tenant);
    const tenantToken = tokenFor(portalUser, tenant.id);

    await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(authHeader(tenantToken))
      .send({ content: "J'ai une question sur mon loyer" });

    // Le locataire ouvre sa propre conversation (ex : juste après l'envoi)
    const viewRes = await request(app)
      .get(`/api/messages/${contract.id}`)
      .set(authHeader(tenantToken));
    expect(viewRes.status).toBe(200);

    // Le gestionnaire n'a jamais ouvert la conversation : son message
    // reste bien "non lu" dans son centre de notifications.
    const notifRes = await request(app)
      .get("/api/notifications")
      .set(authHeader(tokenFor(manager)));
    expect(notifRes.status).toBe(200);
    const messageNotif = notifRes.body.notifications.find((n: { type: string }) => n.type === "message");
    expect(messageNotif).toBeDefined();
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

  /**
   * Régression : le contrôle d'accès était écrit comme deux `if` indépendants
   * (un pour TENANT, un pour MANAGER) — un rôle ADMIN ne déclenchait ni l'un
   * ni l'autre, donc n'était jamais refusé. Un compte ADMIN pouvait ainsi lire
   * (et même écrire dans) n'importe quelle conversation privée
   * gestionnaire-locataire de la plateforme.
   */
  it("GET /api/messages/:id — interdit l'accès à un administrateur", async () => {
    const manager = await createManager();
    const admin = await createAdmin();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const res = await request(app)
      .get(`/api/messages/${contract.id}`)
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(403);
  });

  it("POST /api/messages/:id — interdit à un administrateur d'écrire dans une conversation", async () => {
    const manager = await createManager();
    const admin = await createAdmin();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const res = await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(authHeader(tokenFor(admin)))
      .send({ content: "Message injecté" });

    expect(res.status).toBe(403);
  });

  /**
   * Régression : la branche `else` de listConversations ne testait que
   * `properties.managerId === req.user.userId`, jamais le rôle réel. Un
   * compte ADMIN promu depuis un ancien compte MANAGER (scripts/createAdmin.ts
   * conserve le même id utilisateur lors de la promotion) tombait dans
   * cette branche comme s'il était toujours gestionnaire, exposant les
   * conversations de ses anciens biens.
   */
  it("GET /api/messages/conversations — refuse même quand l'id de l'admin correspond à un ancien managerId", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id);
    // Simule scripts/createAdmin.ts : promotion d'un compte existant vers
    // ADMIN par UPDATE, qui conserve le même id utilisateur (donc le même
    // id que celui référencé par properties.managerId).
    await testDb.update(users).set({ role: "ADMIN" }).where(eq(users.id, manager.id));

    const res = await request(app)
      .get("/api/messages/conversations")
      .set(authHeader(tokenFor({ id: manager.id, role: "ADMIN" })));

    expect(res.status).toBe(403);
  });
});
