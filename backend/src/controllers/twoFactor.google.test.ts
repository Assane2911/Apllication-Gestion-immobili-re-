import { eq } from "drizzle-orm";
import { OAuth2Client } from "google-auth-library";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { users } from "../db/schema";
import { genererCodeTotp } from "../services/totp.service";
import { authHeader, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Désactiver la double authentification d'un compte qui s'est inscrit avec Google (sans mot de passe à ressaisir).
 *
 * Pour un compte avec mot de passe, retirer la 2FA exige le mot de passe ET un code du second facteur. Pour un compte Google
 * seul, le mot de passe est remplacé par une confirmation Google fraîche : c'est la branche qu'un jeton de session volé
 * viserait pour annuler la protection du téléphone. Aucun test ne l'exerçait : un refus oublié ici aurait laissé ce geste
 * ouvert sans que rien ne le signale.
 */

// google-auth-library est mocké comme dans auth.controller.google.test.ts : pas de réseau, pas de vrai jeton Google.
vi.mock("google-auth-library", () => {
  const verifyIdToken = vi.fn();
  return {
    OAuth2Client: vi.fn().mockImplementation(function () {
      return { verifyIdToken };
    }),
  };
});

const mockVerifyIdToken = vi.mocked(OAuth2Client).mock.results[0]!.value.verifyIdToken as ReturnType<typeof vi.fn>;

const GOOGLE_ID = "google-sub-2fa-compte";

function mockGooglePayload(payload: Record<string, unknown> | undefined) {
  mockVerifyIdToken.mockResolvedValue({ getPayload: () => payload });
}

/** Un compte inscrit avec Google : pas de mot de passe connu de lui. */
async function createGoogleOnlyManager() {
  return createManager({ hasPassword: false, googleId: GOOGLE_ID });
}

/** Enrôle et CONFIRME la 2FA par les routes réelles. */
async function activerDeuxFa(token: string) {
  const setupRes = await request(app).post("/api/auth/2fa/setup").set(authHeader(token));
  expect(setupRes.status).toBe(200);
  const confirmRes = await request(app)
    .post("/api/auth/2fa/confirm")
    .set(authHeader(token))
    .send({ code: await genererCodeTotp(setupRes.body.secret) });
  expect(confirmRes.status).toBe(200);
  return { backupCodes: confirmRes.body.backupCodes as string[] };
}

const deuxFaActive = async (id: string) => {
  const [row] = await testDb.select().from(users).where(eq(users.id, id));
  return row.totpEnabledAt !== null;
};

describe("POST /api/auth/2fa/disable : compte Google seul", () => {
  beforeEach(() => {
    env.googleClientId = "test-google-client-id";
  });

  afterEach(() => {
    mockVerifyIdToken.mockReset();
    env.googleClientId = "";
  });

  it("répond 503 quand la connexion Google n'est pas configurée sur le serveur, et laisse la 2FA active", async () => {
    const manager = await createGoogleOnlyManager();
    const { backupCodes } = await activerDeuxFa(tokenFor(manager));
    env.googleClientId = "";

    const res = await request(app)
      .post("/api/auth/2fa/disable")
      .set(authHeader(tokenFor(manager)))
      .send({ googleCredential: "jeton", code: backupCodes[0] });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("GOOGLE_NOT_CONFIGURED");
    expect(await deuxFaActive(manager.id)).toBe(true);
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it("exige une confirmation Google : sans elle, 400, et la 2FA reste active", async () => {
    const manager = await createGoogleOnlyManager();
    const { backupCodes } = await activerDeuxFa(tokenFor(manager));

    const res = await request(app).post("/api/auth/2fa/disable").set(authHeader(tokenFor(manager))).send({ code: backupCodes[0] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("GOOGLE_CONFIRMATION_REQUIRED");
    expect(await deuxFaActive(manager.id)).toBe(true);
  });

  it("refuse un jeton Google invalide ou expiré, et la 2FA reste active", async () => {
    const manager = await createGoogleOnlyManager();
    const { backupCodes } = await activerDeuxFa(tokenFor(manager));
    mockVerifyIdToken.mockRejectedValue(new Error("Token used too late"));

    const res = await request(app)
      .post("/api/auth/2fa/disable")
      .set(authHeader(tokenFor(manager)))
      .send({ googleCredential: "jeton-expire", code: backupCodes[0] });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("GOOGLE_TOKEN_INVALID_OR_EXPIRED");
    expect(await deuxFaActive(manager.id)).toBe(true);
  });

  it("refuse un jeton Google valide d'un AUTRE compte Google, et la 2FA reste active", async () => {
    const manager = await createGoogleOnlyManager();
    const { backupCodes } = await activerDeuxFa(tokenFor(manager));
    mockGooglePayload({ sub: "google-sub-dun-autre-compte", email: manager.email, email_verified: true });

    const res = await request(app)
      .post("/api/auth/2fa/disable")
      .set(authHeader(tokenFor(manager)))
      .send({ googleCredential: "jeton-dun-autre", code: backupCodes[0] });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("GOOGLE_TOKEN_INVALID");
    expect(await deuxFaActive(manager.id)).toBe(true);
  });

  it("refuse un jeton Google dont l'adresse n'est pas vérifiée, et la 2FA reste active", async () => {
    const manager = await createGoogleOnlyManager();
    const { backupCodes } = await activerDeuxFa(tokenFor(manager));
    mockGooglePayload({ sub: GOOGLE_ID, email: manager.email, email_verified: false });

    const res = await request(app)
      .post("/api/auth/2fa/disable")
      .set(authHeader(tokenFor(manager)))
      .send({ googleCredential: "jeton-non-verifie", code: backupCodes[0] });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("GOOGLE_TOKEN_INVALID");
    expect(await deuxFaActive(manager.id)).toBe(true);
  });

  it("refuse un jeton Google sans contenu lisible, et la 2FA reste active", async () => {
    const manager = await createGoogleOnlyManager();
    const { backupCodes } = await activerDeuxFa(tokenFor(manager));
    mockGooglePayload(undefined);

    const res = await request(app)
      .post("/api/auth/2fa/disable")
      .set(authHeader(tokenFor(manager)))
      .send({ googleCredential: "jeton-vide", code: backupCodes[0] });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("GOOGLE_TOKEN_INVALID");
    expect(await deuxFaActive(manager.id)).toBe(true);
  });

  it("la confirmation Google seule ne suffit pas : sans code du second facteur, 400, et la 2FA reste active", async () => {
    const manager = await createGoogleOnlyManager();
    await activerDeuxFa(tokenFor(manager));
    mockGooglePayload({ sub: GOOGLE_ID, email: manager.email, email_verified: true });

    const res = await request(app)
      .post("/api/auth/2fa/disable")
      .set(authHeader(tokenFor(manager)))
      .send({ googleCredential: "jeton-valide" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TWO_FACTOR_CODE_INVALID");
    expect(await deuxFaActive(manager.id)).toBe(true);
  });

  it("la confirmation Google plus un mauvais code : 401, et la 2FA reste active", async () => {
    const manager = await createGoogleOnlyManager();
    await activerDeuxFa(tokenFor(manager));
    mockGooglePayload({ sub: GOOGLE_ID, email: manager.email, email_verified: true });

    const res = await request(app)
      .post("/api/auth/2fa/disable")
      .set(authHeader(tokenFor(manager)))
      .send({ googleCredential: "jeton-valide", code: "000000" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TWO_FACTOR_CODE_INVALID");
    expect(await deuxFaActive(manager.id)).toBe(true);
  });

  it("retire la 2FA quand la confirmation Google est fraîche ET qu'un code de secours valide est fourni", async () => {
    const manager = await createGoogleOnlyManager();
    const { backupCodes } = await activerDeuxFa(tokenFor(manager));
    mockGooglePayload({ sub: GOOGLE_ID, email: manager.email, email_verified: true });

    const res = await request(app)
      .post("/api/auth/2fa/disable")
      .set(authHeader(tokenFor(manager)))
      .send({ googleCredential: "jeton-valide", code: backupCodes[0] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const [row] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(row.totpEnabledAt).toBeNull();
    expect(row.totpSecret).toBeNull();
    expect(row.totpBackupCodesHash).toBeNull();
  });
});
