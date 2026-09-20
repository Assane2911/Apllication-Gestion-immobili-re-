import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { OAuth2Client } from "google-auth-library";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { users } from "../db/schema";
import { createManager } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

// google-auth-library est mocké : on ne veut pas dépendre du réseau ni d'un
// vrai jeton Google dans ces tests, seulement du comportement de
// loginWithGoogle une fois le jeton "vérifié". auth.controller.ts n'instancie
// OAuth2Client qu'une seule fois (singleton de module, voir googleClient) —
// on récupère donc ici le verifyIdToken de ce premier (et unique) appel au
// constructeur mocké, déjà survenu au moment où "../app" a été importé
// ci-dessus (résolution des imports ES avant tout code de ce fichier).
vi.mock("google-auth-library", () => {
  const verifyIdToken = vi.fn();
  return { OAuth2Client: vi.fn().mockImplementation(() => ({ verifyIdToken })) };
});

const mockVerifyIdToken = vi.mocked(OAuth2Client).mock.results[0]!.value.verifyIdToken as ReturnType<typeof vi.fn>;

function mockGooglePayload(payload: Record<string, unknown>) {
  mockVerifyIdToken.mockResolvedValue({ getPayload: () => payload });
}

describe("POST /api/auth/google", () => {
  beforeEach(() => {
    // GOOGLE_CLIENT_ID n'est pas renseigné dans l'environnement de test par
    // défaut (voir env.ts) : sans cette valeur, loginWithGoogle répond 503
    // avant même d'appeler verifyIdToken (voir le test dédié plus bas).
    env.googleClientId = "test-google-client-id";
  });

  afterEach(() => {
    mockVerifyIdToken.mockReset();
    env.googleClientId = "";
  });

  it("crée un nouveau compte gestionnaire (essai STARTER 15 jours, email déjà vérifié) à la première connexion Google", async () => {
    mockGooglePayload({
      sub: "google-sub-nouveau",
      email: "nouveau-google@test.local",
      email_verified: true,
    });

    const res = await request(app).post("/api/auth/google").send({ credential: "fake-id-token" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf("string");
    expect(res.body.user.email).toBe("nouveau-google@test.local");
    expect(res.body.user.role).toBe("MANAGER");
    expect(res.body.user.subscription.isTrialActive).toBe(true);

    const [row] = await testDb.select().from(users).where(eq(users.email, "nouveau-google@test.local"));
    expect(row.googleId).toBe("google-sub-nouveau");
    expect(row.emailVerifiedAt).not.toBeNull();
    expect(row.subscriptionPlan).toBe("STARTER");

    // /me fonctionne avec le token émis, comme pour un login classique.
    const meRes = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${res.body.token}`);
    expect(meRes.status).toBe(200);
  });

  it("ne crée pas de second compte : une deuxième connexion Google avec le même sub retrouve le compte via googleId", async () => {
    mockGooglePayload({ sub: "google-sub-repete", email: "repete@test.local", email_verified: true });
    const first = await request(app).post("/api/auth/google").send({ credential: "tok-1" });
    expect(first.status).toBe(200);

    // Même sub, mais adresse email différente à Google (ex. l'utilisateur a
    // changé d'adresse principale côté Google) : le compte doit être retrouvé
    // par googleId, pas recréé.
    mockGooglePayload({ sub: "google-sub-repete", email: "autre-adresse@test.local", email_verified: true });
    const second = await request(app).post("/api/auth/google").send({ credential: "tok-2" });
    expect(second.status).toBe(200);
    expect(second.body.user.id).toBe(first.body.user.id);
    expect(second.body.user.email).toBe("repete@test.local");

    const comptes = await testDb.select().from(users).where(eq(users.googleId, "google-sub-repete"));
    expect(comptes).toHaveLength(1);
  });

  it("associe googleId à un compte gestionnaire existant (créé par email/mot de passe) et confirme son email si nécessaire", async () => {
    const manager = await createManager({ email: "gestionnaire-existant@test.local", emailVerifiedAt: null });

    mockGooglePayload({
      sub: "google-sub-liaison",
      email: "gestionnaire-existant@test.local",
      email_verified: true,
    });

    const res = await request(app).post("/api/auth/google").send({ credential: "fake-id-token" });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(manager.id);

    const [row] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(row.googleId).toBe("google-sub-liaison");
    // L'inscription initiale n'avait jamais été confirmée (emailVerifiedAt:
    // null) : la preuve Google équivaut à cette confirmation.
    expect(row.emailVerifiedAt).not.toBeNull();
  });

  it("refuse la connexion Google pour un compte existant qui n'est pas un compte gestionnaire", async () => {
    // Compte "portail" (role TENANT) créé directement en base, avec la même
    // adresse que le compte Google du test — même principe qu'un compte
    // locataire réel invité par un gestionnaire.
    const passwordHash = await bcrypt.hash("Password123!", 10);
    await testDb.insert(users).values({
      email: "locataire-google@test.local",
      passwordHash,
      role: "TENANT",
      emailVerifiedAt: new Date(),
    });

    mockGooglePayload({ sub: "google-sub-locataire", email: "locataire-google@test.local", email_verified: true });

    const res = await request(app).post("/api/auth/google").send({ credential: "fake-id-token" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("GOOGLE_LOGIN_WRONG_ROLE");
  });

  it("refuse un jeton Google dont l'email n'est pas vérifié", async () => {
    mockGooglePayload({ sub: "google-sub-non-verifie", email: "non-verifie@test.local", email_verified: false });

    const res = await request(app).post("/api/auth/google").send({ credential: "fake-id-token" });

    expect(res.status).toBe(403);
  });

  it("refuse un jeton Google invalide ou expiré (verifyIdToken rejette)", async () => {
    mockVerifyIdToken.mockRejectedValue(new Error("Token used too late"));

    const res = await request(app).post("/api/auth/google").send({ credential: "jeton-invalide" });

    expect(res.status).toBe(401);
  });

  it("répond 503 tant que GOOGLE_CLIENT_ID n'est pas configuré côté serveur", async () => {
    env.googleClientId = "";
    mockGooglePayload({ sub: "peu-importe", email: "peu-importe@test.local", email_verified: true });

    const res = await request(app).post("/api/auth/google").send({ credential: "fake-id-token" });

    expect(res.status).toBe(503);
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });
});
