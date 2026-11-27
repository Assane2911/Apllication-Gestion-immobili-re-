import { and, eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { activityLogs, users } from "../db/schema";
import { genererCodeTotp } from "../services/totp.service";
import { authHeader, createManager, createPortalUser, createTeamMember, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Audit par sabotage de twoFactor.controller.ts : les gestes qui protègent un LOGIN (enrôler, confirmer, retirer, régénérer les
 * codes de secours) et ce qu'ils laissent derrière eux — l'état du compte, et la trace dans le journal d'activité.
 */
const PASSWORD = "Password123!";

const setup = (token: string) => request(app).post("/api/auth/2fa/setup").set(authHeader(token));
const confirmer = (token: string, code: string) => request(app).post("/api/auth/2fa/confirm").set(authHeader(token)).send({ code });
const desactiver = (token: string, corps: Record<string, unknown>) => request(app).post("/api/auth/2fa/disable").set(authHeader(token)).send(corps);
const regenerer = (token: string, code: string) => request(app).post("/api/auth/2fa/backup-codes/regenerate").set(authHeader(token)).send({ code });

async function ligne(id: string) {
  const [row] = await testDb.select().from(users).where(eq(users.id, id));
  return row;
}

/** Enrôle ET confirme la 2FA du compte ; renvoie le jeton, le secret et les codes de secours. */
async function compteAvecDeuxFa(overrides: Parameters<typeof createManager>[0] = {}) {
  const manager = await createManager(overrides);
  const token = tokenFor(manager);
  const amorce = await setup(token);
  expect(amorce.status).toBe(200);
  const res = await confirmer(token, await genererCodeTotp(amorce.body.secret));
  expect(res.status).toBe(200);
  return { manager, token, secret: amorce.body.secret as string, backupCodes: res.body.backupCodes as string[] };
}

async function journal(action: string, entityId: string) {
  return testDb
    .select()
    .from(activityLogs)
    .where(and(eq(activityLogs.action, action), eq(activityLogs.entityId, entityId)));
}

describe("enrôlement : setup", () => {
  it("renvoie le secret, l'URL otpauth au nom du compte et un QR code, sans rien activer", async () => {
    const manager = await createManager({ email: "setup-forme@test.local" });
    const res = await setup(tokenFor(manager));

    expect(res.status).toBe(200);
    expect(res.body.secret).toMatch(/^[A-Z2-7]{16,}$/);
    expect(res.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(decodeURIComponent(res.body.otpauthUrl)).toContain("setup-forme@test.local");
    expect(res.body.otpauthUrl).toContain(res.body.secret);
    expect(res.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);

    const row = await ligne(manager.id);
    expect(row.totpSecret).not.toBeNull();
    expect(row.totpEnabledAt).toBeNull(); // rien n'est exigé à la connexion avant la confirmation
    expect(row.totpBackupCodesHash).toBeNull();
  });

  it("un second appel avant confirmation remplace le secret : l'ancien code ne confirme plus rien", async () => {
    const manager = await createManager();
    const token = tokenFor(manager);
    const premier = await setup(token);
    const second = await setup(token);
    expect(second.body.secret).not.toBe(premier.body.secret);

    // Le code de l'ancien secret est refusé… (le code du nouveau a une chance sur un million d'être identique)
    const ancien = await confirmer(token, await genererCodeTotp(premier.body.secret));
    expect(ancien.status).toBe(401);
    expect((await ligne(manager.id)).totpEnabledAt).toBeNull();

    // … et celui du nouveau est accepté.
    expect((await confirmer(token, await genererCodeTotp(second.body.secret))).status).toBe(200);
  });
});

describe("enrôlement : confirm", () => {
  it.each(["12345", "1234567", "abcdef", "12 456", "", "１２３４５６"])("refuse le code mal formé %j sans rien activer", async (code) => {
    const manager = await createManager();
    const token = tokenFor(manager);
    await setup(token);

    const res = await confirmer(token, code);
    expect(res.status).toBe(400);
    expect((await ligne(manager.id)).totpEnabledAt).toBeNull();
  });

  it("refuse sans enrôlement préalable avec le code TWO_FACTOR_NO_ENROLLMENT", async () => {
    const manager = await createManager();
    const res = await confirmer(tokenFor(manager), "123456");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TWO_FACTOR_NO_ENROLLMENT");
  });

  it("refuse un code faux avec le code TWO_FACTOR_SETUP_CODE_INVALID, sans générer de codes de secours", async () => {
    const manager = await createManager();
    const token = tokenFor(manager);
    await setup(token);

    const res = await confirmer(token, "000000");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TWO_FACTOR_SETUP_CODE_INVALID");
    expect(res.body.backupCodes).toBeUndefined();
    const row = await ligne(manager.id);
    expect(row.totpBackupCodesHash).toBeNull();
    expect(row.totpEnabledAt).toBeNull();
  });

  it("refuse de confirmer une 2FA déjà active (409) : les codes de secours ne sont pas remplacés", async () => {
    const { manager, token, secret } = await compteAvecDeuxFa();
    const avant = (await ligne(manager.id)).totpBackupCodesHash;

    const res = await confirmer(token, await genererCodeTotp(secret));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TWO_FACTOR_ALREADY_ENABLED");
    expect(res.body.backupCodes).toBeUndefined();
    expect((await ligne(manager.id)).totpBackupCodesHash).toBe(avant);
  });

  it("n'enregistre que des empreintes : huit codes de secours en clair à la réponse, aucun en base", async () => {
    const { manager, backupCodes } = await compteAvecDeuxFa();
    expect(backupCodes).toHaveLength(8);
    expect(new Set(backupCodes).size).toBe(8);

    const row = await ligne(manager.id);
    const hashes = JSON.parse(row.totpBackupCodesHash!) as string[];
    expect(hashes).toHaveLength(8);
    for (const code of backupCodes) expect(row.totpBackupCodesHash).not.toContain(code);
  });

  it("active la 2FA à la date du jour et la journalise au nom du compte", async () => {
    const avant = Date.now();
    const { manager } = await compteAvecDeuxFa();
    const row = await ligne(manager.id);
    expect(row.totpEnabledAt!.getTime()).toBeGreaterThanOrEqual(avant - 1000);
    expect(row.totpEnabledAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);

    const [trace] = await journal("account.2fa_enable", manager.id);
    expect(trace).toBeDefined();
    expect(trace.managerId).toBe(manager.id);
    expect(trace.entityType).toBe("account");
    expect(trace.entityLabel).toBe(manager.email);
  });
});

describe("désactivation : disable", () => {
  it("exige le mot de passe d'un compte qui en a un : sans lui, 400 PASSWORD_REQUIRED et la 2FA reste active", async () => {
    const { manager, token, backupCodes } = await compteAvecDeuxFa();

    const res = await desactiver(token, { code: backupCodes[0] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASSWORD_REQUIRED");
    expect((await ligne(manager.id)).totpEnabledAt).not.toBeNull();
  });

  it("efface les trois colonnes de la 2FA et journalise la désactivation", async () => {
    const { manager, token, backupCodes } = await compteAvecDeuxFa();

    const res = await desactiver(token, { password: PASSWORD, code: backupCodes[0] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const row = await ligne(manager.id);
    expect(row.totpSecret).toBeNull();
    expect(row.totpEnabledAt).toBeNull();
    expect(row.totpBackupCodesHash).toBeNull();

    const [trace] = await journal("account.2fa_disable", manager.id);
    expect(trace).toBeDefined();
    expect(trace.entityLabel).toBe(manager.email);
  });

  it("un refus ne laisse aucune trace de désactivation dans le journal", async () => {
    const { manager, token } = await compteAvecDeuxFa();
    expect((await desactiver(token, { password: PASSWORD, code: "000000" })).status).toBe(401);
    expect(await journal("account.2fa_disable", manager.id)).toHaveLength(0);
  });

  it("le code TOTP courant du téléphone suffit (pas seulement un code de secours)", async () => {
    const { manager, token, secret } = await compteAvecDeuxFa();
    const res = await desactiver(token, { password: PASSWORD, code: await genererCodeTotp(secret) });
    expect(res.status).toBe(200);
    expect((await ligne(manager.id)).totpEnabledAt).toBeNull();
  });

  it("un refus pour mot de passe ne brûle pas le code de secours : il sert ensuite avec le bon mot de passe", async () => {
    const { manager, token, backupCodes } = await compteAvecDeuxFa();
    const hashAvant = (await ligne(manager.id)).totpBackupCodesHash;

    expect((await desactiver(token, { password: "mauvais", code: backupCodes[1] })).status).toBe(401);
    expect((await ligne(manager.id)).totpBackupCodesHash).toBe(hashAvant);

    expect((await desactiver(token, { password: PASSWORD, code: backupCodes[1] })).status).toBe(200);
    expect((await ligne(manager.id)).totpEnabledAt).toBeNull();
  });
});

describe("régénération des codes de secours", () => {
  it("refuse quand la 2FA n'est pas activée (409 TWO_FACTOR_NOT_ENABLED)", async () => {
    const manager = await createManager();
    const res = await regenerer(tokenFor(manager), "123456");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TWO_FACTOR_NOT_ENABLED");
  });

  it("refuse un enrôlement non confirmé : un secret en attente ne vaut pas 2FA activée", async () => {
    const manager = await createManager();
    const token = tokenFor(manager);
    const amorce = await setup(token);
    const res = await regenerer(token, await genererCodeTotp(amorce.body.secret));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TWO_FACTOR_NOT_ENABLED");
  });

  it.each(["12345", "1234567", "abcdef", ""])("refuse le code mal formé %j (400)", async (code) => {
    const { token } = await compteAvecDeuxFa();
    expect((await regenerer(token, code)).status).toBe(400);
  });

  it("refuse un code faux (401 TWO_FACTOR_CODE_WRONG) sans toucher aux codes de secours", async () => {
    const { manager, token } = await compteAvecDeuxFa();
    const avant = (await ligne(manager.id)).totpBackupCodesHash;

    const res = await regenerer(token, "000000");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TWO_FACTOR_CODE_WRONG");
    expect((await ligne(manager.id)).totpBackupCodesHash).toBe(avant);
    expect(await journal("account.2fa_backup_codes_regenerate", manager.id)).toHaveLength(0);
  });

  it("un code de secours n'est pas accepté ici : il faut le code de l'application", async () => {
    const { token, backupCodes } = await compteAvecDeuxFa();
    expect((await regenerer(token, backupCodes[0])).status).toBe(400); // ni 6 chiffres ni valide
  });

  it("remplace les huit codes : les anciens cessent de fonctionner à la connexion, les nouveaux fonctionnent, et le geste est journalisé", async () => {
    const { manager, token, secret, backupCodes: anciens } = await compteAvecDeuxFa();
    const avant = (await ligne(manager.id)).totpBackupCodesHash;

    const res = await regenerer(token, await genererCodeTotp(secret));
    expect(res.status).toBe(200);
    const nouveaux = res.body.backupCodes as string[];
    expect(nouveaux).toHaveLength(8);
    for (const code of nouveaux) expect(anciens).not.toContain(code);
    expect((await ligne(manager.id)).totpBackupCodesHash).not.toBe(avant);
    // La 2FA elle-même reste activée, avec le même secret.
    expect((await ligne(manager.id)).totpEnabledAt).not.toBeNull();

    const connexion = () => request(app).post("/api/auth/login").send({ email: manager.email, password: PASSWORD });
    const verifier = (pendingToken: string, code: string) => request(app).post("/api/auth/2fa/verify-login").send({ pendingToken, code });

    const p1 = await connexion();
    expect((await verifier(p1.body.pendingToken, anciens[0])).status).toBe(401);
    const p2 = await connexion();
    expect((await verifier(p2.body.pendingToken, nouveaux[0])).status).toBe(200);

    const [trace] = await journal("account.2fa_backup_codes_regenerate", manager.id);
    expect(trace).toBeDefined();
    expect(trace.entityLabel).toBe(manager.email);
  });
});

describe("compte connecté : accès et identité", () => {
  const routes = ["/api/auth/2fa/setup", "/api/auth/2fa/confirm", "/api/auth/2fa/disable", "/api/auth/2fa/backup-codes/regenerate"];

  it.each(routes)("%s exige une connexion (401 sans jeton)", async (route) => {
    expect((await request(app).post(route).send({})).status).toBe(401);
  });

  it.each(routes)("%s est réservée aux gestionnaires et administrateurs : un locataire reçoit 403", async (route) => {
    const locataire = await createPortalUser("TENANT");
    const res = await request(app).post(route).set(authHeader(tokenFor(locataire))).send({ code: "123456", password: PASSWORD });
    expect(res.status).toBe(403);
    expect((await ligne(locataire.id)).totpSecret).toBeNull();
  });

  it("un jeton dont le compte a été supprimé reçoit 401 et non une erreur serveur", async () => {
    const manager = await createManager();
    const token = tokenFor(manager);
    await testDb.delete(users).where(eq(users.id, manager.id));

    // Le refus vient déjà du middleware d'authentification ; la même garde existe dans le contrôleur pour la course
    // « compte supprimé entre l'authentification et la lecture », qu'une requête HTTP ne peut pas provoquer.
    const res = await setup(token);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("ACCOUNT_GONE");
    expect(res.body.secret).toBeUndefined();
  });

  it("un collaborateur est journalisé sous l'agence du propriétaire, mais l'entrée désigne SON compte", async () => {
    const proprietaire = await createManager();
    const collab = await createTeamMember(proprietaire.id, { email: "collab-audit-2fa@test.local" });
    const login = await request(app).post("/api/auth/login").send({ email: "collab-audit-2fa@test.local", password: PASSWORD });
    const token = login.body.token as string;

    const amorce = await setup(token);
    expect((await confirmer(token, await genererCodeTotp(amorce.body.secret))).status).toBe(200);

    const [trace] = await journal("account.2fa_enable", collab.id);
    expect(trace).toBeDefined();
    expect(trace.managerId).toBe(proprietaire.id);
    expect(trace.entityId).toBe(collab.id);
    expect(await journal("account.2fa_enable", proprietaire.id)).toHaveLength(0);
  });
});
