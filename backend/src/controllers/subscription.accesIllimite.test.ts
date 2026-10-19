import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { platformSubscriptions, users } from "../db/schema";
import { authHeader, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Un compte à accès illimité (abonnement actif sans échéance, voir grantUnlimitedAccess) n'a rien à
 * résilier ni à souscrire : résilier le faisait passer en « résilié sans période payée », donc sans accès
 * du tout ; souscrire remplaçait son accès illimité par une échéance datée.
 */
const illimite = () => createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: null });

describe("POST /api/subscription/cancel — compte à accès illimité", () => {
  it("refuse de résilier et laisse l'accès intact", async () => {
    const manager = await illimite();

    const res = await request(app).post("/api/subscription/cancel").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(409);
    const [apres] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(apres.subscriptionStatus).toBe("ACTIVE");
    expect(apres.subscriptionEndsAt).toBeNull();
    expect((await request(app).get("/api/properties").set(authHeader(tokenFor(manager)))).status).toBe(200);
  });
});

describe("POST /api/subscription/subscribe — compte à accès illimité", () => {
  it("refuse de souscrire et n'enregistre aucun paiement", async () => {
    const manager = await illimite();

    const res = await request(app)
      .post("/api/subscription/subscribe")
      .set(authHeader(tokenFor(manager)))
      .send({ plan: "PRO", billingCycle: "MONTHLY", paymentMethod: "BANK_TRANSFER" });

    expect(res.status).toBe(409);
    expect(await testDb.select().from(platformSubscriptions).where(eq(platformSubscriptions.userId, manager.id))).toHaveLength(0);
    const [apres] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(apres.subscriptionPlan).toBe("ENTERPRISE");
  });

  it("un abonnement payant daté se résilie et se renouvelle toujours normalement", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", subscriptionEndsAt: new Date(Date.now() + 20 * 86_400_000) });

    const resiliation = await request(app).post("/api/subscription/cancel").set(authHeader(tokenFor(manager)));
    expect(resiliation.status).toBe(200);

    const souscription = await request(app)
      .post("/api/subscription/subscribe")
      .set(authHeader(tokenFor(manager)))
      .send({ plan: "PRO", billingCycle: "MONTHLY", paymentMethod: "BANK_TRANSFER" });
    expect(souscription.status).toBe(200);
  });
});
