import crypto from "crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { users } from "../db/schema";
import { chiffrerSecretTotp, secretTotpEstChiffre } from "../services/secretTotpChiffre";
import { genererCodeTotp, genererSecretTotp } from "../services/totp.service";
import { authHeader, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Le secret TOTP est stocké chiffré (voir services/secretTotpChiffre.ts) et la double authentification fonctionne comme
 * avant, de l'enrôlement à la connexion. Un compte enrôlé avant le chiffrement (secret en clair) continue de se connecter,
 * et son secret est chiffré à cette occasion.
 */
const PASSWORD = "Password123!";
const lireSecret = async (id: string) => (await testDb.select().from(users).where(eq(users.id, id)))[0].totpSecret;
const connexion = (email: string) => request(app).post("/api/auth/login").send({ email, password: PASSWORD });
const verifier = (pendingToken: string, code: string) => request(app).post("/api/auth/2fa/verify-login").send({ pendingToken, code });

describe("double authentification avec un secret chiffré", () => {
  const avant = env.totpEncryptionKey;
  beforeEach(() => {
    env.totpEncryptionKey = crypto.randomBytes(32);
  });
  afterEach(() => {
    env.totpEncryptionKey = avant;
  });

  it("l'enrôlement stocke le secret chiffré, renvoie le secret en clair pour le QR code, et la confirmation fonctionne", async () => {
    const manager = await createManager({ email: "chiffre-1@test.local" });
    const token = tokenFor(manager);

    const setup = await request(app).post("/api/auth/2fa/setup").set(authHeader(token));
    expect(setup.status).toBe(200);
    expect(setup.body.secret).toMatch(/^[A-Z2-7]+$/);
    expect(setup.body.otpauthUrl).toContain(setup.body.secret);

    const stocke = await lireSecret(manager.id);
    expect(secretTotpEstChiffre(stocke!)).toBe(true);
    expect(stocke).not.toContain(setup.body.secret);

    const confirm = await request(app).post("/api/auth/2fa/confirm").set(authHeader(token)).send({ code: await genererCodeTotp(setup.body.secret) });
    expect(confirm.status).toBe(200);
  });

  it("la connexion en deux étapes marche avec un secret chiffré", async () => {
    const manager = await createManager({ email: "chiffre-2@test.local" });
    const token = tokenFor(manager);
    const setup = await request(app).post("/api/auth/2fa/setup").set(authHeader(token));
    await request(app).post("/api/auth/2fa/confirm").set(authHeader(token)).send({ code: await genererCodeTotp(setup.body.secret) });

    const etape1 = await connexion("chiffre-2@test.local");
    expect(etape1.body.pendingToken).toBeDefined();
    const etape2 = await verifier(etape1.body.pendingToken, await genererCodeTotp(setup.body.secret));
    expect(etape2.status).toBe(200);
  });

  it("un compte enrôlé avant le chiffrement (secret en clair) se connecte, et son secret est chiffré à cette occasion", async () => {
    const secret = genererSecretTotp();
    const manager = await createManager({ email: "ancien@test.local", totpSecret: secret, totpEnabledAt: new Date(), totpBackupCodesHash: "[]" });
    expect(await lireSecret(manager.id)).toBe(secret);

    const etape1 = await connexion("ancien@test.local");
    const etape2 = await verifier(etape1.body.pendingToken, await genererCodeTotp(secret));
    expect(etape2.status).toBe(200);

    const apres = await lireSecret(manager.id);
    expect(secretTotpEstChiffre(apres!)).toBe(true);
    expect(apres).not.toContain(secret);

    // Et il continue de se connecter ensuite (lecture du secret chiffré).
    const etape1bis = await connexion("ancien@test.local");
    expect(etape1bis.body.pendingToken).toBeDefined();
  });

  it("un code faux ne chiffre rien et ne connecte pas", async () => {
    const secret = genererSecretTotp();
    const manager = await createManager({ email: "faux@test.local", totpSecret: secret, totpEnabledAt: new Date(), totpBackupCodesHash: "[]" });
    const etape1 = await connexion("faux@test.local");
    const etape2 = await verifier(etape1.body.pendingToken, "000000");
    expect(etape2.status).toBe(401);
    expect(await lireSecret(manager.id)).toBe(secret);
  });

  it("la régénération des codes de secours lit aussi le secret chiffré", async () => {
    const secret = genererSecretTotp();
    const manager = await createManager({ email: "regen@test.local", totpSecret: chiffrerSecretTotp(secret), totpEnabledAt: new Date(), totpBackupCodesHash: "[]" });
    const res = await request(app).post("/api/auth/2fa/backup-codes/regenerate").set(authHeader(tokenFor(manager))).send({ code: await genererCodeTotp(secret) });
    expect(res.status).toBe(200);
  });
});

describe("sans clé de chiffrement (comme avant)", () => {
  it("l'enrôlement stocke le secret en clair et tout fonctionne", async () => {
    const avant = env.totpEncryptionKey;
    env.totpEncryptionKey = null;
    try {
      const manager = await createManager({ email: "sans-cle@test.local" });
      const setup = await request(app).post("/api/auth/2fa/setup").set(authHeader(tokenFor(manager)));
      expect(setup.status).toBe(200);
      expect(await lireSecret(manager.id)).toBe(setup.body.secret);
    } finally {
      env.totpEncryptionKey = avant;
    }
  });
});
