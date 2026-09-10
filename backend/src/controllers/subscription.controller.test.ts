import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { users } from "../db/schema";
import { authHeader, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

describe("GET /api/subscription/plans", () => {
  it("est accessible sans authentification et renvoie les 3 formules", async () => {
    const res = await request(app).get("/api/subscription/plans");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body.map((p: { id: string }) => p.id)).toEqual(["STARTER", "PRO", "ENTERPRISE"]);
  });
});

describe("GET /api/subscription/status", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).get("/api/subscription/status");
    expect(res.status).toBe(401);
  });

  it("refuse l'accès à un locataire", async () => {
    const res = await request(app)
      .get("/api/subscription/status")
      .set(authHeader(tokenFor({ id: "t1", role: "TENANT" }, "tenant-1")));
    expect(res.status).toBe(403);
  });

  it("renvoie l'état de l'essai en cours pour un gestionnaire", async () => {
    const manager = await createManager();

    const res = await request(app).get("/api/subscription/status").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.subscription.status).toBe("TRIAL");
    expect(res.body.subscription.isTrialActive).toBe(true);
    expect(res.body.userEmail).toBe(manager.email);
    expect(res.body.history).toEqual([]);
  });
});

describe("POST /api/subscription/subscribe", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).post("/api/subscription/subscribe").send({});
    expect(res.status).toBe(401);
  });

  it("rejette un plan invalide avec une erreur 400 explicite", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/subscription/subscribe")
      .set(authHeader(tokenFor(manager)))
      .send({ plan: "PLATINUM", paymentMethod: "DEMO" });

    expect(res.status).toBe(400);
  });

  it("active immédiatement l'abonnement quand le paiement est confirmé (mode démo)", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/subscription/subscribe")
      .set(authHeader(tokenFor(manager)))
      .send({ plan: "PRO", billingCycle: "MONTHLY", paymentMethod: "DEMO" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.subscription.status).toBe("ACTIVE");
    expect(res.body.subscription.plan).toBe("PRO");
    expect(res.body.record.status).toBe("PAID");
    expect(res.body.record.amount).toBe(29);

    const [updated] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(updated.subscriptionStatus).toBe("ACTIVE");
    expect(updated.subscriptionPlan).toBe("PRO");
    expect(updated.subscriptionEndsAt).not.toBeNull();
  });

  it("prolonge la date de fin d'un an pour un cycle de facturation annuel", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/subscription/subscribe")
      .set(authHeader(tokenFor(manager)))
      .send({ plan: "STARTER", billingCycle: "ANNUAL", paymentMethod: "DEMO" });

    expect(res.status).toBe(200);
    expect(res.body.record.amount).toBe(86);
    expect(res.body.record.billingCycle).toBe("ANNUAL");

    const endDate = new Date(res.body.subscription.subscriptionEndsAt);
    const now = new Date();
    const daysUntilEnd = (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(daysUntilEnd).toBeGreaterThan(360); // ~1 an, pas ~1 mois
  });

  // Régression du bug corrigé précédemment (activation d'un abonnement sans
  // paiement réellement vérifié, voir subscription.controller.ts) : un
  // virement bancaire déclaré doit rester en attente et ne JAMAIS accorder
  // l'accès tant qu'un administrateur ne l'a pas validé manuellement.
  it("NE PAS activer l'abonnement pour un virement bancaire déclaré tant qu'il n'est pas validé", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/subscription/subscribe")
      .set(authHeader(tokenFor(manager)))
      .send({ plan: "PRO", paymentMethod: "BANK_TRANSFER", bankReference: "VIR-2026-001" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.record.status).toBe("PENDING");
    // Le statut d'abonnement du gestionnaire ne doit pas avoir bougé de TRIAL.
    expect(res.body.subscription.status).toBe("TRIAL");

    const [updated] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(updated.subscriptionStatus).toBe("TRIAL");
    expect(updated.subscriptionPlan).not.toBe("PRO");
  });
});

describe("POST /api/subscription/cancel", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).post("/api/subscription/cancel").send({});
    expect(res.status).toBe(401);
  });

  it("annule le renouvellement automatique d'un abonnement actif", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE" });

    const res = await request(app).post("/api/subscription/cancel").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // computeSubscriptionInfo() renvoie "EXPIRED" dès que ni l'essai ni un
    // abonnement ACTIVE ne sont valides — "CANCELLED" n'est donc jamais
    // renvoyé tel quel dans le statut calculé, seulement en base.
    expect(res.body.subscription.status).toBe("EXPIRED");

    const [updated] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(updated.subscriptionStatus).toBe("CANCELLED");
  });
});
