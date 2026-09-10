import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { agencySettings, platformSubscriptions, users } from "../db/schema";
import {
  authHeader,
  createAdmin,
  createContract,
  createManager,
  createPlatformSubscription,
  createProperty,
  createTenant,
  tokenFor,
} from "../test/authHelpers";
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

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
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

describe("GET /api/admin/dashboard/stats", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).get("/api/admin/dashboard/stats");
    expect(res.status).toBe(401);
  });

  it("refuse l'accès à un gestionnaire (réservé aux administrateurs)", async () => {
    const manager = await createManager();
    const res = await request(app)
      .get("/api/admin/dashboard/stats")
      .set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(403);
  });

  it("répartit les gestionnaires par statut réel d'abonnement (essai actif / payant actif / sans accès)", async () => {
    const admin = await createAdmin();
    // Essai en cours.
    await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(9) });
    // Abonnement payant en cours de validité.
    await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: daysFromNow(20) });
    // Essai expiré depuis longtemps, jamais passé payant : sans accès malgré
    // la colonne "subscriptionStatus" toujours à TRIAL (jamais réévaluée en
    // base, seulement à la connexion — computeSubscriptionInfo doit la
    // corriger côté lecture).
    await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(-5) });

    const res = await request(app)
      .get("/api/admin/dashboard/stats")
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(200);
    expect(res.body.managers.total).toBe(3);
    expect(res.body.managers.trialActive).toBe(1);
    expect(res.body.managers.subscriptionActive).toBe(1);
    expect(res.body.managers.expired).toBe(1);
  });

  it("liste les essais se terminant dans les 7 jours, triés par urgence, en excluant les essais plus lointains", async () => {
    const admin = await createAdmin();
    const urgent = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(2) });
    const soonish = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(6) });
    await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(25) });
    await testDb.insert(agencySettings).values({ userId: urgent.id, agencyName: "Agence du Port" });

    const res = await request(app)
      .get("/api/admin/dashboard/stats")
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(200);
    expect(res.body.trialsEndingSoon).toHaveLength(2);
    expect(res.body.trialsEndingSoon[0].userId).toBe(urgent.id);
    expect(res.body.trialsEndingSoon[0].agencyName).toBe("Agence du Port");
    expect(res.body.trialsEndingSoon[1].userId).toBe(soonish.id);
    expect(res.body.trialsEndingSoon[1].agencyName).toBeNull();
  });

  it("calcule le MRR à partir du dernier paiement confirmé de chaque abonnement payant actif, en ramenant l'annuel au mensuel", async () => {
    const admin = await createAdmin();

    const proManager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", subscriptionEndsAt: daysFromNow(15) });
    await createPlatformSubscription(proManager.id, { plan: "PRO", amount: 29, billingCycle: "MONTHLY", status: "PAID" });

    const enterpriseManager = await createManager({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "ENTERPRISE",
      subscriptionEndsAt: daysFromNow(200),
    });
    // Un paiement PENDING plus récent ne doit pas être pris en compte (virement
    // bancaire pas encore validé) : seul le dernier paiement PAID compte.
    await createPlatformSubscription(enterpriseManager.id, { plan: "ENTERPRISE", amount: 470, billingCycle: "ANNUAL", status: "PAID" });
    await createPlatformSubscription(enterpriseManager.id, { plan: "ENTERPRISE", amount: 470, billingCycle: "ANNUAL", status: "PENDING" });

    // Essai en cours : ne contribue jamais au MRR.
    await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(5) });

    const res = await request(app)
      .get("/api/admin/dashboard/stats")
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(200);
    expect(res.body.mrr.byPlan.PRO).toBe(29);
    expect(res.body.mrr.byPlan.ENTERPRISE).toBe(39.17);
    expect(res.body.mrr.total).toBe(68.17);
    expect(res.body.mrr.contributors).toBe(2);
  });

  it("compte le volume global d'usage (biens, locataires, contrats actifs) tous gestionnaires confondus", async () => {
    const admin = await createAdmin();

    const managerA = await createManager();
    const propertyA = await createProperty(managerA.id);
    const tenantA = await createTenant(managerA.id);
    await createContract(propertyA.id, tenantA.id, { status: "ACTIVE" });

    const managerB = await createManager();
    const propertyB1 = await createProperty(managerB.id);
    await createProperty(managerB.id);
    const tenantB = await createTenant(managerB.id);
    await createContract(propertyB1.id, tenantB.id, { status: "ENDED" });

    const res = await request(app)
      .get("/api/admin/dashboard/stats")
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(200);
    expect(res.body.usage.totalProperties).toBe(3);
    expect(res.body.usage.totalTenants).toBe(2);
    expect(res.body.usage.activeContracts).toBe(1);
  });
});
