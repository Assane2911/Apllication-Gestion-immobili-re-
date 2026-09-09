import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { contracts } from "../db/schema";
import { createContract, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { eq } from "drizzle-orm";

const CRON_ROUTES = ["/api/cron/daily", "/api/cron/contract-reminders", "/api/cron/rent-due-reminders", "/api/cron/rent-due-soon-reminders"];

const CRON_SECRET = process.env.CRON_SECRET!;

describe("Sécurité des routes /api/cron/*", () => {
  it.each(CRON_ROUTES)("refuse l'accès à %s sans en-tête Authorization", async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
  });

  it.each(CRON_ROUTES)("refuse l'accès à %s avec un mauvais secret", async (path) => {
    const res = await request(app).get(path).set({ Authorization: "Bearer mauvais-secret" });
    expect(res.status).toBe(401);
  });

  it.each(CRON_ROUTES)("autorise l'accès à %s avec le bon secret", async (path) => {
    const res = await request(app).get(path).set({ Authorization: `Bearer ${CRON_SECRET}` });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("GET /api/cron/contract-reminders", () => {
  it("envoie un rappel pour un contrat se terminant exactement dans 14 jours et marque reminderSentAt", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 14);
    const contract = await createContract(property.id, tenant.id, { status: "ACTIVE", endDate });

    const res = await request(app)
      .get("/api/cron/contract-reminders")
      .set({ Authorization: `Bearer ${CRON_SECRET}` });

    expect(res.status).toBe(200);
    expect(res.body.remindersSent).toBe(1);

    const [updated] = await testDb.select().from(contracts).where(eq(contracts.id, contract.id));
    expect(updated.reminderSentAt).not.toBeNull();
  });

  it("ne renvoie pas de rappel en double pour un contrat déjà notifié", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 14);
    await createContract(property.id, tenant.id, { status: "ACTIVE", endDate, reminderSentAt: new Date() });

    const res = await request(app)
      .get("/api/cron/contract-reminders")
      .set({ Authorization: `Bearer ${CRON_SECRET}` });

    expect(res.status).toBe(200);
    expect(res.body.remindersSent).toBe(0);
  });

  it("ne renvoie aucun rappel pour un contrat dont l'échéance est lointaine", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 200);
    await createContract(property.id, tenant.id, { status: "ACTIVE", endDate });

    const res = await request(app)
      .get("/api/cron/contract-reminders")
      .set({ Authorization: `Bearer ${CRON_SECRET}` });

    expect(res.status).toBe(200);
    expect(res.body.remindersSent).toBe(0);
  });
});

describe("GET /api/cron/rent-due-reminders", () => {
  it("génère les factures du mois en cours pour les contrats actifs et renvoie un compte de rappels", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id, {
      status: "ACTIVE",
      startDate: new Date(2020, 0, 1),
      endDate: new Date(2030, 0, 1),
    });

    const res = await request(app)
      .get("/api/cron/rent-due-reminders")
      .set({ Authorization: `Bearer ${CRON_SECRET}` });

    expect(res.status).toBe(200);
    expect(typeof res.body.remindersSent).toBe("number");
    expect(Array.isArray(res.body.details)).toBe(true);
  });
});

describe("GET /api/cron/rent-due-soon-reminders", () => {
  it("répond avec succès même sans aucun contrat actif", async () => {
    const res = await request(app)
      .get("/api/cron/rent-due-soon-reminders")
      .set({ Authorization: `Bearer ${CRON_SECRET}` });

    expect(res.status).toBe(200);
    expect(res.body.remindersSent).toBe(0);
  });
});

describe("GET /api/cron/daily", () => {
  it("combine le rappel de fin de contrat et le rappel avant échéance", async () => {
    const res = await request(app).get("/api/cron/daily").set({ Authorization: `Bearer ${CRON_SECRET}` });

    expect(res.status).toBe(200);
    expect(typeof res.body.contractEndingRemindersSent).toBe("number");
    expect(typeof res.body.upcomingRentDueRemindersSent).toBe("number");
  });
});
