import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { issueReports } from "../db/schema";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createProperty,
  createTenant,
  createTenantPortalUser,
  createPortalUser,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

// Le compte est créé en base : depuis le contrôle de révocation, un jeton
// forgé sur un identifiant inventé est refusé en 401 (voir authenticate).
// `userId` permet aux tests qui ont déjà un compte de portail (créé par
// createTenantPortalUser) de signer le jeton avec CE compte-là, quand
// l'identité de l'auteur du message compte pour ce qu'ils vérifient.
async function tenantToken(tenantId: string, userId?: string) {
  const user = userId ? { id: userId, role: "TENANT" as const } : await createPortalUser("TENANT");
  return authHeader(tokenFor(user, tenantId));
}

describe("GET /api/notifications", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).get("/api/notifications");
    expect(res.status).toBe(401);
  });

  it("refuse l'accès à un locataire", async () => {
    const res = await request(app).get("/api/notifications").set(await tenantToken("t1"));
    expect(res.status).toBe(403);
  });

  it("renvoie une liste vide pour un gestionnaire sans rien à signaler", async () => {
    const manager = await createManager();
    const res = await request(app).get("/api/notifications").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.notifications).toHaveLength(0);
  });

  it("signale un message non lu du locataire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const portalUser = await createTenantPortalUser(tenant);

    await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(await tenantToken(tenant.id, portalUser.id))
      .send({ content: "Bonjour, une question" });

    const res = await request(app).get("/api/notifications").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const messageNotif = res.body.notifications.find((n: { type: string }) => n.type === "message");
    expect(messageNotif).toBeTruthy();
    expect(messageNotif.severity).toBe("info");
    expect(messageNotif.title).toContain(tenant.firstName);
  });

  it("ne signale pas un message envoyé par le gestionnaire lui-même", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ content: "Message du gestionnaire" });

    const res = await request(app).get("/api/notifications").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.notifications.some((n: { type: string }) => n.type === "message")).toBe(false);
  });

  /**
   * Le filtre isRead=false est désormais porté par le SQL de la requête
   * (voir notification.controller.ts), pas par une boucle après coup : ce
   * test verrouille le même résultat qu'avant, message par message, plutôt
   * que la performance de la requête elle-même.
   */
  it("ne signale plus un message du locataire une fois que le gestionnaire l'a lu", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const portalUser = await createTenantPortalUser(tenant);

    await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(await tenantToken(tenant.id, portalUser.id))
      .send({ content: "Bonjour, une question" });

    // Ouvrir la conversation marque les messages reçus comme lus (voir
    // getMessagesByContract, message.controller.ts).
    await request(app).get(`/api/messages/${contract.id}`).set(authHeader(tokenFor(manager)));

    const res = await request(app).get("/api/notifications").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.notifications.some((n: { type: string }) => n.type === "message")).toBe(false);
  });

  it("signale une facture en retard", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, { status: "LATE" });

    const res = await request(app).get("/api/notifications").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const invoiceNotif = res.body.notifications.find((n: { type: string }) => n.type === "invoice");
    expect(invoiceNotif).toBeTruthy();
    expect(invoiceNotif.severity).toBe("danger");
  });

  it("signale un incident ouvert mais pas un incident déjà résolu", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await testDb.insert(issueReports).values({
      contractId: contract.id,
      tenantId: tenant.id,
      title: "Fuite d'eau",
      description: "Description",
      photoUrl: "issues/a.jpg",
      status: "OPEN",
    });
    await testDb.insert(issueReports).values({
      contractId: contract.id,
      tenantId: tenant.id,
      title: "Ampoule grillée",
      description: "Description",
      photoUrl: "issues/b.jpg",
      status: "RESOLVED",
    });

    const res = await request(app).get("/api/notifications").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const issueNotifs = res.body.notifications.filter((n: { type: string }) => n.type === "issue");
    expect(issueNotifs).toHaveLength(1);
    expect(issueNotifs[0].title).toContain("Fuite d'eau");
    expect(issueNotifs[0].severity).toBe("warning");
  });

  it("signale un contrat arrivant à échéance sous 14 jours mais pas un contrat lointain", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const soon = new Date();
    soon.setDate(soon.getDate() + 5);
    const far = new Date();
    far.setDate(far.getDate() + 200);
    await createContract(property.id, tenant.id, { status: "ACTIVE", endDate: soon });
    const otherTenant = await createTenant(manager.id);
    await createContract(property.id, otherTenant.id, { status: "ACTIVE", endDate: far });

    const res = await request(app).get("/api/notifications").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const contractNotifs = res.body.notifications.filter((n: { type: string }) => n.type === "contract_ending");
    expect(contractNotifs).toHaveLength(1);
    expect(contractNotifs[0].severity).toBe("danger"); // <= 7 jours restants
  });

  it("isole les notifications par gestionnaire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, { status: "LATE" });

    const otherManager = await createManager();
    const res = await request(app).get("/api/notifications").set(authHeader(tokenFor(otherManager)));

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });
});

describe("GET /api/notifications/mine (locataire)", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).get("/api/notifications/mine");
    expect(res.status).toBe(401);
  });

  it("refuse l'accès à un gestionnaire", async () => {
    const manager = await createManager();
    const res = await request(app).get("/api/notifications/mine").set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(403);
  });

  it("refuse l'accès à un compte TENANT qui n'est rattaché à aucune fiche locataire", async () => {
    const orphan = await createPortalUser("TENANT");
    const res = await request(app).get("/api/notifications/mine").set(authHeader(tokenFor(orphan)));
    expect(res.status).toBe(403);
  });

  it("renvoie une liste vide pour un locataire sans rien à signaler", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id);
    const portalUser = await createTenantPortalUser(tenant);

    const res = await request(app).get("/api/notifications/mine").set(await tenantToken(tenant.id, portalUser.id));

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });

  it("signale un message non lu envoyé par le gestionnaire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const portalUser = await createTenantPortalUser(tenant);

    await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ content: "Votre quittance est disponible" });

    const res = await request(app).get("/api/notifications/mine").set(await tenantToken(tenant.id, portalUser.id));

    expect(res.status).toBe(200);
    const messageNotif = res.body.notifications.find((n: { type: string }) => n.type === "message");
    expect(messageNotif).toBeTruthy();
    expect(messageNotif.severity).toBe("info");
    expect(messageNotif.link).toBe("/portail/messages");
  });

  it("ne signale pas un message envoyé par le locataire lui-même", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const portalUser = await createTenantPortalUser(tenant);

    await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(await tenantToken(tenant.id, portalUser.id))
      .send({ content: "Bonjour, une question" });

    const res = await request(app).get("/api/notifications/mine").set(await tenantToken(tenant.id, portalUser.id));

    expect(res.status).toBe(200);
    expect(res.body.notifications.some((n: { type: string }) => n.type === "message")).toBe(false);
  });

  it("ne signale plus un message du gestionnaire une fois que le locataire l'a lu", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const portalUser = await createTenantPortalUser(tenant);

    await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ content: "Votre quittance est disponible" });

    // Ouvrir la conversation marque les messages reçus comme lus (voir
    // getMessagesByContract, message.controller.ts).
    await request(app).get(`/api/messages/${contract.id}`).set(await tenantToken(tenant.id, portalUser.id));

    const res = await request(app).get("/api/notifications/mine").set(await tenantToken(tenant.id, portalUser.id));

    expect(res.status).toBe(200);
    expect(res.body.notifications.some((n: { type: string }) => n.type === "message")).toBe(false);
  });

  it("signale un loyer en retard", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, { status: "LATE" });
    const portalUser = await createTenantPortalUser(tenant);

    const res = await request(app).get("/api/notifications/mine").set(await tenantToken(tenant.id, portalUser.id));

    expect(res.status).toBe(200);
    const invoiceNotif = res.body.notifications.find((n: { type: string }) => n.type === "invoice");
    expect(invoiceNotif).toBeTruthy();
    expect(invoiceNotif.severity).toBe("danger");
    expect(invoiceNotif.title).toBe("Loyer en retard");
  });

  it("signale un loyer bientôt dû (sous 3 jours) mais pas un loyer encore lointain", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const soon = new Date();
    soon.setDate(soon.getDate() + 2);
    const far = new Date();
    far.setDate(far.getDate() + 20);
    await createInvoice(contract.id, { status: "PENDING", periodMonth: 1, dueDate: soon });
    await createInvoice(contract.id, { status: "PENDING", periodMonth: 2, dueDate: far });
    const portalUser = await createTenantPortalUser(tenant);

    const res = await request(app).get("/api/notifications/mine").set(await tenantToken(tenant.id, portalUser.id));

    expect(res.status).toBe(200);
    const invoiceNotifs = res.body.notifications.filter((n: { type: string }) => n.type === "invoice");
    expect(invoiceNotifs).toHaveLength(1);
    expect(invoiceNotifs[0].severity).toBe("warning");
    expect(invoiceNotifs[0].title).toBe("Loyer à régler bientôt");
  });

  it("ne signale pas une facture annulée", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, { status: "CANCELLED" });
    const portalUser = await createTenantPortalUser(tenant);

    const res = await request(app).get("/api/notifications/mine").set(await tenantToken(tenant.id, portalUser.id));

    expect(res.status).toBe(200);
    expect(res.body.notifications.some((n: { type: string }) => n.type === "invoice")).toBe(false);
  });

  it("signale un bail arrivant à échéance sous 14 jours mais pas un bail lointain", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const soon = new Date();
    soon.setDate(soon.getDate() + 5);
    await createContract(property.id, tenant.id, { status: "ACTIVE", endDate: soon });
    const portalUser = await createTenantPortalUser(tenant);

    const res = await request(app).get("/api/notifications/mine").set(await tenantToken(tenant.id, portalUser.id));

    expect(res.status).toBe(200);
    const contractNotifs = res.body.notifications.filter((n: { type: string }) => n.type === "contract_ending");
    expect(contractNotifs).toHaveLength(1);
    expect(contractNotifs[0].severity).toBe("danger"); // <= 7 jours restants
    expect(contractNotifs[0].link).toBe("/portail");
  });

  it("isole les notifications par locataire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, { status: "LATE" });

    const otherTenant = await createTenant(manager.id);
    await createContract(property.id, otherTenant.id);
    const otherPortalUser = await createTenantPortalUser(otherTenant);

    const res = await request(app)
      .get("/api/notifications/mine")
      .set(await tenantToken(otherTenant.id, otherPortalUser.id));

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });
});
