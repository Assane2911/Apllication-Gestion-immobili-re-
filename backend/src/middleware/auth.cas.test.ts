import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { describe, expect, it, vi } from "vitest";
import { createManager, createTeamMember, tokenFor } from "../test/authHelpers";
import { ApiError } from "../utils/asyncHandler";
import { AUTH_COOKIE_NAME, CSRF_HEADER_NAME } from "../utils/authCookie";
import { MESSAGE_COMPTE_SUSPENDU } from "../utils/compteSuspendu";
import { verifierAutorisationEquipe } from "../utils/rolesEquipe";
import {
  abonnementEnCours,
  assertPlanAtLeast,
  authenticate,
  exigerDeuxFacteursAdmin,
  planAuMoins,
  requireActiveSubscription,
  requirePlan,
  requireRole,
} from "./auth";

/**
 * Audit par sabotage de middleware/auth.ts : ce que les tests existants ne verrouillaient pas.
 *
 * Les tests existants passent par des routes et ne regardent que le CODE HTTP : un refus qui change de code d'erreur (celui que le
 * frontend traduit), de message ou de statut passait inaperçu. Ici, chaque middleware est appelé directement et sa réponse est lue en
 * entier : statut, code, message. Les cas qui n'étaient jamais exercés : le préfixe « Bearer » exact, le jeton sans rôle ou « à
 * finalité » (2FA en attente), le compte suspendu, la révocation par numéro de version (dans les deux sens), la version attendue d'un
 * collaborateur, la formule effective pendant l'essai et les bornes exactes de l'abonnement.
 */

const secret = () => process.env.JWT_SECRET!;
const signer = (charge: Record<string, unknown>) => jwt.sign(charge, secret(), { expiresIn: "1h" });

/** Appelle authenticate comme Express le fait, et rend ce que le middleware a répondu (erreur ou suite) et la requête enrichie. */
async function authentifier(entetes: Record<string, string>, extra: { cookies?: Record<string, string>; method?: string; originalUrl?: string } = {}) {
  const req = { headers: entetes, cookies: extra.cookies ?? {}, method: extra.method ?? "GET", originalUrl: extra.originalUrl ?? "/api/properties" } as unknown as Request;
  const suite = vi.fn();
  await authenticate(req, {} as Response, suite as NextFunction);
  expect(suite).toHaveBeenCalledTimes(1);
  const erreur = suite.mock.calls[0][0] as ApiError | undefined;
  return { req, erreur };
}
const bearer = (jeton: string) => ({ authorization: `Bearer ${jeton}` });

function refus(erreur: ApiError | undefined, statut: number, code: string, message?: string) {
  expect(erreur).toBeInstanceOf(ApiError);
  expect(erreur!.statusCode).toBe(statut);
  expect(erreur!.code).toBe(code);
  if (message !== undefined) expect(erreur!.message).toBe(message);
}

const COMPTE_ABSENT = "Ce compte n'existe plus. Veuillez vous reconnecter.";
const TOKEN_INVALIDE = "Token invalide ou expiré";

describe("authenticate : l'en-tête et le cookie", () => {
  it("sans aucun jeton : 401 « Authentification requise »", async () => {
    const { erreur } = await authentifier({});

    refus(erreur, 401, "AUTH_REQUIRED", "Authentification requise");
  });

  it("un en-tête sans « Bearer » est ignoré (AUTH_REQUIRED), qu'il porte le jeton brut ou « Bearer » collé au jeton", async () => {
    const manager = await createManager();
    const jeton = tokenFor(manager);

    refus((await authentifier({ authorization: jeton })).erreur, 401, "AUTH_REQUIRED");
    refus((await authentifier({ authorization: `Bearer${jeton}` })).erreur, 401, "AUTH_REQUIRED");
    refus((await authentifier({ authorization: `Basic ${jeton}` })).erreur, 401, "AUTH_REQUIRED");
  });

  it("un jeton falsifié ou expiré : 401 avec le code et le message du jeton invalide", async () => {
    const faux = jwt.sign({ userId: "x", role: "MANAGER" }, "mauvaise-cle", { expiresIn: "1h" });
    const expire = jwt.sign({ userId: "x", role: "MANAGER" }, secret(), { expiresIn: "-10s" });

    refus((await authentifier(bearer(faux))).erreur, 401, "TOKEN_INVALID_OR_EXPIRED", TOKEN_INVALIDE);
    refus((await authentifier(bearer(expire))).erreur, 401, "TOKEN_INVALID_OR_EXPIRED", TOKEN_INVALIDE);
  });

  it("un jeton bien signé mais non vérifié par sa signature (contenu décodé seulement) est refusé", async () => {
    const manager = await createManager();
    const sansSignature = jwt.sign({ userId: manager.id, role: "MANAGER" }, "autre-cle", { expiresIn: "1h" });

    refus((await authentifier(bearer(sansSignature))).erreur, 401, "TOKEN_INVALID_OR_EXPIRED");
  });

  it("l'en-tête Bearer est lu avant le cookie : un en-tête valide l'emporte sur un cookie invalide, et inversement", async () => {
    const manager = await createManager();
    const valide = tokenFor(manager);

    const { erreur, req } = await authentifier(bearer(valide), { cookies: { [AUTH_COOKIE_NAME]: "cookie-invalide" } });
    expect(erreur).toBeUndefined();
    expect(req.user?.userId).toBe(manager.id);

    refus((await authentifier(bearer("jeton-invalide"), { cookies: { [AUTH_COOKIE_NAME]: valide } })).erreur, 401, "TOKEN_INVALID_OR_EXPIRED");
  });
});

describe("authenticate : un jeton sans rôle ou à finalité n'est jamais une session", () => {
  it("sans rôle : refusé comme un jeton invalide (code et message compris)", async () => {
    const manager = await createManager();

    const { erreur } = await authentifier(bearer(signer({ userId: manager.id })));

    refus(erreur, 401, "TOKEN_INVALID_OR_EXPIRED", TOKEN_INVALIDE);
  });

  it.each([
    ["une finalité « 2FA en attente »", "2fa_pending"],
    ["une finalité vide", ""],
    ["une finalité nulle", null],
  ])("avec %s : refusé même avec un rôle et une version (la double authentification ne se contourne pas)", async (_nom, finalite) => {
    const manager = await createManager();

    const { erreur } = await authentifier(bearer(signer({ userId: manager.id, role: "MANAGER", tokenVersion: 0, purpose: finalite })));

    refus(erreur, 401, "TOKEN_INVALID_OR_EXPIRED", TOKEN_INVALIDE);
  });
});

describe("authenticate : protection CSRF du cookie", () => {
  it("un cookie sans l'en-tête anti-CSRF : 403 « Requête refusée (protection CSRF) »", async () => {
    const manager = await createManager();

    const { erreur } = await authentifier({}, { cookies: { [AUTH_COOKIE_NAME]: tokenFor(manager) } });

    refus(erreur, 403, "CSRF_REFUSED", "Requête refusée (protection CSRF)");
  });

  it("l'en-tête anti-CSRF présent, même vide, suffit : la session par cookie est acceptée et marquée comme telle", async () => {
    const manager = await createManager();

    const { erreur, req } = await authentifier({ [CSRF_HEADER_NAME]: "" }, { cookies: { [AUTH_COOKIE_NAME]: tokenFor(manager) } });

    expect(erreur).toBeUndefined();
    expect(req.sessionParCookie).toBe(true);
  });

  it("un en-tête Authorization n'est pas soumis à l'en-tête anti-CSRF, et sa session n'est pas « par cookie »", async () => {
    const manager = await createManager();

    const { erreur, req } = await authentifier(bearer(tokenFor(manager)), { cookies: { [AUTH_COOKIE_NAME]: tokenFor(manager) } });

    expect(erreur).toBeUndefined();
    expect(req.sessionParCookie).toBe(false);
  });
});

describe("authenticate : le compte porteur du jeton", () => {
  it("un jeton valide pose l'utilisateur du jeton et la ligne du compte courant, sans rôle d'équipe pour le propriétaire", async () => {
    const manager = await createManager();

    const { erreur, req } = await authentifier(bearer(tokenFor(manager)));

    expect(erreur).toBeUndefined();
    expect(req.user?.userId).toBe(manager.id);
    expect(req.user?.role).toBe("MANAGER");
    expect(req.compteCourant?.id).toBe(manager.id);
    expect(req.roleEquipe).toBeUndefined();
  });

  it("un compte supprimé : 401 « Ce compte n'existe plus »", async () => {
    const { erreur } = await authentifier(bearer(signer({ userId: "compte-supprime", role: "MANAGER", tokenVersion: 0 })));

    refus(erreur, 401, "ACCOUNT_GONE", COMPTE_ABSENT);
  });

  it("un compte suspendu : 401 avec le code et le message de suspension, sans la raison interne", async () => {
    const manager = await createManager({ suspendedAt: new Date(), suspensionReason: "raison-interne-confidentielle" });

    const { erreur, req } = await authentifier(bearer(tokenFor(manager)));

    refus(erreur, 401, "ACCOUNT_SUSPENDED", MESSAGE_COMPTE_SUSPENDU);
    expect(erreur!.message).not.toContain("raison-interne");
    expect(req.user).toBeUndefined();
  });
});

describe("authenticate : la révocation par numéro de version", () => {
  const SESSION_FERMEE = "Votre session a été fermée. Veuillez vous reconnecter.";

  it("un jeton sans numéro vaut la version 0 : accepté tant que le compte est à 0, refusé dès la première révocation", async () => {
    const intact = await createManager({ tokenVersion: 0 });
    const revoque = await createManager({ tokenVersion: 1 });

    expect((await authentifier(bearer(signer({ userId: intact.id, role: "MANAGER" })))).erreur).toBeUndefined();
    refus((await authentifier(bearer(signer({ userId: revoque.id, role: "MANAGER" })))).erreur, 401, "SESSION_CLOSED", SESSION_FERMEE);
  });

  it("un jeton à la version du compte est accepté, quelle qu'elle soit", async () => {
    const manager = await createManager({ tokenVersion: 3 });

    expect((await authentifier(bearer(signer({ userId: manager.id, role: "MANAGER", tokenVersion: 3 })))).erreur).toBeUndefined();
  });

  it("un jeton d'une version plus ancienne OU plus récente que celle du compte est refusé", async () => {
    const manager = await createManager({ tokenVersion: 2 });

    refus((await authentifier(bearer(signer({ userId: manager.id, role: "MANAGER", tokenVersion: 1 })))).erreur, 401, "SESSION_CLOSED", SESSION_FERMEE);
    refus((await authentifier(bearer(signer({ userId: manager.id, role: "MANAGER", tokenVersion: 3 })))).erreur, 401, "SESSION_CLOSED", SESSION_FERMEE);
  });
});

describe("authenticate : un collaborateur de l'agence", () => {
  const jetonCollaborateur = (proprietaire: { id: string }, collaborateur: { id: string }, extra: Record<string, unknown> = {}) =>
    signer({ userId: proprietaire.id, role: "MANAGER", collaboratorId: collaborateur.id, ...extra });

  it("sous la formule Entreprise : accepté, avec son rôle d'équipe posé sur la requête", async () => {
    const proprietaire = await createManager();
    const collaborateur = await createTeamMember(proprietaire.id, { teamRole: "AGENT" });

    const { erreur, req } = await authentifier(bearer(jetonCollaborateur(proprietaire, collaborateur)));

    expect(erreur).toBeUndefined();
    expect(req.roleEquipe).toBe("AGENT");
    expect(req.user?.collaboratorId).toBe(collaborateur.id);
    expect(req.compteCourant?.id).toBe(proprietaire.id);
  });

  it.each([
    ["Starter", { subscriptionPlan: "STARTER" as const, subscriptionStatus: "ACTIVE" as const }],
    ["Pro", { subscriptionPlan: "PRO" as const, subscriptionStatus: "ACTIVE" as const }],
    ["Entreprise pendant l'essai (qui vaut Pro)", { subscriptionPlan: "ENTERPRISE" as const, subscriptionStatus: "TRIAL" as const }],
  ])("l'agence sur la formule %s : l'accès du collaborateur est suspendu (401), pas celui du propriétaire", async (_nom, formule) => {
    const proprietaire = await createManager();
    const collaborateur = await createTeamMember(proprietaire.id);
    const { testDb } = await import("../test/setupTestDb");
    const { users } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    await testDb.update(users).set({ ...formule, trialEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) }).where(eq(users.id, proprietaire.id));

    const { erreur } = await authentifier(bearer(jetonCollaborateur(proprietaire, collaborateur)));
    refus(erreur, 401, "COLLABORATOR_PLAN_REQUIRED");
    expect(erreur!.message).toContain("Agence & Multi-Comptes");

    expect((await authentifier(bearer(tokenFor(proprietaire)))).erreur).toBeUndefined();
  });

  it("un collaborateur supprimé : 401 « Ce compte n'existe plus »", async () => {
    const proprietaire = await createManager();
    await createTeamMember(proprietaire.id);

    const { erreur } = await authentifier(bearer(signer({ userId: proprietaire.id, role: "MANAGER", collaboratorId: "collaborateur-supprime" })));

    refus(erreur, 401, "ACCOUNT_GONE", COMPTE_ABSENT);
  });

  it("sa révocation se lit sur SA ligne, pas sur celle du propriétaire : le numéro du propriétaire n'entre pas en compte", async () => {
    const proprietaire = await createManager();
    const collaborateur = await createTeamMember(proprietaire.id);
    const { testDb } = await import("../test/setupTestDb");
    const { users } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    await testDb.update(users).set({ tokenVersion: 5 }).where(eq(users.id, proprietaire.id));

    // Le propriétaire est à 5, le collaborateur à 0 : un jeton de collaborateur à 0 reste valable.
    expect((await authentifier(bearer(jetonCollaborateur(proprietaire, collaborateur, { tokenVersion: 0 })))).erreur).toBeUndefined();

    await testDb.update(users).set({ tokenVersion: 2 }).where(eq(users.id, collaborateur.id));
    refus((await authentifier(bearer(jetonCollaborateur(proprietaire, collaborateur, { tokenVersion: 0 })))).erreur, 401, "SESSION_CLOSED");
    // Et un jeton du propriétaire à sa version reste valable.
    expect((await authentifier(bearer(signer({ userId: proprietaire.id, role: "MANAGER", tokenVersion: 5 })))).erreur).toBeUndefined();
  });

  it("un rôle restreint se voit refuser une écriture non permise : 403 avec le message du rôle ; une lecture reste ouverte", async () => {
    const proprietaire = await createManager();
    const collaborateur = await createTeamMember(proprietaire.id, { teamRole: "READ_ONLY" });
    const jeton = jetonCollaborateur(proprietaire, collaborateur);
    const verdict = verifierAutorisationEquipe("READ_ONLY", "POST", "/api/properties");
    expect(verdict.autorise).toBe(false);

    const refuse = await authentifier(bearer(jeton), { method: "POST", originalUrl: "/api/properties" });
    refus(refuse.erreur, 403, "ROLE_EQUIPE_INSUFFISANT", verdict.autorise ? undefined : verdict.message);
    expect(refuse.erreur!.message.length).toBeGreaterThan(10);
    expect(refuse.req.user).toBeUndefined();

    const lecture = await authentifier(bearer(jeton), { method: "GET", originalUrl: "/api/properties" });
    expect(lecture.erreur).toBeUndefined();
    expect(lecture.req.roleEquipe).toBe("READ_ONLY");
  });

  it("le chemin complet (avec sa requête) est transmis au contrôle de rôle : un chemin réservé n'échappe pas par un paramètre", async () => {
    const proprietaire = await createManager();
    const collaborateur = await createTeamMember(proprietaire.id, { teamRole: "READ_ONLY" });

    const { erreur } = await authentifier(bearer(jetonCollaborateur(proprietaire, collaborateur)), { method: "POST", originalUrl: "/api/properties?x=1" });

    refus(erreur, 403, "ROLE_EQUIPE_INSUFFISANT");
  });
});

describe("requireRole", () => {
  const suite = () => vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;

  it("refuse sans utilisateur et pour un rôle non listé : ApiError 403 « Accès refusé »", () => {
    const res = {} as Response;

    for (const req of [{} as Request, { user: { userId: "u", role: "TENANT" } } as Request]) {
      const next = suite();
      let levee: unknown;
      try {
        requireRole("MANAGER", "ADMIN")(req, res, next);
      } catch (e) {
        levee = e;
      }
      refus(levee as ApiError, 403, "ACCESS_DENIED", "Accès refusé");
      expect(next).not.toHaveBeenCalled();
    }
  });

  it("laisse passer un rôle listé, quel que soit son rang dans la liste", () => {
    for (const role of ["MANAGER", "ADMIN"] as const) {
      const next = suite();

      requireRole("MANAGER", "ADMIN")({ user: { userId: "u", role } } as Request, {} as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    }
  });
});

describe("exigerDeuxFacteursAdmin", () => {
  it("refuse sans compte courant ou sans double authentification activée : 403 TWO_FACTOR_SETUP_REQUIRED", () => {
    for (const compteCourant of [undefined, { totpEnabledAt: null }]) {
      const next = vi.fn();
      let levee: unknown;
      try {
        exigerDeuxFacteursAdmin({ compteCourant } as unknown as Request, {} as Response, next as NextFunction);
      } catch (e) {
        levee = e;
      }
      refus(levee as ApiError, 403, "TWO_FACTOR_SETUP_REQUIRED", "La double authentification est obligatoire pour l'administration : activez-la pour continuer.");
      expect(next).not.toHaveBeenCalled();
    }
  });

  it("laisse passer un administrateur dont la double authentification est activée", () => {
    const next = vi.fn();

    exigerDeuxFacteursAdmin({ compteCourant: { totpEnabledAt: new Date() } } as unknown as Request, {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith();
  });
});

describe("abonnementEnCours : les bornes exactes", () => {
  const MAINTENANT = new Date("2026-06-15T12:00:00.000Z");
  const avant = new Date(MAINTENANT.getTime() - 1000);
  const apres = new Date(MAINTENANT.getTime() + 1000);
  const compte = (extra: Record<string, unknown>) => extra as unknown as Parameters<typeof abonnementEnCours>[0];

  it("essai : valide jusqu'à son dernier instant EXCLU, refusé sans date de fin", () => {
    expect(abonnementEnCours(compte({ subscriptionStatus: "TRIAL", trialEndsAt: apres }), MAINTENANT)).toBe(true);
    expect(abonnementEnCours(compte({ subscriptionStatus: "TRIAL", trialEndsAt: MAINTENANT }), MAINTENANT)).toBe(false);
    expect(abonnementEnCours(compte({ subscriptionStatus: "TRIAL", trialEndsAt: avant }), MAINTENANT)).toBe(false);
    expect(abonnementEnCours(compte({ subscriptionStatus: "TRIAL", trialEndsAt: null }), MAINTENANT)).toBe(false);
  });

  it("abonnement actif : sans date de fin il est sans limite, sinon valide jusqu'à son dernier instant EXCLU", () => {
    expect(abonnementEnCours(compte({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: null }), MAINTENANT)).toBe(true);
    expect(abonnementEnCours(compte({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: apres }), MAINTENANT)).toBe(true);
    expect(abonnementEnCours(compte({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: MAINTENANT }), MAINTENANT)).toBe(false);
    expect(abonnementEnCours(compte({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: avant }), MAINTENANT)).toBe(false);
  });

  it("abonnement résilié : honoré jusqu'au terme payé EXCLU, jamais sans période connue", () => {
    expect(abonnementEnCours(compte({ subscriptionStatus: "CANCELLED", subscriptionEndsAt: apres }), MAINTENANT)).toBe(true);
    expect(abonnementEnCours(compte({ subscriptionStatus: "CANCELLED", subscriptionEndsAt: MAINTENANT }), MAINTENANT)).toBe(false);
    expect(abonnementEnCours(compte({ subscriptionStatus: "CANCELLED", subscriptionEndsAt: null }), MAINTENANT)).toBe(false);
  });

  it("un statut échu ou inconnu n'ouvre jamais l'accès, même avec une date de fin lointaine", () => {
    expect(abonnementEnCours(compte({ subscriptionStatus: "EXPIRED", subscriptionEndsAt: apres, trialEndsAt: apres }), MAINTENANT)).toBe(false);
  });

  it("sans date passée, l'heure courante est utilisée", () => {
    const futur = new Date(Date.now() + 60_000);
    const passe = new Date(Date.now() - 60_000);

    expect(abonnementEnCours(compte({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: futur }))).toBe(true);
    expect(abonnementEnCours(compte({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: passe }))).toBe(false);
  });
});

describe("requireActiveSubscription : les refus 402", () => {
  async function garde(user: { userId: string; role: "MANAGER" | "TENANT" | "ADMIN" | "OWNER" } | undefined, compteCourant: unknown) {
    const next = vi.fn();
    await requireActiveSubscription({ user, compteCourant } as unknown as Request, {} as Response, next as NextFunction);
    return next.mock.calls[0][0] as ApiError | undefined;
  }

  it("essai terminé : 402 TRIAL_ENDED avec son message", async () => {
    const manager = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: new Date(Date.now() - 1000) });

    refus(
      await garde({ userId: manager.id, role: "MANAGER" }, manager),
      402,
      "TRIAL_ENDED",
      "Votre période d'essai de 15 jours est terminée. Veuillez souscrire à un abonnement pour continuer."
    );
  });

  it("abonnement échu (actif ou résilié) : 402 SUBSCRIPTION_ENDED avec son message, jamais « essai terminé »", async () => {
    for (const statut of ["ACTIVE", "CANCELLED"] as const) {
      const manager = await createManager({ subscriptionStatus: statut, subscriptionEndsAt: new Date(Date.now() - 1000) });

      refus(await garde({ userId: manager.id, role: "MANAGER" }, manager), 402, "SUBSCRIPTION_ENDED", "Votre abonnement est arrivé à échéance. Renouvelez-le pour continuer.");
    }
  });

  it("sans utilisateur : 401 AUTH_REQUIRED ; sans compte courant : 401 ACCOUNT_GONE ; un abonnement valide passe", async () => {
    refus(await garde(undefined, undefined), 401, "AUTH_REQUIRED", "Authentification requise");
    refus(await garde({ userId: "u", role: "MANAGER" }, undefined), 401, "ACCOUNT_GONE", COMPTE_ABSENT);

    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: new Date(Date.now() + 86_400_000) });
    expect(await garde({ userId: manager.id, role: "MANAGER" }, manager)).toBeUndefined();
  });

  it("les locataires, propriétaires et administrateurs ne sont jamais soumis à l'abonnement du gestionnaire", async () => {
    const echu = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: new Date(Date.now() - 1000) });

    for (const role of ["TENANT", "OWNER", "ADMIN"] as const) {
      expect(await garde({ userId: "u", role }, echu)).toBeUndefined();
    }
  });
});

describe("formule effective : planAuMoins, assertPlanAtLeast, requirePlan", () => {
  const futur = () => new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  const actif = (formule: "STARTER" | "PRO" | "ENTERPRISE") => createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: formule, subscriptionEndsAt: futur() });

  it("hors essai : Starter n'atteint ni Pro ni Entreprise, Pro atteint Pro seulement, Entreprise atteint les deux", async () => {
    const starter = await actif("STARTER");
    const pro = await actif("PRO");
    const entreprise = await actif("ENTERPRISE");

    expect([planAuMoins(starter, "PRO"), planAuMoins(starter, "ENTERPRISE")]).toEqual([false, false]);
    expect([planAuMoins(pro, "PRO"), planAuMoins(pro, "ENTERPRISE")]).toEqual([true, false]);
    expect([planAuMoins(entreprise, "PRO"), planAuMoins(entreprise, "ENTERPRISE")]).toEqual([true, true]);
  });

  it("pendant l'essai, la formule effective est Pro quelle que soit la formule enregistrée (ni Starter, ni Entreprise)", async () => {
    const essaiStarter = await createManager({ subscriptionStatus: "TRIAL", subscriptionPlan: "STARTER", trialEndsAt: futur() });
    const essaiEntreprise = await createManager({ subscriptionStatus: "TRIAL", subscriptionPlan: "ENTERPRISE", trialEndsAt: futur() });

    expect([planAuMoins(essaiStarter, "PRO"), planAuMoins(essaiStarter, "ENTERPRISE")]).toEqual([true, false]);
    expect([planAuMoins(essaiEntreprise, "PRO"), planAuMoins(essaiEntreprise, "ENTERPRISE")]).toEqual([true, false]);
  });

  it("une formule inconnue n'ouvre rien (rang le plus bas)", async () => {
    const inconnue = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: futur() });

    const compte = { ...inconnue, subscriptionPlan: "AUTRE" } as unknown as typeof inconnue;

    expect([planAuMoins(compte, "PRO"), planAuMoins(compte, "ENTERPRISE")]).toEqual([false, false]);
  });

  it.each([
    ["PRO", "Professionnel"],
    ["ENTERPRISE", "Agence & Multi-Comptes"],
  ] as const)("assertPlanAtLeast(%s) : 403 PLAN_REQUIRED, avec le nom de la formule dans le message et dans les paramètres", async (niveau, libelle) => {
    const starter = await actif("STARTER");
    let levee: unknown;
    try {
      assertPlanAtLeast(starter, niveau);
    } catch (e) {
      levee = e;
    }

    refus(levee as ApiError, 403, "PLAN_REQUIRED", `Cette fonctionnalité est réservée à la formule ${libelle} ou supérieure. Passez à une formule supérieure pour y accéder.`);
    expect((levee as ApiError).params).toEqual({ plan: libelle });
  });

  it("assertPlanAtLeast ne lève rien quand la formule suffit", async () => {
    const pro = await actif("PRO");

    expect(() => assertPlanAtLeast(pro, "PRO")).not.toThrow();
  });

  it("requirePlan : un gestionnaire en dessous du niveau exigé est refusé (le niveau demandé est celui vérifié) ; au niveau il passe", async () => {
    const pro = await actif("PRO");
    const resultat = (user: { userId: string; role: "MANAGER" | "TENANT" | "ADMIN" | "OWNER" } | undefined, compteCourant: unknown, niveau: "PRO" | "ENTERPRISE") => {
      const next = vi.fn();
      requirePlan(niveau)({ user, compteCourant } as unknown as Request, {} as Response, next as NextFunction);
      return next.mock.calls[0][0] as ApiError | undefined;
    };

    refus(resultat({ userId: pro.id, role: "MANAGER" }, pro, "ENTERPRISE"), 403, "PLAN_REQUIRED");
    expect(resultat({ userId: pro.id, role: "MANAGER" }, pro, "PRO")).toBeUndefined();
  });

  it("requirePlan : sans utilisateur 401 AUTH_REQUIRED, sans compte courant 401 ACCOUNT_GONE, et les autres rôles (même administrateur) ne sont pas soumis à la formule", async () => {
    const starter = await actif("STARTER");
    const resultat = (user: { userId: string; role: "MANAGER" | "TENANT" | "ADMIN" | "OWNER" } | undefined, compteCourant: unknown) => {
      const next = vi.fn();
      requirePlan("PRO")({ user, compteCourant } as unknown as Request, {} as Response, next as NextFunction);
      return next.mock.calls[0][0] as ApiError | undefined;
    };

    refus(resultat(undefined, starter), 401, "AUTH_REQUIRED", "Authentification requise");
    refus(resultat({ userId: starter.id, role: "MANAGER" }, undefined), 401, "ACCOUNT_GONE", COMPTE_ABSENT);
    for (const role of ["TENANT", "OWNER", "ADMIN"] as const) {
      expect(resultat({ userId: starter.id, role }, starter)).toBeUndefined();
    }
  });
});
