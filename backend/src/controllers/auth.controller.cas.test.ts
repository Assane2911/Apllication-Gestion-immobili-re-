import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { OAuth2Client } from "google-auth-library";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { users } from "../db/schema";
import { authHeader, createManager, createOwner, createTenant, createTenantPortalUser, createTeamMember, tokenCollaborateur, tokenFor, tokenLocataire, tokenProprietaire } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { genererCodeTotp } from "../services/totp.service";
import { hashToken } from "../utils/token";
import { computeSubscriptionInfo } from "./auth.controller";

/**
 * Cas limites de l'authentification : jeton intermédiaire de 2FA mal formé, compte dont la 2FA a été coupée entre
 * les deux étapes, lien de confirmation périmé, règle d'abonnement (un seul endroit décide « expiré »), identité
 * rendue par /me et suppression de compte (mot de passe ou confirmation Google).
 */

vi.mock("google-auth-library", () => {
  const verifyIdToken = vi.fn();
  return {
    OAuth2Client: vi.fn().mockImplementation(function () {
      return { verifyIdToken };
    }),
  };
});
const verifierGoogle = vi.mocked(OAuth2Client).mock.results[0]!.value.verifyIdToken as ReturnType<typeof vi.fn>;

const JOUR = 24 * 3600 * 1000;
const dans = (ms: number) => new Date(Date.now() + ms);

describe("2FA : jeton intermédiaire et compte modifié entre les deux étapes", () => {
  const verifier = (pendingToken: string, code = "123456") => request(app).post("/api/auth/2fa/verify-login").send({ pendingToken, code });
  const intermediaire = (claims: Record<string, unknown>, secret: string = env.jwtSecret) => jwt.sign(claims, secret, { expiresIn: "5m" });

  async function compteAvecDeuxFa() {
    const manager = await createManager();
    const setup = await request(app).post("/api/auth/2fa/setup").set(authHeader(tokenFor(manager)));
    await request(app).post("/api/auth/2fa/confirm").set(authHeader(tokenFor(manager))).send({ code: await genererCodeTotp(setup.body.secret) }).expect(200);
    const login = await request(app).post("/api/auth/login").send({ email: manager.email, password: "Password123!" });
    return { manager, secret: setup.body.secret as string, pendingToken: login.body.pendingToken as string };
  }

  it("un jeton bien signé mais qui n'est pas un jeton intermédiaire est refusé (TOKEN_INVALID)", async () => {
    const { manager } = await compteAvecDeuxFa();

    for (const claims of [{ userId: manager.id }, { userId: manager.id, purpose: "autre" }, { userId: manager.id, purpose: "2fa_pending_x" }, { purpose: "2fa_pending" }, { userId: 42, purpose: "2fa_pending" }]) {
      const res = await verifier(intermediaire(claims));
      expect(res.status, JSON.stringify(claims)).toBe(401);
      expect(res.body.code, JSON.stringify(claims)).toBe("TOKEN_INVALID");
    }
  });

  it("un jeton signé avec un autre secret, périmé ou illisible demande de se reconnecter (LOGIN_SESSION_EXPIRED)", async () => {
    const { manager } = await compteAvecDeuxFa();
    const perime = jwt.sign({ userId: manager.id, purpose: "2fa_pending" }, env.jwtSecret, { expiresIn: -10 });

    for (const jeton of [intermediaire({ userId: manager.id, purpose: "2fa_pending" }, "un-autre-secret"), perime, "n-importe-quoi"]) {
      const res = await verifier(jeton);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("LOGIN_SESSION_EXPIRED");
    }
  });

  it("un jeton de SESSION n'est pas accepté comme jeton intermédiaire", async () => {
    const manager = await createManager();

    const res = await verifier(tokenFor(manager));

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_INVALID");
  });

  it("la 2FA désactivée entre les deux étapes : le jeton ne suffit plus, il faut se reconnecter", async () => {
    const { manager, secret, pendingToken } = await compteAvecDeuxFa();
    await testDb.update(users).set({ totpEnabledAt: null, totpSecret: null }).where(eq(users.id, manager.id));

    const res = await verifier(pendingToken, await genererCodeTotp(secret));

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("LOGIN_SESSION_EXPIRED");
  });

  it("seule l'activation effacée (le secret existe encore) suffit aussi à exiger de se reconnecter", async () => {
    const { manager, secret, pendingToken } = await compteAvecDeuxFa();
    await testDb.update(users).set({ totpEnabledAt: null }).where(eq(users.id, manager.id));

    const res = await verifier(pendingToken, await genererCodeTotp(secret));

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("LOGIN_SESSION_EXPIRED");
  });

  it("un compte sans secret (activé mais secret effacé), ou supprimé entre les deux étapes, est traité de la même façon", async () => {
    const { manager, secret, pendingToken } = await compteAvecDeuxFa();
    await testDb.update(users).set({ totpSecret: null }).where(eq(users.id, manager.id));
    const sansSecret = await verifier(pendingToken, await genererCodeTotp(secret));

    const fantome = await verifier(intermediaire({ userId: "compte-inexistant", purpose: "2fa_pending" }));

    expect(sansSecret.body.code).toBe("LOGIN_SESSION_EXPIRED");
    expect(fantome.status).toBe(401);
    expect(fantome.body.code).toBe("LOGIN_SESSION_EXPIRED");
  });
});

describe("POST /api/auth/verify-email : lien invalide ou périmé", () => {
  const confirmer = (token: string) => request(app).post("/api/auth/verify-email").send({ token });
  const compteANonVerifier = (token: string, expire: Date | null) =>
    createManager({ emailVerifiedAt: null, emailVerificationTokenHash: hashToken(token), emailVerificationExpiresAt: expire });

  it("un lien inconnu est refusé (EMAIL_LINK_INVALID)", async () => {
    const res = await confirmer("lien-qui-n-existe-pas");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("EMAIL_LINK_INVALID");
  });

  it("un lien périmé est refusé et le compte reste non vérifié", async () => {
    const manager = await compteANonVerifier("lien-perime", dans(-1000));

    const res = await confirmer("lien-perime");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("EMAIL_LINK_INVALID");
    const [apres] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(apres.emailVerifiedAt).toBeNull();
    expect(apres.emailVerificationTokenHash).not.toBeNull(); // le lien n'est pas consommé
  });

  it("un lien sans date d'expiration n'est jamais accepté", async () => {
    const manager = await compteANonVerifier("lien-sans-date", null);

    const res = await confirmer("lien-sans-date");

    expect(res.status).toBe(400);
    const [apres] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(apres.emailVerifiedAt).toBeNull();
  });

  it("un lien valide confirme le compte, connecte, et ne sert qu'une fois", async () => {
    const manager = await compteANonVerifier("lien-valide", dans(JOUR));

    const res = await confirmer("lien-valide");

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(manager.id);
    expect(res.body.user.currency).toBe("EUR");
    expect(res.body.token).toBeTruthy();
    const [apres] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(apres.emailVerifiedAt).not.toBeNull();
    expect((await confirmer("lien-valide")).status).toBe(400);
  });
});

describe("computeSubscriptionInfo : une seule règle pour « expiré »", () => {
  const compte = (o: Partial<Parameters<typeof computeSubscriptionInfo>[0]>) =>
    computeSubscriptionInfo({ role: "MANAGER", subscriptionStatus: "TRIAL", subscriptionPlan: "PRO", trialEndsAt: null, subscriptionEndsAt: null, ...o } as never)!;

  it("seul un gestionnaire a un abonnement", () => {
    for (const role of ["TENANT", "OWNER", "ADMIN"] as const) {
      expect(computeSubscriptionInfo({ role, subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", trialEndsAt: null, subscriptionEndsAt: null } as never)).toBeNull();
    }
  });

  it("essai : actif tant que sa date n'est pas passée, expiré sans date ou une fois passée", () => {
    expect(compte({ trialEndsAt: dans(5 * JOUR) })).toMatchObject({ status: "TRIAL", isTrialActive: true, isSubscriptionActive: false, isExpired: false });
    expect(compte({ trialEndsAt: dans(-1000) })).toMatchObject({ status: "EXPIRED", isTrialActive: false, isExpired: true });
    expect(compte({ trialEndsAt: null })).toMatchObject({ status: "EXPIRED", isTrialActive: false, isExpired: true });
  });

  it("une date d'essai dépassée n'a pas d'effet sur un abonnement ACTIVE, et un essai ne prolonge pas un abonnement résilié", () => {
    expect(compte({ subscriptionStatus: "ACTIVE", trialEndsAt: dans(-5 * JOUR), subscriptionEndsAt: dans(5 * JOUR) }).isExpired).toBe(false);
    expect(compte({ subscriptionStatus: "CANCELLED", trialEndsAt: dans(5 * JOUR), subscriptionEndsAt: null }).isExpired).toBe(true);
  });

  it("abonnement ACTIVE : sans terme il est actif, avec un terme futur aussi, avec un terme passé il est expiré", () => {
    expect(compte({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: null })).toMatchObject({ status: "ACTIVE", isSubscriptionActive: true, isExpired: false });
    expect(compte({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: dans(JOUR) })).toMatchObject({ status: "ACTIVE", isSubscriptionActive: true, isExpired: false });
    expect(compte({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: dans(-1000) })).toMatchObject({ status: "EXPIRED", isSubscriptionActive: false, isExpired: true });
  });

  it("abonnement CANCELLED : actif jusqu'au terme déjà payé, expiré ensuite, et sans terme il n'est pas actif", () => {
    expect(compte({ subscriptionStatus: "CANCELLED", subscriptionEndsAt: dans(JOUR) })).toMatchObject({ status: "CANCELLED", isSubscriptionActive: true, isExpired: false });
    expect(compte({ subscriptionStatus: "CANCELLED", subscriptionEndsAt: dans(-1000) })).toMatchObject({ status: "EXPIRED", isSubscriptionActive: false, isExpired: true });
    expect(compte({ subscriptionStatus: "CANCELLED", subscriptionEndsAt: null })).toMatchObject({ status: "EXPIRED", isExpired: true });
  });

  it("un statut EXPIRED reste expiré quelles que soient les dates", () => {
    expect(compte({ subscriptionStatus: "EXPIRED", trialEndsAt: dans(5 * JOUR), subscriptionEndsAt: dans(5 * JOUR) })).toMatchObject({ status: "EXPIRED", isExpired: true });
  });

  it("jours d'essai restants : arrondis au-dessus, jamais négatifs, 0 sans essai en cours", () => {
    expect(compte({ trialEndsAt: dans(2.2 * JOUR) }).trialDaysRemaining).toBe(3);
    expect(compte({ trialEndsAt: dans(JOUR - 5000) }).trialDaysRemaining).toBe(1);
    expect(compte({ trialEndsAt: dans(-3 * JOUR) }).trialDaysRemaining).toBe(0);
    expect(compte({ trialEndsAt: null }).trialDaysRemaining).toBe(0);
  });

  it("renvoie aussi le plan et les dates d'origine", () => {
    const fin = dans(10 * JOUR);
    const essai = dans(3 * JOUR);

    const info = compte({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", trialEndsAt: essai, subscriptionEndsAt: fin });

    expect(info.plan).toBe("ENTERPRISE");
    expect(info.subscriptionEndsAt).toBe(fin);
    expect(info.trialEndsAt).toBe(essai);
  });
});

describe("GET /api/auth/me : identité rendue selon le profil", () => {
  it("un locataire reçoit sa fiche locataire, sans fiche propriétaire ni abonnement", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id, { firstName: "Moussa", lastName: "Fall" });
    await createTenantPortalUser(tenant);

    const res = await request(app).get("/api/auth/me").set(authHeader(await tokenLocataire(tenant.id)));

    expect(res.status).toBe(200);
    expect(res.body.role).toBe("TENANT");
    expect(res.body.tenant.id).toBe(tenant.id);
    expect(res.body.owner).toBeNull();
    expect(res.body.subscription).toBeNull();
    expect(res.body.collaboratorId).toBeNull();
    expect(res.body.teamRole).toBeNull();
  });

  it("un propriétaire reçoit sa fiche propriétaire, sans fiche locataire ni abonnement", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { firstName: "Fatou", lastName: "Diop", email: "fatou-me@test.local" });

    const res = await request(app).get("/api/auth/me").set(authHeader(await tokenProprietaire(owner)));

    expect(res.status).toBe(200);
    expect(res.body.role).toBe("OWNER");
    expect(res.body.owner.id).toBe(owner.id);
    expect(res.body.tenant).toBeNull();
    expect(res.body.subscription).toBeNull();
  });

  it("un gestionnaire n'a ni fiche locataire ni fiche propriétaire, et reçoit son abonnement", async () => {
    const manager = await createManager();

    const res = await request(app).get("/api/auth/me").set(authHeader(tokenFor(manager)));

    expect(res.body.tenant).toBeNull();
    expect(res.body.owner).toBeNull();
    expect(res.body.subscription.status).toBe("TRIAL");
    expect(res.body.twoFactorEnabled).toBe(false);
    expect(res.body.hasPassword).toBe(true);
    expect(res.body.currency).toBe("EUR");
    expect(res.body.country).toBeNull();
  });

  it("l'abonnement rendu est celui de l'agence (propriétaire) pour un collaborateur, mais l'identité est la sienne", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: dans(30 * JOUR), country: "SN", currency: "XOF" });
    const collaborateur = await createTeamMember(manager.id, { email: "collab-me@test.local", teamRole: "AGENT" });
    const token = tokenFor({ id: manager.id, role: "MANAGER" }, null, null, collaborateur.id);

    const res = await request(app).get("/api/auth/me").set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.email).toBe("collab-me@test.local");
    expect(res.body.id).toBe(collaborateur.id);
    expect(res.body.subscription.plan).toBe("ENTERPRISE");
    expect(res.body.currency).toBe("XOF");
    expect(res.body.country).toBe("SN");
    expect(res.body.collaboratorId).toBe(collaborateur.id);
    expect(res.body.teamRole).toBe("AGENT");
  });

  it("un collaborateur sans rôle (invité avant les rôles) garde ses droits historiques, un rôle inconnu est ramené en lecture seule", async () => {
    const manager = await createManager();
    const attendu: Array<[string | null, string]> = [[null, "FULL"], ["ROLE-INCONNU", "READ_ONLY"], ["ACCOUNTANT", "ACCOUNTANT"]];
    for (const [teamRole, rendu] of attendu) {
      const collaborateur = await createTeamMember(manager.id, { teamRole });
      const token = tokenFor({ id: manager.id, role: "MANAGER" }, null, null, collaborateur.id);

      const res = await request(app).get("/api/auth/me").set(authHeader(token));

      expect(res.body.teamRole, String(teamRole)).toBe(rendu);
    }
  });

  it("« a un mot de passe » est celui du compte connecté, pas celui de l'agence", async () => {
    const agenceGoogle = await createManager({ hasPassword: false, subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: dans(30 * JOUR) });
    const avecMotDePasse = await createTeamMember(agenceGoogle.id, { hasPassword: true });
    const agenceClassique = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: dans(30 * JOUR) });
    const sansMotDePasse = await createTeamMember(agenceClassique.id, { hasPassword: false });

    const a = await request(app).get("/api/auth/me").set(authHeader(tokenFor({ id: agenceGoogle.id, role: "MANAGER" }, null, null, avecMotDePasse.id)));
    const b = await request(app).get("/api/auth/me").set(authHeader(tokenFor({ id: agenceClassique.id, role: "MANAGER" }, null, null, sansMotDePasse.id)));

    expect(a.body.hasPassword).toBe(true);
    expect(b.body.hasPassword).toBe(false);
  });

  it("la 2FA activée n'est annoncée que pour le compte réellement connecté (un collaborateur sans 2FA, propriétaire avec)", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: dans(30 * JOUR), totpEnabledAt: new Date(), totpSecret: "x" });
    const collaborateur = await createTeamMember(manager.id);

    const proprio = await request(app).get("/api/auth/me").set(authHeader(tokenFor(manager)));
    const collab = await request(app).get("/api/auth/me").set(authHeader(tokenFor({ id: manager.id, role: "MANAGER" }, null, null, collaborateur.id)));

    expect(proprio.body.twoFactorEnabled).toBe(true);
    expect(collab.body.twoFactorEnabled).toBe(false);
  });
});

describe("DELETE /api/auth/account : confirmation exigée selon le type de compte", () => {
  const supprimer = (token: string, corps: Record<string, unknown> = {}) => request(app).delete("/api/auth/account").set(authHeader(token)).send(corps);
  const existe = async (id: string) => (await testDb.select().from(users).where(eq(users.id, id))).length === 1;

  beforeEach(() => {
    env.googleClientId = "test-google-client-id";
  });
  afterEach(() => {
    verifierGoogle.mockReset();
    env.googleClientId = "";
  });

  it("un compte avec mot de passe qui n'en envoie pas : PASSWORD_REQUIRED, rien n'est supprimé", async () => {
    const manager = await createManager();

    const res = await supprimer(tokenFor(manager));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASSWORD_REQUIRED");
    expect(await existe(manager.id)).toBe(true);
  });

  it("un collaborateur ne peut jamais supprimer l'agence, même avec le bon mot de passe du propriétaire", async () => {
    const manager = await createManager();
    const token = await tokenCollaborateur(manager);

    const res = await supprimer(token, { password: "Password123!" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("OWNER_ONLY_DELETE_ACCOUNT");
    expect(await existe(manager.id)).toBe(true);
  });

  it("une confirmation vide est refusée (validation) avant tout accès au compte", async () => {
    const manager = await createManager();

    expect((await supprimer(tokenFor(manager), { password: "" })).status).toBe(400);
    expect(await existe(manager.id)).toBe(true);
  });

  describe("compte créé par Google (sans mot de passe)", () => {
    const googleSeul = () => createManager({ hasPassword: false, googleId: "google-sub-suppression" });

    it("Google non configuré sur le serveur : 503, rien n'est supprimé", async () => {
      env.googleClientId = "";
      const manager = await googleSeul();

      const res = await supprimer(tokenFor(manager), { googleCredential: "jeton" });

      expect(res.status).toBe(503);
      expect(res.body.code).toBe("GOOGLE_NOT_CONFIGURED");
      expect(await existe(manager.id)).toBe(true);
    });

    it("sans confirmation Google : GOOGLE_CONFIRMATION_REQUIRED, et un mot de passe n'y supplée pas", async () => {
      const manager = await googleSeul();

      const sans = await supprimer(tokenFor(manager));
      const avecMotDePasse = await supprimer(tokenFor(manager), { password: "Password123!" });

      expect(sans.status).toBe(400);
      expect(sans.body.code).toBe("GOOGLE_CONFIRMATION_REQUIRED");
      expect(avecMotDePasse.body.code).toBe("GOOGLE_CONFIRMATION_REQUIRED");
      expect(verifierGoogle).not.toHaveBeenCalled();
      expect(await existe(manager.id)).toBe(true);
    });

    it("un jeton Google que Google refuse : GOOGLE_TOKEN_INVALID_OR_EXPIRED", async () => {
      const manager = await googleSeul();
      verifierGoogle.mockRejectedValue(new Error("Token used too late"));

      const res = await supprimer(tokenFor(manager), { googleCredential: "jeton-perime" });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("GOOGLE_TOKEN_INVALID_OR_EXPIRED");
      expect(await existe(manager.id)).toBe(true);
    });

    it("un jeton Google valide mais d'un AUTRE compte Google, sans courriel vérifié, ou sans contenu : GOOGLE_TOKEN_INVALID", async () => {
      const manager = await googleSeul();

      for (const contenu of [{ sub: "un-autre-compte", email_verified: true }, { sub: "google-sub-suppression", email_verified: false }, { sub: "google-sub-suppression" }, undefined]) {
        verifierGoogle.mockResolvedValue({ getPayload: () => contenu });
        const res = await supprimer(tokenFor(manager), { googleCredential: "jeton" });
        expect(res.status, JSON.stringify(contenu)).toBe(401);
        expect(res.body.code, JSON.stringify(contenu)).toBe("GOOGLE_TOKEN_INVALID");
      }
      expect(await existe(manager.id)).toBe(true);
    });

    it("le jeton Google du bon compte supprime le compte (204) et efface le cookie", async () => {
      const manager = await googleSeul();
      verifierGoogle.mockResolvedValue({ getPayload: () => ({ sub: "google-sub-suppression", email_verified: true }) });

      const res = await supprimer(tokenFor(manager), { googleCredential: "jeton-frais" });

      expect(res.status).toBe(204);
      expect(await existe(manager.id)).toBe(false);
      expect(verifierGoogle).toHaveBeenCalledWith({ idToken: "jeton-frais", audience: "test-google-client-id" });
      expect((res.headers["set-cookie"] as unknown as string[] | undefined)?.join(";") ?? "").toContain("token=;");
    });
  });
});

describe("POST /api/auth/session/refresh", () => {
  it("avec un jeton Bearer (application mobile), rien n'est renouvelé", async () => {
    const manager = await createManager();

    const res = await request(app).post("/api/auth/session/refresh").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ renewed: false });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
});
