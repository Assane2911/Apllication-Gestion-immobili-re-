import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { users } from "../db/schema";
import { REFERRAL_REWARD_DAYS } from "../services/referral.service";
import { authHeader, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { hashToken } from "../utils/token";

describe("GET /api/referral", () => {
  it("génère et renvoie un code de parrainage au premier appel", async () => {
    const manager = await createManager();

    const res = await request(app).get("/api/referral").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.referralCode).toMatch(/^[0-9A-F]{8}$/);
    expect(res.body.referralUrl).toContain(res.body.referralCode);
    expect(res.body.totalReferred).toBe(0);
  });

  it("renvoie le même code à un second appel", async () => {
    const manager = await createManager();

    const premier = await request(app).get("/api/referral").set(authHeader(tokenFor(manager)));
    const second = await request(app).get("/api/referral").set(authHeader(tokenFor(manager)));

    expect(second.body.referralCode).toBe(premier.body.referralCode);
  });

  it("compte les filleuls, confirmés ou non", async () => {
    const manager = await createManager();
    await createManager({ referredByUserId: manager.id });
    await createManager({ referredByUserId: manager.id, referralRewardGrantedAt: new Date() });

    const res = await request(app).get("/api/referral").set(authHeader(tokenFor(manager)));

    expect(res.body.totalReferred).toBe(2);
  });

  it("reste accessible à un gestionnaire dont l'essai est expiré (pas de requireActiveSubscription)", async () => {
    const manager = await createManager({
      subscriptionStatus: "TRIAL",
      trialEndsAt: new Date(Date.now() - 86_400_000), // essai déjà expiré
    });

    const res = await request(app).get("/api/referral").set(authHeader(tokenFor(manager)));

    // Pas de requireActiveSubscription sur cette route : un essai expiré doit
    // quand même pouvoir consulter son code pour s'en sortir en parrainant.
    expect(res.status).toBe(200);
  });
});

describe("POST /api/auth/register — rattachement au parrain", () => {
  it("rattache le nouveau compte au parrain quand le code est valide", async () => {
    const parrain = await createManager();
    const code = (await request(app).get("/api/referral").set(authHeader(tokenFor(parrain)))).body.referralCode;

    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "filleul@test.local", password: "Password123!", referralCode: code });

    expect(res.status).toBe(201);
    const [filleul] = await testDb.select().from(users).where(eq(users.email, "filleul@test.local"));
    expect(filleul.referredByUserId).toBe(parrain.id);
  });

  it("ignore en silence un code de parrainage inconnu", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "sanscode@test.local", password: "Password123!", referralCode: "DEADBEEF" });

    expect(res.status).toBe(201);
    const [filleul] = await testDb.select().from(users).where(eq(users.email, "sanscode@test.local"));
    expect(filleul.referredByUserId).toBeNull();
  });

  it("ignore le code de parrainage d'un collaborateur (teamOwnerId non nul)", async () => {
    const proprietaire = await createManager();
    const collaborateur = await createManager({ teamOwnerId: proprietaire.id, referralCode: "ABCD1234" });
    void collaborateur;

    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "viacollab@test.local", password: "Password123!", referralCode: "ABCD1234" });

    expect(res.status).toBe(201);
    const [filleul] = await testDb.select().from(users).where(eq(users.email, "viacollab@test.local"));
    expect(filleul.referredByUserId).toBeNull();
  });
});

describe("POST /api/auth/verify-email — programme de parrainage", () => {
  /** Crée un filleul directement en base, prêt à confirmer son email via le token fourni. */
  async function createFilleulEnAttente(rawToken: string, overrides: Partial<typeof users.$inferInsert> = {}) {
    return createManager({
      emailVerifiedAt: null,
      emailVerificationTokenHash: hashToken(rawToken),
      emailVerificationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      ...overrides,
    });
  }

  it("confirme l'email et prolonge l'essai du parrain de REFERRAL_REWARD_DAYS jours", async () => {
    const trialEndsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const parrain = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt });
    const rawToken = "token-parrainage-essai";
    await createFilleulEnAttente(rawToken, { referredByUserId: parrain.id });

    const res = await request(app).post("/api/auth/verify-email").send({ token: rawToken });

    expect(res.status).toBe(200);
    const [parrainApres] = await testDb.select().from(users).where(eq(users.id, parrain.id));
    expect(parrainApres.trialEndsAt!.getTime()).toBe(trialEndsAt.getTime() + REFERRAL_REWARD_DAYS * 86_400_000);
  });

  it("prolonge l'abonnement du parrain ACTIVE plutôt que son essai", async () => {
    const subscriptionEndsAt = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    const parrain = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt, trialEndsAt: null });
    const rawToken = "token-parrainage-actif";
    await createFilleulEnAttente(rawToken, { referredByUserId: parrain.id });

    await request(app).post("/api/auth/verify-email").send({ token: rawToken });

    const [parrainApres] = await testDb.select().from(users).where(eq(users.id, parrain.id));
    expect(parrainApres.subscriptionEndsAt!.getTime()).toBe(subscriptionEndsAt.getTime() + REFERRAL_REWARD_DAYS * 86_400_000);
  });

  it("confirme normalement un compte sans parrain, sans erreur", async () => {
    const rawToken = "token-sans-parrain";
    await createFilleulEnAttente(rawToken, { referredByUserId: null });

    const res = await request(app).post("/api/auth/verify-email").send({ token: rawToken });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf("string");
  });
});
