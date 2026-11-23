import * as Sentry from "@sentry/node";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { db } from "../db/client";
import { owners, tenants, users } from "../db/schema";
import * as emailService from "../services/email.service";
import { accountAlreadyExistsEmail, emailVerificationEmail, passwordResetEmail } from "../services/email.service";
import * as referral from "../services/referral.service";
import { chiffrerSecretTotp } from "../services/secretTotpChiffre";
import { genererCodeTotp, genererSecretTotp } from "../services/totp.service";
import {
  authHeader,
  createManager,
  createOwner,
  createOwnerPortalUser,
  createTeamMember,
  createTenant,
  createTenantPortalUser,
  tokenCollaborateur,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { deviseDuPays } from "../utils/pays";
import { hashToken, RESET_TOKEN_TTL_MS } from "../utils/token";

// Le reste de Sentry reste réel : l'application s'en sert au démarrage (setupExpressErrorHandler).
vi.mock("@sentry/node", async (importOriginal) => ({ ...(await importOriginal<typeof import("@sentry/node")>()), captureException: vi.fn() }));
vi.mock("google-auth-library", () => {
  const verifyIdToken = vi.fn();
  return {
    OAuth2Client: vi.fn().mockImplementation(function () {
      return { verifyIdToken };
    }),
  };
});
const verifierGoogle = vi.mocked(OAuth2Client).mock.results[0]!.value.verifyIdToken as ReturnType<typeof vi.fn>;

/**
 * Authentification (auth.controller.ts) : cas limites trouvés en sabotant le contrôleur, que les tests existants
 * laissaient passer. Limites des champs, durées de validité des liens et des jetons, contenu exact des e-mails,
 * réponses de connexion, déconnexion, rafraîchissement de session et suppression de compte.
 */
const PASSWORD = "Password123!";
const MINUTE = 60_000;
const HEURE = 60 * MINUTE;
const JOUR = 24 * HEURE;
const proche = (date: Date | null, attendu: number, tolerance = MINUTE) => date !== null && Math.abs(date.getTime() - attendu) < tolerance;
const ligne = async (id: string) => (await testDb.select().from(users).where(eq(users.id, id)))[0];
const VALIDATION = /^VALIDATION_ERROR/;
const decode = (jeton: string) => jwt.decode(jeton) as Record<string, unknown> & { exp: number; iat: number };
const jetonDuCookie = (res: request.Response) => {
  const brut = ((res.headers["set-cookie"] ?? []) as unknown as string[]).find((c) => c.startsWith("token="));
  if (!brut) throw new Error("aucun cookie de session");
  return brut.split(";")[0].slice("token=".length);
};

let envois: ReturnType<typeof vi.spyOn>;
const dernierEnvoi = () => {
  const appel = envois.mock.calls.at(-1) as unknown as [string, string, string] | undefined;
  if (!appel) throw new Error("aucun e-mail envoyé");
  return { a: appel[0], sujet: appel[1], html: appel[2] };
};
const jetonDuLien = (html: string, page: string) => {
  const trouve = new RegExp(`${page}\\?token=([^"&\\s<]+)`).exec(html);
  if (!trouve) throw new Error(`aucun lien ${page}`);
  return trouve[1];
};

beforeEach(() => {
  envois = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(Sentry.captureException).mockClear();
  verifierGoogle.mockReset();
  env.googleClientId = "";
});

describe("limites des champs", () => {
  const poster = (route: string, corps: unknown) => request(app).post(route).send(corps as object);

  it("code de parrainage : vide refusé, 64 caractères acceptés, 65 refusés (inscription)", async () => {
    const base = { country: "SN", password: PASSWORD };
    expect((await poster("/api/auth/register", { ...base, email: "parrain-vide@test.local", referralCode: "" })).status).toBe(400);
    expect((await poster("/api/auth/register", { ...base, email: "parrain-64@test.local", referralCode: "R".repeat(64) })).status).toBe(201);
    expect((await poster("/api/auth/register", { ...base, email: "parrain-65@test.local", referralCode: "R".repeat(65) })).status).toBe(400);
  });

  it("connexion Google : code de parrainage vide ou de 65 caractères refusé, jeton Google vide ou de 8193 caractères refusé", async () => {
    env.googleClientId = "test-google-client-id";
    verifierGoogle.mockRejectedValue(new Error("jeton refusé par Google"));

    expect((await poster("/api/auth/google", { credential: "jeton", referralCode: "" })).status).toBe(400);
    expect((await poster("/api/auth/google", { credential: "jeton", referralCode: "R".repeat(65) })).status).toBe(400);
    expect((await poster("/api/auth/google", { credential: "" })).status).toBe(400);
    expect((await poster("/api/auth/google", { credential: "j".repeat(8193) })).status).toBe(400);
    const limite = await poster("/api/auth/google", { credential: "j".repeat(8192) });
    expect(limite.status).toBe(401);
    expect(limite.body.code).toBe("GOOGLE_TOKEN_INVALID_OR_EXPIRED");
  });

  it("mot de passe de connexion : vide refusé, 1024 caractères acceptés (puis refusés comme faux), 1025 refusés", async () => {
    expect((await poster("/api/auth/login", { email: "limite@test.local", password: "" })).status).toBe(400);
    expect((await poster("/api/auth/login", { email: "limite@test.local", password: "P".repeat(1025) })).status).toBe(400);
    const limite = await poster("/api/auth/login", { email: "limite@test.local", password: "P".repeat(1024) });
    expect(limite.status).toBe(401);
    expect(limite.body.code).toBe("INVALID_CREDENTIALS");
  });

  it("deuxième étape de connexion : jeton intermédiaire vide ou de 2049 caractères, code de 5 ou 13 caractères refusés", async () => {
    const etape2 = (pendingToken: string, code: string) => poster("/api/auth/2fa/verify-login", { pendingToken, code });

    expect((await etape2("", "123456")).body.code).toMatch(VALIDATION);
    expect((await etape2("t".repeat(2049), "123456")).body.code).toMatch(VALIDATION);
    expect((await etape2("t".repeat(2048), "123456")).body.code).toBe("LOGIN_SESSION_EXPIRED");
    expect((await etape2("jeton", "12345")).body.code).toMatch(VALIDATION);
    expect((await etape2("jeton", "1".repeat(13))).body.code).toMatch(VALIDATION);
    expect((await etape2("jeton", "123456")).body.code).toBe("LOGIN_SESSION_EXPIRED");
    expect((await etape2("jeton", "1".repeat(12))).body.code).toBe("LOGIN_SESSION_EXPIRED");
  });

  it("jeton du lien de confirmation et de réinitialisation : vide ou de 513 caractères refusé comme une requête mal formée", async () => {
    const motDePasse = { password: PASSWORD };

    expect((await poster("/api/auth/verify-email", { token: "" })).body.code).toMatch(VALIDATION);
    expect((await poster("/api/auth/verify-email", { token: "t".repeat(513) })).body.code).toMatch(VALIDATION);
    expect((await poster("/api/auth/verify-email", { token: "t".repeat(512) })).body.code).toBe("EMAIL_LINK_INVALID");
    expect((await poster("/api/auth/reset-password", { token: "", ...motDePasse })).body.code).toMatch(VALIDATION);
    expect((await poster("/api/auth/reset-password", { token: "t".repeat(513), ...motDePasse })).body.code).toMatch(VALIDATION);
    expect((await poster("/api/auth/reset-password", { token: "t".repeat(512), ...motDePasse })).body.code).toBe("RESET_LINK_INVALID");
  });

  it("suppression du compte : mot de passe vide ou de 1025 caractères, confirmation Google vide ou de 8193 caractères", async () => {
    const manager = await createManager();
    const supprimer = (corps: object) => request(app).delete("/api/auth/account").set(authHeader(tokenFor(manager))).send(corps);

    expect((await supprimer({ password: "" })).body.code).toMatch(VALIDATION);
    expect((await supprimer({ password: "P".repeat(1025) })).body.code).toMatch(VALIDATION);
    const limite = await supprimer({ password: "P".repeat(1024) });
    expect(limite.status).toBe(401);
    expect(limite.body.code).toBe("PASSWORD_INCORRECT");

    const sansMotDePasse = await createManager({ hasPassword: false, googleId: "google-sans-mdp" });
    env.googleClientId = "test-google-client-id";
    verifierGoogle.mockRejectedValue(new Error("jeton refusé par Google"));
    const supprimerGoogle = (corps: object) => request(app).delete("/api/auth/account").set(authHeader(tokenFor(sansMotDePasse))).send(corps);
    expect((await supprimerGoogle({ googleCredential: "" })).body.code).toMatch(VALIDATION);
    expect((await supprimerGoogle({ googleCredential: "j".repeat(8193) })).body.code).toMatch(VALIDATION);
    expect((await supprimerGoogle({ googleCredential: "j".repeat(8192) })).body.code).toBe("GOOGLE_TOKEN_INVALID_OR_EXPIRED");
  });
});

describe("inscription", () => {
  const inscrire = (email: string, langue?: string) =>
    request(app)
      .post("/api/auth/register")
      .set("Accept-Language", langue ?? "fr")
      .send({ country: "SN", email, password: PASSWORD });

  it("crée un compte en essai de 15 jours, formule STARTER, avec le pays, la devise et la langue de la requête", async () => {
    const res = await inscrire("nouveau-cas@test.local", "en");

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      pendingVerification: true,
      message: "Compte créé. Vérifiez votre boîte email pour confirmer votre adresse et activer votre compte.",
    });
    const [compte] = await testDb.select().from(users).where(eq(users.email, "nouveau-cas@test.local"));
    expect(compte.role).toBe("MANAGER");
    expect(compte.subscriptionStatus).toBe("TRIAL");
    expect(compte.subscriptionPlan).toBe("STARTER");
    expect(proche(compte.trialEndsAt, Date.now() + 15 * JOUR)).toBe(true);
    expect(compte.country).toBe("SN");
    expect(compte.currency).toBe(deviseDuPays("SN"));
    expect(compte.language).toBe("en");
  });

  it("l'e-mail de confirmation porte un jeton de 64 caractères dont seule l'empreinte est en base, valable 24 heures, dans la langue de la requête", async () => {
    await inscrire("confirmation-cas@test.local", "en");

    const { a, sujet, html } = dernierEnvoi();
    const jeton = jetonDuLien(html, "verifier-email");
    const [compte] = await testDb.select().from(users).where(eq(users.email, "confirmation-cas@test.local"));
    expect(a).toBe("confirmation-cas@test.local");
    expect(jeton).toHaveLength(64);
    expect(compte.emailVerificationTokenHash).toBe(hashToken(jeton));
    expect(compte.emailVerificationTokenHash).not.toBe(jeton);
    expect(proche(compte.emailVerificationExpiresAt, Date.now() + 24 * HEURE)).toBe(true);
    expect({ sujet, html }).toEqual(
      (({ subject, html: h }) => ({ sujet: subject, html: h }))(emailVerificationEmail({ verifyUrl: `${env.frontendUrl}/verifier-email?token=${jeton}`, langue: "en" }))
    );
  });

  it("une adresse déjà prise reçoit l'e-mail « compte existant » avec ses liens de connexion et de réinitialisation, dans la langue de la requête", async () => {
    const existant = await createManager();

    await inscrire(existant.email, "en");

    const { a, sujet, html } = dernierEnvoi();
    expect(a).toBe(existant.email);
    expect(html).toContain(`${env.frontendUrl}/login`);
    expect(html).toContain(`${env.frontendUrl}/mot-de-passe-oublie`);
    const attendu = accountAlreadyExistsEmail({ loginUrl: `${env.frontendUrl}/login`, resetUrl: `${env.frontendUrl}/mot-de-passe-oublie`, langue: "en" });
    expect({ sujet, html }).toEqual({ sujet: attendu.subject, html: attendu.html });
  });
});

describe("renvoi du lien de confirmation", () => {
  const renvoyer = (email: string, langue = "fr") => request(app).post("/api/auth/resend-verification").set("Accept-Language", langue).send({ email });

  it("régénère un jeton de 64 caractères valable 24 heures et envoie l'e-mail dans la langue de la requête", async () => {
    const manager = await createManager({ emailVerifiedAt: null });

    const res = await renvoyer(manager.email, "en");

    expect(res.body.message).toBe("Si un compte non confirmé existe avec cet email, un nouveau lien de confirmation vient de lui être envoyé.");
    const { a, sujet, html } = dernierEnvoi();
    const jeton = jetonDuLien(html, "verifier-email");
    const apres = await ligne(manager.id);
    expect(a).toBe(manager.email);
    expect(jeton).toHaveLength(64);
    expect(apres.emailVerificationTokenHash).toBe(hashToken(jeton));
    expect(proche(apres.emailVerificationExpiresAt, Date.now() + 24 * HEURE)).toBe(true);
    const attendu = emailVerificationEmail({ verifyUrl: `${env.frontendUrl}/verifier-email?token=${jeton}`, langue: "en" });
    expect({ sujet, html }).toEqual({ sujet: attendu.subject, html: attendu.html });
  });

  it("n'envoie rien à un compte déjà confirmé, ni à un compte qui n'est pas un gestionnaire", async () => {
    const confirme = await createManager({ emailVerifiedAt: new Date() });
    const gestionnaire = await createManager();
    const locataire = await createTenant(gestionnaire.id);
    const portail = await createTenantPortalUser(locataire);
    await testDb.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, portail.id));

    await renvoyer(confirme.email);
    await renvoyer(portail.email);

    expect(envois).not.toHaveBeenCalled();
  });

  it("un envoi qui échoue est journalisé et signalé à Sentry sans faire échouer la réponse", async () => {
    const manager = await createManager({ emailVerifiedAt: null });
    envois.mockRejectedValue(new Error("SMTP indisponible"));

    const res = await renvoyer(manager.email);
    await new Promise((r) => setTimeout(r, 50));

    expect(res.status).toBe(200);
    expect(console.error).toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), { tags: { source: "auth.controller.resendVerification" } });
  });
});

describe("mot de passe oublié et réinitialisation", () => {
  it("le lien envoyé porte un jeton de 64 caractères, valable la durée prévue, dans la langue de la requête ; la réponse est générique", async () => {
    const manager = await createManager();

    const res = await request(app).post("/api/auth/forgot-password").set("Accept-Language", "en").send({ email: manager.email });

    expect(res.body.message).toBe("Si un compte existe avec cet email, un lien de réinitialisation vient de lui être envoyé.");
    const { sujet, html } = dernierEnvoi();
    const jeton = jetonDuLien(html, "reinitialiser-mot-de-passe");
    const apres = await ligne(manager.id);
    expect(jeton).toHaveLength(64);
    expect(apres.resetPasswordTokenHash).toBe(hashToken(jeton));
    expect(proche(apres.resetPasswordExpiresAt, Date.now() + RESET_TOKEN_TTL_MS)).toBe(true);
    const attendu = passwordResetEmail({ resetUrl: `${env.frontendUrl}/reinitialiser-mot-de-passe?token=${jeton}`, langue: "en" });
    expect({ sujet, html }).toEqual({ sujet: attendu.subject, html: attendu.html });
  });

  it("un lien de réinitialisation périmé est refusé, et le mot de passe reste inchangé", async () => {
    const manager = await createManager({ resetPasswordTokenHash: hashToken("lien-perime"), resetPasswordExpiresAt: new Date(Date.now() - 1000) });

    const res = await request(app).post("/api/auth/reset-password").send({ token: "lien-perime", password: "NouveauMotDePasse42!" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("RESET_LINK_INVALID");
    expect(await bcrypt.compare(PASSWORD, (await ligne(manager.id)).passwordHash)).toBe(true);
  });

  it("un lien valide : mot de passe haché au coût 10, lien et échéance effacés, sessions révoquées, message précis", async () => {
    const manager = await createManager({ tokenVersion: 4, hasPassword: false, resetPasswordTokenHash: hashToken("lien-valide"), resetPasswordExpiresAt: new Date(Date.now() + HEURE) });

    const res = await request(app).post("/api/auth/reset-password").send({ token: "lien-valide", password: "NouveauMotDePasse42!" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Mot de passe mis à jour avec succès. Les sessions ouvertes sur vos autres appareils ont été fermées.");
    const apres = await ligne(manager.id);
    expect(bcrypt.getRounds(apres.passwordHash)).toBe(10);
    expect(apres.hasPassword).toBe(true);
    expect(apres.tokenVersion).toBe(5);
    expect(apres.resetPasswordTokenHash).toBeNull();
    expect(apres.resetPasswordExpiresAt).toBeNull();
  });
});

describe("confirmation de l'adresse", () => {
  it("la session ouverte porte le rôle et la version du compte, le cookie est posé, la réponse décrit le compte", async () => {
    const manager = await createManager({
      emailVerifiedAt: null,
      emailVerificationTokenHash: hashToken("lien-confirmation"),
      emailVerificationExpiresAt: new Date(Date.now() + HEURE),
      tokenVersion: 3,
      hasPassword: false,
      country: "SN",
      totpEnabledAt: new Date(),
    });

    const res = await request(app).post("/api/auth/verify-email").send({ token: "lien-confirmation" });

    expect(res.status).toBe(200);
    expect(decode(res.body.token)).toMatchObject({ userId: manager.id, role: "MANAGER", tokenVersion: 3 });
    expect(decode(jetonDuCookie(res))).toMatchObject({ userId: manager.id, role: "MANAGER", tokenVersion: 3 });
    expect(res.body.user).toMatchObject({ id: manager.id, country: "SN", hasPassword: false, twoFactorEnabled: true, tenantId: null, tenantName: null });
    expect(res.body.user.subscription).not.toBeNull();
    const apres = await ligne(manager.id);
    expect(apres.emailVerificationTokenHash).toBeNull();
    expect(apres.emailVerificationExpiresAt).toBeNull();
  });

  it("un échec de la récompense de parrainage ne bloque pas la confirmation", async () => {
    await createManager({ emailVerifiedAt: null, emailVerificationTokenHash: hashToken("lien-parrain"), emailVerificationExpiresAt: new Date(Date.now() + HEURE) });
    vi.spyOn(referral, "accorderRecompenseParrainage").mockRejectedValue(new Error("récompense indisponible"));

    const res = await request(app).post("/api/auth/verify-email").send({ token: "lien-parrain" });

    expect(res.status).toBe(200);
  });
});

describe("connexion par mot de passe", () => {
  const connexion = (email: string, langue?: string) => {
    const requete = request(app).post("/api/auth/login");
    if (langue) requete.set("Accept-Language", langue);
    return requete.send({ email, password: PASSWORD });
  };

  it("un mot de passe faux et une adresse inconnue répondent 401 avec le code INVALID_CREDENTIALS", async () => {
    const manager = await createManager();

    const faux = await request(app).post("/api/auth/login").send({ email: manager.email, password: "Mauvais42!" });
    const inconnu = await request(app).post("/api/auth/login").send({ email: "personne@test.local", password: PASSWORD });

    for (const res of [faux, inconnu]) {
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("INVALID_CREDENTIALS");
    }
  });

  it("une adresse inconnue est comparée à une vraie empreinte bcrypt de coût 10, comme une adresse connue", async () => {
    const comparer = vi.spyOn(bcrypt, "compare");

    await request(app).post("/api/auth/login").send({ email: "inconnu-empreinte@test.local", password: PASSWORD });

    expect(comparer).toHaveBeenCalledTimes(1);
    expect(comparer.mock.calls[0][1]).toMatch(/^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/);
  });

  it("le gestionnaire sans mot de passe propre, le locataire et le propriétaire reçoivent leur identité complète dans le jeton et la réponse", async () => {
    const manager = await createManager({ hasPassword: false });
    const locataire = await createTenant(manager.id, { firstName: "Moussa", lastName: "Fall" });
    const compteLocataire = await createTenantPortalUser(locataire);
    const proprietaire = await createOwner(manager.id, { firstName: "Awa", lastName: "Ndiaye" });
    const compteProprietaire = await createOwnerPortalUser(proprietaire);

    const gestionnaire = await connexion(manager.email);
    const cheLocataire = await connexion(compteLocataire.email);
    const cheProprietaire = await connexion(compteProprietaire.email);

    expect(gestionnaire.body.user.hasPassword).toBe(false);
    expect(cheLocataire.body.user).toMatchObject({ tenantId: locataire.id, tenantName: "Moussa Fall", ownerId: null, ownerName: null });
    expect(decode(cheLocataire.body.token)).toMatchObject({ tenantId: locataire.id, ownerId: null });
    expect(cheProprietaire.body.user).toMatchObject({ ownerId: proprietaire.id, ownerName: "Awa Ndiaye", tenantId: null });
    expect(decode(cheProprietaire.body.token)).toMatchObject({ ownerId: proprietaire.id, tenantId: null });
  });

  it("la langue de l'interface n'est enregistrée que sur la fiche du locataire ou du propriétaire, jamais sur son compte de connexion", async () => {
    const manager = await createManager();
    const locataire = await createTenant(manager.id);
    const compteLocataire = await createTenantPortalUser(locataire);
    const proprietaire = await createOwner(manager.id);
    const compteProprietaire = await createOwnerPortalUser(proprietaire);

    await connexion(compteLocataire.email, "en");
    await connexion(compteProprietaire.email, "pt");

    expect((await ligne(compteLocataire.id)).language).toBeNull();
    expect((await ligne(compteProprietaire.id)).language).toBeNull();
    expect((await testDb.select().from(tenants).where(eq(tenants.id, locataire.id)))[0].language).toBe("en");
    expect((await testDb.select().from(owners).where(eq(owners.id, proprietaire.id)))[0].language).toBe("pt");
  });

  it("une langue qui ne s'enregistre pas n'empêche jamais la connexion (locataire, propriétaire, gestionnaire)", async () => {
    const manager = await createManager();
    const locataire = await createTenant(manager.id);
    const compteLocataire = await createTenantPortalUser(locataire);
    const proprietaire = await createOwner(manager.id);
    const compteProprietaire = await createOwnerPortalUser(proprietaire);
    const original = db.update.bind(db);
    for (const [table, email] of [
      [tenants, compteLocataire.email],
      [owners, compteProprietaire.email],
      [users, manager.email],
    ] as const) {
      const espion = vi.spyOn(db, "update").mockImplementation(((cible: unknown) => {
        if (cible === table) throw new Error("écriture refusée");
        return original(cible as never);
      }) as never);

      const res = await connexion(email, "en");

      expect(res.status, email).toBe(200);
      expect(res.body.token).toBeTypeOf("string");
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("non enregistrée"), expect.any(Error));
      espion.mockRestore();
    }
  });
});

describe("deuxième étape de connexion (double authentification)", () => {
  async function compteAvecDeuxFa() {
    const manager = await createManager();
    const setup = await request(app).post("/api/auth/2fa/setup").set(authHeader(tokenFor(manager)));
    const confirm = await request(app)
      .post("/api/auth/2fa/confirm")
      .set(authHeader(tokenFor(manager)))
      .send({ code: await genererCodeTotp(setup.body.secret) });
    const login = await request(app).post("/api/auth/login").send({ email: manager.email, password: PASSWORD });
    return { manager, secret: setup.body.secret as string, secours: confirm.body.backupCodes as string[], pendingToken: login.body.pendingToken as string };
  }
  const verifier = (pendingToken: string, code: string) => request(app).post("/api/auth/2fa/verify-login").send({ pendingToken, code });

  it("le jeton intermédiaire est valable 5 minutes exactement", async () => {
    const { pendingToken } = await compteAvecDeuxFa();

    const { exp, iat } = decode(pendingToken);

    expect(exp - iat).toBe(5 * 60);
  });

  it("un code entouré d'espaces est accepté, pour un code TOTP comme pour un code de secours", async () => {
    const { secret, secours, pendingToken } = await compteAvecDeuxFa();

    const totp = await verifier(pendingToken, ` ${await genererCodeTotp(secret)} `);
    const reserve = await verifier(pendingToken, ` ${secours[0]} `);

    expect(totp.status).toBe(200);
    expect(reserve.status).toBe(200);
  });

  it("un code de secours faux est refusé : 401 TWO_FACTOR_CODE_INVALID", async () => {
    const { pendingToken } = await compteAvecDeuxFa();

    const res = await verifier(pendingToken, "abcdef0123");

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TWO_FACTOR_CODE_INVALID");
  });
});

describe("secret TOTP déjà chiffré", () => {
  it("la connexion en deux étapes ne réécrit pas un secret déjà chiffré", async () => {
    const avant = env.totpEncryptionKey;
    env.totpEncryptionKey = crypto.randomBytes(32);
    try {
      const secret = genererSecretTotp();
      const stocke = chiffrerSecretTotp(secret);
      const manager = await createManager({ totpSecret: stocke, totpEnabledAt: new Date(), totpBackupCodesHash: "[]" });
      const etape1 = await request(app).post("/api/auth/login").send({ email: manager.email, password: PASSWORD });

      const etape2 = await request(app).post("/api/auth/2fa/verify-login").send({ pendingToken: etape1.body.pendingToken, code: await genererCodeTotp(secret) });

      expect(etape2.status).toBe(200);
      expect((await ligne(manager.id)).totpSecret).toBe(stocke);
    } finally {
      env.totpEncryptionKey = avant;
    }
  });
});

describe("connexion avec Google", () => {
  const charge = (extra: Record<string, unknown> = {}) => ({ sub: `google-${Math.random()}`, email: `google-${Date.now()}@test.local`, email_verified: true, ...extra });
  const connecter = (corps: Record<string, unknown> = {}, langue = "fr") => request(app).post("/api/auth/google").set("Accept-Language", langue).send({ credential: "jeton-google", ...corps });

  beforeEach(() => {
    env.googleClientId = "test-google-client-id";
  });

  it("vérifie le jeton reçu pour l'audience de l'application", async () => {
    verifierGoogle.mockResolvedValue({ getPayload: () => charge() });

    await connecter({ credential: "jeton-transmis" });

    expect(verifierGoogle).toHaveBeenCalledWith({ idToken: "jeton-transmis", audience: "test-google-client-id" });
  });

  it("un jeton refusé par Google, une charge absente, sans identifiant ou sans adresse, est refusé avec le bon code", async () => {
    verifierGoogle.mockRejectedValue(new Error("refusé"));
    const refuse = await connecter();
    expect(refuse.status).toBe(401);
    expect(refuse.body.code).toBe("GOOGLE_TOKEN_INVALID_OR_EXPIRED");

    for (const getPayload of [() => undefined, () => charge({ sub: undefined }), () => charge({ email: undefined })]) {
      verifierGoogle.mockResolvedValue({ getPayload });
      const res = await connecter();
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("GOOGLE_TOKEN_INVALID");
    }
  });

  it("une adresse que Google n'a pas vérifiée est refusée : 403 GOOGLE_EMAIL_UNVERIFIED", async () => {
    verifierGoogle.mockResolvedValue({ getPayload: () => charge({ email_verified: false }) });

    const res = await connecter();

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("GOOGLE_EMAIL_UNVERIFIED");
  });

  it("un nouveau compte : adresse en minuscules et sans espaces, sans mot de passe propre, essai de 15 jours, langue de la requête", async () => {
    verifierGoogle.mockResolvedValue({ getPayload: () => charge({ sub: "google-neuf", email: "  Nouveau.MIXTE@Test.Local  " }) });

    const res = await connecter({}, "en");

    expect(res.status).toBe(200);
    const [compte] = await testDb.select().from(users).where(eq(users.googleId, "google-neuf"));
    expect(compte.email).toBe("nouveau.mixte@test.local");
    expect(compte.hasPassword).toBe(false);
    expect(proche(compte.trialEndsAt, Date.now() + 15 * JOUR)).toBe(true);
    expect(compte.language).toBe("en");
  });

  it("un nouveau compte créé sans langue demandée prend le français par défaut", async () => {
    verifierGoogle.mockResolvedValue({ getPayload: () => charge({ sub: "google-sans-langue" }) });

    const res = await request(app).post("/api/auth/google").send({ credential: "jeton-google" });

    expect(res.status).toBe(200);
    const [compte] = await testDb.select().from(users).where(eq(users.googleId, "google-sans-langue"));
    expect(compte.language).toBe("fr");
  });

  it("un échec de la récompense de parrainage ne bloque pas la création du compte", async () => {
    verifierGoogle.mockResolvedValue({ getPayload: () => charge() });
    vi.spyOn(referral, "accorderRecompenseParrainage").mockRejectedValue(new Error("récompense indisponible"));

    const res = await connecter();

    expect(res.status).toBe(200);
  });

  it("lier Google à un compte jamais confirmé efface aussi les échéances des liens en circulation", async () => {
    const compte = await createManager({
      emailVerifiedAt: null,
      emailVerificationTokenHash: hashToken("ancien-lien"),
      emailVerificationExpiresAt: new Date(Date.now() + HEURE),
      resetPasswordTokenHash: hashToken("ancien-reset"),
      resetPasswordExpiresAt: new Date(Date.now() + HEURE),
    });
    verifierGoogle.mockResolvedValue({ getPayload: () => charge({ sub: "google-lie", email: compte.email }) });

    const res = await connecter();

    expect(res.status).toBe(200);
    const apres = await ligne(compte.id);
    expect(apres.emailVerificationTokenHash).toBeNull();
    expect(apres.emailVerificationExpiresAt).toBeNull();
    expect(apres.resetPasswordTokenHash).toBeNull();
    expect(apres.resetPasswordExpiresAt).toBeNull();
  });
});

describe("devise de l'agence", () => {
  const changer = (token: string, currency = "XOF") => request(app).patch("/api/auth/currency").set(authHeader(token)).send({ currency });

  it("le gestionnaire change la devise : réponse de succès et valeur enregistrée", async () => {
    const manager = await createManager({ currency: "EUR" });

    const res = await changer(tokenFor(manager));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, currency: "XOF" });
    expect((await ligne(manager.id)).currency).toBe("XOF");
  });

  it("un collaborateur « tous droits » peut la changer pour l'agence ; un lecteur est refusé (OWNER_ONLY_CURRENCY)", async () => {
    const manager = await createManager({ currency: "EUR" });
    const lecteur = await tokenCollaborateur(manager, { teamRole: "READ_ONLY" });
    const complet = await tokenCollaborateur(manager, { teamRole: "FULL" });

    const refuse = await changer(lecteur);
    const accepte = await changer(complet);

    expect(refuse.status).toBe(403);
    expect(refuse.body.code).toBe("OWNER_ONLY_CURRENCY");
    expect(accepte.status).toBe(200);
    expect((await ligne(manager.id)).currency).toBe("XOF");
  });

  it("le choix du pays est refusé à un lecteur avec le code OWNER_ONLY_COUNTRY", async () => {
    const manager = await createManager({ country: null });
    const lecteur = await tokenCollaborateur(manager, { teamRole: "READ_ONLY" });

    const res = await request(app).post("/api/auth/country").set(authHeader(lecteur)).send({ country: "SN" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("OWNER_ONLY_COUNTRY");
  });
});

describe("déconnexion et sessions", () => {
  it("« se déconnecter partout » incrémente la version du jeton de 1 et rend un succès", async () => {
    const manager = await createManager({ tokenVersion: 5 });
    const jeton = jwt.sign({ userId: manager.id, role: "MANAGER", tokenVersion: 5 }, env.jwtSecret);

    const res = await request(app).post("/api/auth/logout-all").set(authHeader(jeton));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect((await ligne(manager.id)).tokenVersion).toBe(6);
  });

  it("la déconnexion avec un jeton Bearer et un cookie n'exige pas l'en-tête anti-CSRF ; un en-tête qui n'est pas un Bearer l'exige", async () => {
    const avecBearer = await request(app).post("/api/auth/logout").set("Authorization", "Bearer jeton").set("Cookie", "token=abc");
    const sansBearer = await request(app).post("/api/auth/logout").set("Authorization", "Bearerjeton").set("Cookie", "token=abc");

    expect(avecBearer.status).toBe(204);
    expect(sansBearer.status).toBe(403);
    expect(sansBearer.body.code).toBe("CSRF_REFUSED");
  });
});

describe("rafraîchissement de la session web", () => {
  const rafraichir = (jeton: string) => request(app).post("/api/auth/session/refresh").set("Cookie", `token=${jeton}`).set("X-Requested-With", "XMLHttpRequest");
  const connecte = async (email: string) => jetonDuCookie(await request(app).post("/api/auth/login").send({ email, password: PASSWORD }));
  const identite = (jeton: string) => {
    const { userId, role, tenantId, ownerId, tokenVersion, collaboratorId } = decode(jeton);
    return { userId, role, tenantId, ownerId, tokenVersion, collaboratorId };
  };

  it("le nouveau cookie garde l'identité exacte de la session : compte, rôle, fiche, version, collaborateur", async () => {
    const manager = await createManager({ tokenVersion: 2 });
    const locataire = await createTenant(manager.id);
    const compteLocataire = await createTenantPortalUser(locataire);
    const proprietaire = await createOwner(manager.id);
    const compteProprietaire = await createOwnerPortalUser(proprietaire);
    const collaborateur = await createTeamMember(manager.id);

    for (const email of [manager.email, compteLocataire.email, compteProprietaire.email, collaborateur.email]) {
      const avant = await connecte(email);

      const res = await rafraichir(avant);

      expect(res.status, email).toBe(200);
      expect(res.body.renewed).toBe(true);
      expect(identite(jetonDuCookie(res)), email).toEqual(identite(avant));
      expect(Math.abs(new Date(res.body.expiresAt).getTime() - decode(jetonDuCookie(res)).exp * 1000)).toBeLessThan(1000);
    }
  });

  it("une session de plus de 12 h est refusée avec le code SESSION_MAX_DURATION et le cookie est effacé", async () => {
    const manager = await createManager();
    const ancien = jwt.sign(
      { userId: manager.id, role: "MANAGER", tokenVersion: 0, sst: Math.floor((Date.now() - 13 * HEURE) / 1000), exp: Math.floor((Date.now() + 5 * MINUTE) / 1000) },
      env.jwtSecret
    );

    const res = await rafraichir(ancien);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("SESSION_MAX_DURATION");
    expect(res.headers["set-cookie"]?.[0] ?? "").toMatch(/^token=;/);
  });

  it("sans début de session enregistré, la date d'émission du jeton fait foi pour le plafond de 12 h", async () => {
    const manager = await createManager();
    const ancien = jwt.sign(
      { userId: manager.id, role: "MANAGER", tokenVersion: 0, iat: Math.floor((Date.now() - 13 * HEURE) / 1000), exp: Math.floor((Date.now() + 5 * MINUTE) / 1000) },
      env.jwtSecret
    );

    const res = await rafraichir(ancien);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("SESSION_MAX_DURATION");
  });
});

describe("suppression du compte", () => {
  it("un mot de passe faux est refusé avec le code PASSWORD_INCORRECT", async () => {
    const manager = await createManager();

    const res = await request(app).delete("/api/auth/account").set(authHeader(tokenFor(manager))).send({ password: "Mauvais42!" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("PASSWORD_INCORRECT");
    expect(await ligne(manager.id)).toBeDefined();
  });
});
