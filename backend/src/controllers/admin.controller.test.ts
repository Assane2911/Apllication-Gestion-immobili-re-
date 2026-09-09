import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { platformSubscriptions, users } from "../db/schema";
import { authHeader, createAdmin, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

async function createPendingBankTransfer(managerId: string, overrides: Partial<typeof platformSubscriptions.$inferInsert> = {}) {
  const [record] = await testDb
    .insert(platformSubscriptions)
    .values({
      userId: managerId,
      plan: "PRO",
      amount: 29,
      status: "PENDING",
      paymentMethod: "BANK_TRANSFER",
      paymentRef: "VIR-REF-001",
      startDate: new Date(2026, 5, 1),
      endDate: new Date(2026, 6, 1),
      ...overrides,
    })
    .returning();
  return record;
}

describe("GET /api/admin/subscriptions/pending-bank-transfers", () => {
  it("refuse l'accès à un gestionnaire (rôle non-admin)", async () => {
    const manager = await createManager();

    const res = await request(app)
      .get("/api/admin/subscriptions/pending-bank-transfers")
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(403);
  });

  it("liste les abonnements en attente de virement pour un administrateur", async () => {
    const admin = await createAdmin();
    const manager = await createManager();
    const record = await createPendingBankTransfer(manager.id);
    // Un abonnement déjà payé, ou payé par un autre moyen, ne doit pas apparaître.
    await createPendingBankTransfer(manager.id, { status: "PAID", paymentRef: "VIR-REF-002" });
    await createPendingBankTransfer(manager.id, { paymentMethod: "PAYDUNYA", paymentRef: "pd_token_999" });

    const res = await request(app)
      .get("/api/admin/subscriptions/pending-bank-transfers")
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(record.id);
    expect(res.body[0].managerEmail).toBe(manager.email);
  });
});

describe("POST /api/admin/subscriptions/:id/confirm-bank-transfer", () => {
  it("refuse l'accès à un gestionnaire (rôle non-admin)", async () => {
    const manager = await createManager();
    const record = await createPendingBankTransfer(manager.id);

    const res = await request(app)
      .post(`/api/admin/subscriptions/${record.id}/confirm-bank-transfer`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(403);
  });

  it("confirme le virement : active l'abonnement du gestionnaire et marque l'historique PAID", async () => {
    const admin = await createAdmin();
    const manager = await createManager({ subscriptionStatus: "EXPIRED" });
    const record = await createPendingBankTransfer(manager.id);

    const res = await request(app)
      .post(`/api/admin/subscriptions/${record.id}/confirm-bank-transfer`)
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const [updatedRecord] = await testDb
      .select()
      .from(platformSubscriptions)
      .where(eq(platformSubscriptions.id, record.id));
    expect(updatedRecord.status).toBe("PAID");

    const [updatedManager] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(updatedManager.subscriptionStatus).toBe("ACTIVE");
    expect(updatedManager.subscriptionPlan).toBe("PRO");
  });

  it("renvoie 404 si l'abonnement n'existe pas", async () => {
    const admin = await createAdmin();

    const res = await request(app)
      .post("/api/admin/subscriptions/introuvable/confirm-bank-transfer")
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(404);
  });

  it("refuse de confirmer un abonnement qui n'est pas payé par virement bancaire", async () => {
    const admin = await createAdmin();
    const manager = await createManager();
    const record = await createPendingBankTransfer(manager.id, { paymentMethod: "PAYDUNYA", paymentRef: "pd_token_888" });

    const res = await request(app)
      .post(`/api/admin/subscriptions/${record.id}/confirm-bank-transfer`)
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(400);

    const [stillPending] = await testDb
      .select()
      .from(platformSubscriptions)
      .where(eq(platformSubscriptions.id, record.id));
    expect(stillPending.status).toBe("PENDING");
  });

  it("est idempotent : confirmer deux fois le même virement ne fait rien la seconde fois", async () => {
    const admin = await createAdmin();
    const manager = await createManager();
    const record = await createPendingBankTransfer(manager.id);

    await request(app)
      .post(`/api/admin/subscriptions/${record.id}/confirm-bank-transfer`)
      .set(authHeader(tokenFor(admin)));

    const res = await request(app)
      .post(`/api/admin/subscriptions/${record.id}/confirm-bank-transfer`)
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
