import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { users } from "../db/schema";
import { genererCodeTotp } from "../services/totp.service";
import { authHeader, createManager, createTeamMember, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/** Enrôle et CONFIRME la 2FA pour ce compte, directement via les routes réelles. */
async function activerDeuxFa(token: string) {
  const setupRes = await request(app).post("/api/auth/2fa/setup").set(authHeader(token));
  expect(setupRes.status).toBe(200);
  const code = await genererCodeTotp(setupRes.body.secret);

  const confirmRes = await request(app).post("/api/auth/2fa/confirm").set(authHeader(token)).send({ code });
  expect(confirmRes.status).toBe(200);

  return { secret: setupRes.body.secret as string, backupCodes: confirmRes.body.backupCodes as string[] };
}

describe("POST /api/auth/2fa/setup puis /confirm — enrôlement", () => {
  it("génère un secret et une URL otpauth, puis active la 2FA une fois le bon code soumis", async () => {
    const manager = await createManager();

    const { secret, backupCodes } = await activerDeuxFa(tokenFor(manager));

    expect(secret).toMatch(/^[A-Z2-7]+$/); // base32
    expect(backupCodes).toHaveLength(8);

    const [row] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(row.totpEnabledAt).not.toBeNull();
    expect(row.totpBackupCodesHash).not.toBeNull();
  });

  it("refuse de confirmer avec un code incorrect, et n'active rien", async () => {
    const manager = await createManager();
    await request(app).post("/api/auth/2fa/setup").set(authHeader(tokenFor(manager)));

    const res = await request(app)
      .post("/api/auth/2fa/confirm")
      .set(authHeader(tokenFor(manager)))
      .send({ code: "000000" });

    expect(res.status).toBe(401);
    const [row] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(row.totpEnabledAt).toBeNull();
  });

  it("refuse de confirmer sans enrôlement préalable", async () => {
    const manager = await createManager();
    const res = await request(app).post("/api/auth/2fa/confirm").set(authHeader(tokenFor(manager))).send({ code: "123456" });
    expect(res.status).toBe(400);
  });

  it("refuse un nouvel enrôlement quand la 2FA est déjà active", async () => {
    const manager = await createManager();
    await activerDeuxFa(tokenFor(manager));

    const res = await request(app).post("/api/auth/2fa/setup").set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(409);
  });
});

describe("Connexion avec la 2FA activée", () => {
  it("bloque la connexion directe : login() ne renvoie qu'un jeton intermédiaire, sans cookie ni accès", async () => {
    const manager = await createManager({ email: "2fa-login@test.local" });
    await activerDeuxFa(tokenFor(manager));

    const loginRes = await request(app).post("/api/auth/login").send({ email: "2fa-login@test.local", password: "Password123!" });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.twoFactorRequired).toBe(true);
    expect(loginRes.body.pendingToken).toBeDefined();
    expect(loginRes.body.token).toBeUndefined();
    expect(loginRes.body.user).toBeUndefined();
  });

  it("complète la connexion avec le bon code TOTP", async () => {
    const manager = await createManager({ email: "2fa-ok@test.local" });
    const { secret } = await activerDeuxFa(tokenFor(manager));

    const loginRes = await request(app).post("/api/auth/login").send({ email: "2fa-ok@test.local", password: "Password123!" });
    const code = await genererCodeTotp(secret);

    const verifyRes = await request(app)
      .post("/api/auth/2fa/verify-login")
      .send({ pendingToken: loginRes.body.pendingToken, code });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.token).toBeDefined();
    expect(verifyRes.body.user.email).toBe("2fa-ok@test.local");

    const meRes = await request(app).get("/api/auth/me").set(authHeader(verifyRes.body.token));
    expect(meRes.status).toBe(200);
    expect(meRes.body.twoFactorEnabled).toBe(true);
  });

  it("refuse un code TOTP incorrect", async () => {
    const manager = await createManager({ email: "2fa-bad@test.local" });
    await activerDeuxFa(tokenFor(manager));

    const loginRes = await request(app).post("/api/auth/login").send({ email: "2fa-bad@test.local", password: "Password123!" });
    const verifyRes = await request(app)
      .post("/api/auth/2fa/verify-login")
      .send({ pendingToken: loginRes.body.pendingToken, code: "000000" });

    expect(verifyRes.status).toBe(401);
  });

  it("accepte un code de secours à la place du code TOTP, et le consomme (inutilisable une seconde fois)", async () => {
    const manager = await createManager({ email: "2fa-backup@test.local" });
    const { backupCodes } = await activerDeuxFa(tokenFor(manager));

    const loginRes1 = await request(app).post("/api/auth/login").send({ email: "2fa-backup@test.local", password: "Password123!" });
    const verifyRes1 = await request(app)
      .post("/api/auth/2fa/verify-login")
      .send({ pendingToken: loginRes1.body.pendingToken, code: backupCodes[0] });
    expect(verifyRes1.status).toBe(200);

    const loginRes2 = await request(app).post("/api/auth/login").send({ email: "2fa-backup@test.local", password: "Password123!" });
    const verifyRes2 = await request(app)
      .post("/api/auth/2fa/verify-login")
      .send({ pendingToken: loginRes2.body.pendingToken, code: backupCodes[0] });
    expect(verifyRes2.status).toBe(401);
  });

  it("refuse un pendingToken forgé (mauvaise signature)", async () => {
    const res = await request(app)
      .post("/api/auth/2fa/verify-login")
      .send({ pendingToken: "ceci-nest-pas-un-jwt-valide", code: "123456" });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/2fa/disable", () => {
  it("désactive la 2FA après vérification du mot de passe, et la connexion redevient directe", async () => {
    const manager = await createManager({ email: "2fa-disable@test.local" });
    await activerDeuxFa(tokenFor(manager));

    const disableRes = await request(app)
      .post("/api/auth/2fa/disable")
      .set(authHeader(tokenFor(manager)))
      .send({ password: "Password123!" });
    expect(disableRes.status).toBe(200);

    const [row] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(row.totpEnabledAt).toBeNull();
    expect(row.totpSecret).toBeNull();
    expect(row.totpBackupCodesHash).toBeNull();

    const loginRes = await request(app).post("/api/auth/login").send({ email: "2fa-disable@test.local", password: "Password123!" });
    expect(loginRes.body.twoFactorRequired).toBeUndefined();
    expect(loginRes.body.token).toBeDefined();
  });

  it("refuse avec un mauvais mot de passe, et laisse la 2FA active", async () => {
    const manager = await createManager();
    await activerDeuxFa(tokenFor(manager));

    const res = await request(app).post("/api/auth/2fa/disable").set(authHeader(tokenFor(manager))).send({ password: "mauvais" });
    expect(res.status).toBe(401);

    const [row] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(row.totpEnabledAt).not.toBeNull();
  });

  it("refuse si la 2FA n'est pas activée", async () => {
    const manager = await createManager();
    const res = await request(app).post("/api/auth/2fa/disable").set(authHeader(tokenFor(manager))).send({ password: "Password123!" });
    expect(res.status).toBe(409);
  });
});

/**
 * Un collaborateur (voir team.controller.ts) a son propre login, mais son
 * jeton porte l'id du PROPRIÉTAIRE de l'agence pour le reste de
 * l'application (identiteJetonPourManager). La 2FA, elle, protège un LOGIN :
 * elle doit rester rattachée au compte qui saisit réellement l'email/mot de
 * passe — jamais se confondre avec celle du propriétaire.
 */
describe("2FA et comptes collaborateurs (multi-utilisateurs)", () => {
  it("un collaborateur qui active sa 2FA ne touche pas le compte du propriétaire", async () => {
    const manager = await createManager();
    const collaborateur = await createTeamMember(manager.id, { email: "collab-2fa@test.local" });

    const loginRes = await request(app).post("/api/auth/login").send({ email: "collab-2fa@test.local", password: "Password123!" });
    await activerDeuxFa(loginRes.body.token);

    const [ownerRow] = await testDb.select().from(users).where(eq(users.id, manager.id));
    const [collabRow] = await testDb.select().from(users).where(eq(users.id, collaborateur.id));
    expect(ownerRow.totpEnabledAt).toBeNull();
    expect(collabRow.totpEnabledAt).not.toBeNull();
  });

  it("la connexion du propriétaire n'exige pas la 2FA activée par son collaborateur, et réciproquement", async () => {
    const manager = await createManager({ email: "owner-no2fa@test.local" });
    const collaborateur = await createTeamMember(manager.id, { email: "collab-only2fa@test.local" });

    const collabLogin = await request(app).post("/api/auth/login").send({ email: "collab-only2fa@test.local", password: "Password123!" });
    await activerDeuxFa(collabLogin.body.token);

    const ownerLogin = await request(app).post("/api/auth/login").send({ email: "owner-no2fa@test.local", password: "Password123!" });
    expect(ownerLogin.body.twoFactorRequired).toBeUndefined();
    expect(ownerLogin.body.token).toBeDefined();
  });
});
