import { eq } from "drizzle-orm";
import request from "supertest";
import * as Sentry from "@sentry/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { db } from "../db/client";
import { adminAuditLogs, platformSubscriptions } from "../db/schema";
import { logAdminAction } from "../services/adminAudit.service";
import { authHeader, createAdmin, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

// Complète le stub global de setupTestDb avec captureException, pour pouvoir
// vérifier qu'un échec d'écriture du journal est bien remonté à Sentry.
vi.mock("@sentry/node", () => ({
  init: () => {},
  setupExpressErrorHandler: () => {},
  flush: async () => true,
  captureException: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

async function createPendingBankTransfer(managerId: string) {
  const [record] = await testDb
    .insert(platformSubscriptions)
    .values({
      userId: managerId,
      plan: "PRO",
      amount: 29,
      status: "PENDING",
      paymentMethod: "BANK_TRANSFER",
      paymentRef: "VIR-AUDIT-1",
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })
    .returning();
  return record;
}

async function entries() {
  return testDb.select().from(adminAuditLogs);
}

describe("journalisation des actions admin", () => {
  it("confirmer un virement laisse une trace : qui, quoi, quel gestionnaire", async () => {
    const admin = await createAdmin();
    const manager = await createManager();
    const record = await createPendingBankTransfer(manager.id);

    const res = await request(app)
      .post(`/api/admin/subscriptions/${record.id}/confirm-bank-transfer`)
      .set(authHeader(tokenFor(admin)));
    expect(res.status).toBe(200);

    const lignes = await entries();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      adminId: admin.id,
      adminEmail: admin.email,
      action: "subscription.bank_transfer.confirm",
      targetUserId: manager.id,
      targetLabel: manager.email,
    });
    expect(lignes[0].details).toContain("VIR-AUDIT-1");
  });

  it("rejeter un virement laisse une trace", async () => {
    const admin = await createAdmin();
    const manager = await createManager();
    const record = await createPendingBankTransfer(manager.id);

    const res = await request(app)
      .post(`/api/admin/subscriptions/${record.id}/reject-bank-transfer`)
      .set(authHeader(tokenFor(admin)));
    expect(res.status).toBe(200);

    const lignes = await entries();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ action: "subscription.bank_transfer.reject", targetUserId: manager.id });
  });

  it("une action refusée ne laisse aucune trace", async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .post("/api/admin/subscriptions/inconnu/confirm-bank-transfer")
      .set(authHeader(tokenFor(admin)));
    expect(res.status).toBe(404);
    expect(await entries()).toHaveLength(0);
  });

  it("modifier les coordonnées bancaires est tracé SANS recopier l'IBAN ni le BIC", async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .put("/api/admin/settings")
      .set(authHeader(tokenFor(admin)))
      .send({ iban: "FR76 3000 6000 0112 3456 7890 189", bic: "BNPAFRPPXXX" });
    expect(res.status).toBe(200);

    const lignes = await entries();
    expect(lignes).toHaveLength(1);
    expect(lignes[0].action).toBe("platform.bank_details.update");
    const brut = JSON.stringify(lignes[0]);
    expect(brut).not.toContain("7890");
    expect(brut).not.toContain("BNPAFRPP");
  });

  it("un échec d'écriture du journal ne fait pas échouer l'action métier", async () => {
    const admin = await createAdmin();
    const manager = await createManager();
    const record = await createPendingBankTransfer(manager.id);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const insert = db.insert.bind(db);
    vi.spyOn(db, "insert").mockImplementation(((table: unknown) => {
      if (table === adminAuditLogs) throw new Error("panne journal");
      return insert(table as never);
    }) as never);

    const res = await request(app)
      .post(`/api/admin/subscriptions/${record.id}/confirm-bank-transfer`)
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(platformSubscriptions).where(eq(platformSubscriptions.id, record.id));
    expect(apres.status).toBe("PAID");
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it("sans utilisateur authentifié, l'entrée est attribuée à « Administrateur »", async () => {
    await logAdminAction({ action: "platform.bank_details.update" });
    const lignes = await entries();
    expect(lignes[0]).toMatchObject({ adminId: null, adminEmail: "Administrateur" });
  });
});

describe("GET /api/admin/audit-logs", () => {
  it("exige l'authentification et refuse un gestionnaire", async () => {
    expect((await request(app).get("/api/admin/audit-logs")).status).toBe(401);
    const manager = await createManager();
    const res = await request(app).get("/api/admin/audit-logs").set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(403);
  });

  it("liste du plus récent au plus ancien, paginé", async () => {
    const admin = await createAdmin();
    for (let i = 0; i < 5; i++) {
      await testDb.insert(adminAuditLogs).values({
        adminId: admin.id,
        adminEmail: admin.email,
        action: "platform.bank_details.update",
        details: `entrée ${i}`,
        createdAt: new Date(2026, 5, 1 + i),
      });
    }

    const page1 = await request(app).get("/api/admin/audit-logs").query({ pageSize: 2 }).set(authHeader(tokenFor(admin)));
    expect(page1.body.total).toBe(5);
    expect(page1.body.totalPages).toBe(3);
    expect(page1.body.items.map((i: { details: string }) => i.details)).toEqual(["entrée 4", "entrée 3"]);

    const page3 = await request(app)
      .get("/api/admin/audit-logs")
      .query({ pageSize: 2, page: 3 })
      .set(authHeader(tokenFor(admin)));
    expect(page3.body.items.map((i: { details: string }) => i.details)).toEqual(["entrée 0"]);
  });

  it("filtre par action et par gestionnaire visé", async () => {
    const admin = await createAdmin();
    const base = { adminId: admin.id, adminEmail: admin.email };
    await testDb.insert(adminAuditLogs).values([
      { ...base, action: "subscription.bank_transfer.confirm", targetUserId: "m1" },
      { ...base, action: "subscription.bank_transfer.reject", targetUserId: "m1" },
      { ...base, action: "subscription.bank_transfer.confirm", targetUserId: "m2" },
    ]);
    const token = tokenFor(admin);

    const parAction = await request(app)
      .get("/api/admin/audit-logs")
      .query({ action: "subscription.bank_transfer.confirm" })
      .set(authHeader(token));
    expect(parAction.body.total).toBe(2);

    const parCible = await request(app).get("/api/admin/audit-logs").query({ targetUserId: "m1" }).set(authHeader(token));
    expect(parCible.body.total).toBe(2);

    const les2 = await request(app)
      .get("/api/admin/audit-logs")
      .query({ targetUserId: "m1", action: "subscription.bank_transfer.reject" })
      .set(authHeader(token));
    expect(les2.body.total).toBe(1);
  });

  it("rejette une action inconnue au lieu de l'ignorer", async () => {
    const admin = await createAdmin();
    const res = await request(app).get("/api/admin/audit-logs").query({ action: "n.importe.quoi" }).set(authHeader(tokenFor(admin)));
    expect(res.status).toBe(400);
  });

  it("n'expose pas l'identifiant interne du compte administrateur", async () => {
    const admin = await createAdmin();
    await testDb.insert(adminAuditLogs).values({ adminId: admin.id, adminEmail: admin.email, action: "platform.bank_details.update" });
    const res = await request(app).get("/api/admin/audit-logs").set(authHeader(tokenFor(admin)));
    expect(res.body.items[0]).not.toHaveProperty("adminId");
  });
});
