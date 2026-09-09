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
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

function tenantToken(tenantId: string, userId = "tenant-user") {
  return authHeader(tokenFor({ id: userId, role: "TENANT" }, tenantId));
}

describe("GET /api/notifications", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).get("/api/notifications");
    expect(res.status).toBe(401);
  });

  it("refuse l'accès à un locataire", async () => {
    const res = await request(app).get("/api/notifications").set(tenantToken("t1"));
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

    await request(app)
      .post(`/api/messages/${contract.id}`)
      .set(tenantToken(tenant.id))
      .send({ content: "Bonjour, une question" });

    const res = await request(app).get("/api/notifications").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const messageNotif = res.body.notifications.find((n: { type: string }) => n.type === "message");
    expect(messageNotif).toBeTruthy();
    expect(messageNotif.severity).toBe("info");
    expect(messageNotif.title).toContain(tenant.firstName);
  });

  it("ne signale pas un message déjà lu ni un message envoyé par le gestionnaire", async () => {
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
