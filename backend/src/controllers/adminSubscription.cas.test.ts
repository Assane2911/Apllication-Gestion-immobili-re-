import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { adminAuditLogs, users } from "../db/schema";
import * as emailService from "../services/email.service";
import { authHeader, createAdmin, createManager, createTeamMember, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Audit par sabotage de adminSubscription.controller.ts : les cas que les tests d'origine (admin.subscription, admin.accesIllimite,
 * admin.trialReminder) ne tenaient pas — bornes des paramètres, codes d'erreur, contenu EXACT de la trace d'audit, réponses,
 * colonnes touchées, ET comptes voisins laissés intacts (une mise à jour sans clause WHERE changerait tous les gestionnaires).
 *
 * L'horloge est figée (Date seule) : les dates de fin, les jours restants et les traces sont donc exactes.
 */
const MAINTENANT = new Date("2026-11-26T10:00:00.000Z");
const JOUR = 86_400_000;
const apresMaintenant = (jours: number) => new Date(MAINTENANT.getTime() + jours * JOUR);
const iso = (d: Date) => d.toISOString();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MAINTENANT);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const relire = async (id: string) => (await testDb.select().from(users).where(eq(users.id, id)))[0];
const journal = () => testDb.select().from(adminAuditLogs);

const offrir = (id: string, token: string, body: Record<string, unknown> = { days: 10, reason: "Geste commercial" }) =>
  request(app).post(`/api/admin/managers/${id}/subscription/grant-days`).set(authHeader(token)).send(body);
const changerPlan = (id: string, token: string, body: Record<string, unknown> = { plan: "PRO", reason: "Erreur de souscription" }) =>
  request(app).post(`/api/admin/managers/${id}/subscription/change-plan`).set(authHeader(token)).send(body);
const accorder = (id: string, token: string, body: Record<string, unknown> = { reason: "Compte de la direction" }) =>
  request(app).post(`/api/admin/managers/${id}/subscription/grant-unlimited`).set(authHeader(token)).send(body);
const retirer = (id: string, token: string, body: Record<string, unknown> = { reason: "Fin de la convention" }) =>
  request(app).post(`/api/admin/managers/${id}/subscription/revoke-unlimited`).set(authHeader(token)).send(body);
const relancer = (id: string, token: string) => request(app).post(`/api/admin/managers/${id}/trial-reminder`).set(authHeader(token));

/** Les cinq actions qui modifient un gestionnaire, pour les cas qui leur sont communs. */
const ACTIONS_QUI_MODIFIENT = [
  ["offrir des jours", offrir],
  ["changer de formule", changerPlan],
  ["accorder l'accès illimité", accorder],
  ["retirer l'accès illimité", retirer],
] as const;

describe("gestionnaire visé : 404 avec son code, abonnement Stripe refusé avec son code", () => {
  it.each(ACTIONS_QUI_MODIFIENT)("%s : un identifiant inconnu, un collaborateur ou un administrateur → 404 MANAGER_NOT_FOUND", async (_nom, action) => {
    const admin = await createAdmin();
    const manager = await createManager();
    const collaborateur = await createTeamMember(manager.id);
    for (const id of ["inconnu", collaborateur.id, admin.id]) {
      const res = await action(id, tokenFor(admin));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("MANAGER_NOT_FOUND");
    }
    expect(await journal()).toEqual([]);
  });

  it.each([
    ["offrir des jours", offrir],
    ["changer de formule", (id: string, t: string) => changerPlan(id, t, { plan: "ENTERPRISE", reason: "Erreur" })],
    ["accorder l'accès illimité", accorder],
  ] as const)("%s : un abonnement Stripe à renouvellement automatique → 409 SUBSCRIPTION_STRIPE_MANAGED, sans rien modifier", async (_nom, action) => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: apresMaintenant(20), stripeSubscriptionId: "sub_1" });

    const res = await action(manager.id, token);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SUBSCRIPTION_STRIPE_MANAGED");
    expect(await relire(manager.id)).toMatchObject({ subscriptionPlan: "STARTER", subscriptionStatus: "ACTIVE" });
    expect(await journal()).toEqual([]);
  });
});

describe("offrir des jours : paramètres", () => {
  it("les bornes passent : 1 jour, 365 jours, jours envoyés en texte, motif de 3 et de 500 caractères", async () => {
    const token = tokenFor(await createAdmin());
    const cas: Array<[Record<string, unknown>, number]> = [
      [{ days: 1, reason: "abc" }, 1],
      [{ days: 365, reason: "x".repeat(500) }, 365],
      [{ days: "10", reason: "Geste" }, 10],
    ];
    for (const [corps, jours] of cas) {
      const manager = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: apresMaintenant(5) });
      const res = await offrir(manager.id, token, corps);
      expect(res.status).toBe(200);
      expect((await relire(manager.id)).trialEndsAt!.getTime()).toBe(apresMaintenant(5 + jours).getTime());
    }
  });

  it("un motif de 501 caractères, de 2 caractères ou de seuls espaces est refusé", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: apresMaintenant(5) });
    for (const reason of ["x".repeat(501), "ab", "     "]) {
      expect((await offrir(manager.id, token, { days: 5, reason })).status).toBe(400);
    }
    expect((await relire(manager.id)).trialEndsAt!.getTime()).toBe(apresMaintenant(5).getTime());
    expect(await journal()).toEqual([]);
  });
});

describe("offrir des jours : abonnement payant", () => {
  it("prolonge la fin d'abonnement, répond avec la nouvelle fin et trace l'ancienne puis la nouvelle date", async () => {
    const admin = await createAdmin();
    const fin = new Date("2027-03-10T12:00:00.000Z");
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", subscriptionEndsAt: fin });

    const res = await offrir(manager.id, tokenFor(admin), { days: 10, reason: "Geste commercial" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, endsAt: "2027-03-20T12:00:00.000Z" });
    const apres = await relire(manager.id);
    expect(apres.subscriptionEndsAt!.getTime()).toBe(new Date("2027-03-20T12:00:00.000Z").getTime());
    expect(apres.subscriptionStatus).toBe("ACTIVE"); // jamais forcé
    expect(apres.trialEndsAt!.getTime()).toBe(manager.trialEndsAt!.getTime()); // l'essai n'est pas touché
    const [ligne] = await journal();
    expect(ligne.targetLabel).toBe(manager.email);
    expect(ligne.details).toBe("10 jour(s) offert(s) sur l'abonnement : fin 2027-03-10 → 2027-03-20. Motif : Geste commercial");
  });

  it("un abonnement résilié SANS date de fin n'est pas illimité : les jours partent de maintenant", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({ subscriptionStatus: "CANCELLED", subscriptionEndsAt: null });

    const res = await offrir(manager.id, token, { days: 7, reason: "Geste commercial" });

    expect(res.status).toBe(200);
    expect(res.body.endsAt).toBe(iso(apresMaintenant(7)));
    expect(await relire(manager.id)).toMatchObject({ subscriptionStatus: "CANCELLED" });
    expect((await journal())[0].details).toBe("7 jour(s) offert(s) sur l'abonnement : fin — → 2026-12-03. Motif : Geste commercial");
  });

  it("un abonnement ACTIVE sans échéance (illimité) est refusé avec son code, sans trace", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: null });

    const res = await offrir(manager.id, token);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SUBSCRIPTION_NO_EXPIRY");
    expect(await journal()).toEqual([]);
  });

  it("ne touche aucun autre gestionnaire", async () => {
    const token = tokenFor(await createAdmin());
    const fin = new Date("2027-03-10T12:00:00.000Z");
    const cible = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: fin });
    const voisin = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: new Date("2027-05-01T08:00:00.000Z") });

    await offrir(cible.id, token);

    expect((await relire(voisin.id)).subscriptionEndsAt!.getTime()).toBe(new Date("2027-05-01T08:00:00.000Z").getTime());
  });
});

describe("offrir des jours : essai", () => {
  it("prolonge l'essai (jamais la fin d'abonnement), répond avec la nouvelle fin et trace l'ancienne date d'ESSAI", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({
      subscriptionStatus: "TRIAL",
      trialEndsAt: new Date("2026-12-01T10:00:00.000Z"),
      subscriptionEndsAt: new Date("2025-01-01T00:00:00.000Z"), // reliquat d'un ancien abonnement
    });

    const res = await offrir(manager.id, token, { days: 10, reason: "Geste commercial" });

    expect(res.body).toEqual({ success: true, endsAt: "2026-12-11T10:00:00.000Z" });
    const apres = await relire(manager.id);
    expect(apres.subscriptionEndsAt!.getTime()).toBe(new Date("2025-01-01T00:00:00.000Z").getTime());
    const [ligne] = await journal();
    expect(ligne.targetLabel).toBe(manager.email);
    expect(ligne.details).toBe("10 jour(s) offert(s) sur l'essai : fin 2026-12-01 → 2026-12-11. Motif : Geste commercial");
  });

  it("sans date de fin d'essai, la trace met un tiret et les jours partent de maintenant", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: null });

    const res = await offrir(manager.id, token, { days: 10, reason: "Geste commercial" });

    expect(res.body.endsAt).toBe(iso(apresMaintenant(10)));
    expect((await journal())[0].details).toBe("10 jour(s) offert(s) sur l'essai : fin — → 2026-12-06. Motif : Geste commercial");
  });

  it("ne touche aucun autre gestionnaire", async () => {
    const token = tokenFor(await createAdmin());
    const cible = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: apresMaintenant(3) });
    const voisin = await createManager({ subscriptionStatus: "EXPIRED", trialEndsAt: apresMaintenant(-30) });

    await offrir(cible.id, token);

    const apres = await relire(voisin.id);
    expect(apres.subscriptionStatus).toBe("EXPIRED");
    expect(apres.trialEndsAt!.getTime()).toBe(apresMaintenant(-30).getTime());
  });
});

describe("changer de formule : cas limites", () => {
  it("passe à Starter (la formule d'entrée), sans toucher ni au statut ni aux dates ; répond avec la formule et trace avec les NOMS", async () => {
    const token = tokenFor(await createAdmin());
    const fin = apresMaintenant(5);
    const manager = await createManager({ subscriptionStatus: "TRIAL", subscriptionPlan: "PRO", trialEndsAt: fin });

    const res = await changerPlan(manager.id, token, { plan: "STARTER", reason: "Erreur de souscription" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, plan: "STARTER" });
    const apres = await relire(manager.id);
    expect(apres).toMatchObject({ subscriptionPlan: "STARTER", subscriptionStatus: "TRIAL" });
    expect(apres.trialEndsAt!.getTime()).toBe(fin.getTime());
    expect(apres.subscriptionEndsAt).toBeNull();
    const [ligne] = await journal();
    expect(ligne.targetLabel).toBe(manager.email);
    expect(ligne.details).toBe("Formule Professionnel → Starter. Motif : Erreur de souscription");
  });

  it("la formule déjà en place : 409 avec son code, le nom de la formule en paramètre et dans le message", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({ subscriptionPlan: "PRO" });

    const res = await changerPlan(manager.id, token, { plan: "PRO", reason: "Erreur" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MANAGER_ALREADY_ON_PLAN");
    expect(res.body.params).toEqual({ plan: "Professionnel" });
    expect(res.body.error).toBe("Ce gestionnaire est déjà sur la formule Professionnel.");
  });

  it("ne touche aucun autre gestionnaire", async () => {
    const token = tokenFor(await createAdmin());
    const cible = await createManager({ subscriptionPlan: "STARTER" });
    const voisin = await createManager({ subscriptionPlan: "STARTER" });

    await changerPlan(cible.id, token, { plan: "ENTERPRISE", reason: "Erreur" });

    expect((await relire(voisin.id)).subscriptionPlan).toBe("STARTER");
  });
});

describe("accès illimité : cas limites", () => {
  it("accorder : l'essai n'est pas effacé, et la trace dit l'ancien statut, l'ancienne formule PAR SON NOM et la fin (tiret sans fin)", async () => {
    const token = tokenFor(await createAdmin());
    const fin = apresMaintenant(4);
    const manager = await createManager({ subscriptionStatus: "TRIAL", subscriptionPlan: "STARTER", trialEndsAt: fin });

    const res = await accorder(manager.id, token, { reason: "Compte de la direction" });

    expect(res.status).toBe(200);
    expect((await relire(manager.id)).trialEndsAt!.getTime()).toBe(fin.getTime());
    const [ligne] = await journal();
    expect(ligne.targetLabel).toBe(manager.email);
    expect(ligne.details).toBe("Accès illimité accordé (avant : TRIAL, formule Starter, fin —). Motif : Compte de la direction");
  });

  it("accorder : la trace donne l'ancienne fin d'abonnement au format AAAA-MM-JJ", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({
      subscriptionStatus: "CANCELLED",
      subscriptionPlan: "PRO",
      subscriptionEndsAt: new Date("2027-03-10T12:00:00.000Z"),
    });

    await accorder(manager.id, token, { reason: "Convention" });

    expect((await journal())[0].details).toBe("Accès illimité accordé (avant : CANCELLED, formule Professionnel, fin 2027-03-10). Motif : Convention");
  });

  it("accorder deux fois : 409 MANAGER_ALREADY_UNLIMITED", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: null });

    const res = await accorder(manager.id, token);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MANAGER_ALREADY_UNLIMITED");
    expect(await journal()).toEqual([]);
  });

  it("accorder ne touche aucun autre gestionnaire", async () => {
    const token = tokenFor(await createAdmin());
    const cible = await createManager({ subscriptionStatus: "TRIAL" });
    const voisin = await createManager({ subscriptionStatus: "TRIAL", subscriptionPlan: "STARTER" });

    await accorder(cible.id, token);

    expect(await relire(voisin.id)).toMatchObject({ subscriptionStatus: "TRIAL", subscriptionPlan: "STARTER", subscriptionEndsAt: null });
  });

  it("retirer : le compte passe à EXPIRED en gardant sa formule Entreprise ; trace avec l'e-mail ; aucun autre compte touché", async () => {
    const token = tokenFor(await createAdmin());
    const cible = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: null });
    const voisin = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: null });

    const res = await retirer(cible.id, token, { reason: "Fin de la convention" });

    expect(res.status).toBe(200);
    expect(await relire(cible.id)).toMatchObject({ subscriptionStatus: "EXPIRED", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: null });
    expect(await relire(voisin.id)).toMatchObject({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: null });
    const [ligne] = await journal();
    expect(ligne.targetLabel).toBe(cible.email);
    expect(ligne.details).toBe("Accès illimité retiré. Motif : Fin de la convention");
  });

  it("retirer sur un compte qui n'est pas illimité : 409 MANAGER_NOT_UNLIMITED", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({ subscriptionStatus: "TRIAL" });

    const res = await retirer(manager.id, token);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MANAGER_NOT_UNLIMITED");
    expect(await journal()).toEqual([]);
  });
});

describe("rappel de fin d'essai : cas limites", () => {
  let envoi: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false, messageId: "m1" } as never);
  });
  const messages = () => envoi.mock.calls.map((c: unknown[]) => ({ a: c[0] as string, sujet: c[1] as string, html: c[2] as string }));
  const FIN = new Date("2026-12-01T10:00:00.000Z"); // dans 5 jours

  it("le message dit la date de fin, le délai, l'adresse du site, et la trace donne l'e-mail et la date", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({ trialEndsAt: FIN });

    const res = await relancer(manager.id, token);

    expect(res.status).toBe(200);
    const [msg] = messages();
    expect(msg.sujet).toBe("Votre essai gratuit se termine dans 5 jours");
    expect(msg.html).toContain("<strong>1 décembre 2026</strong> (dans 5 jours)");
    expect(msg.html).toContain(`href="${env.frontendUrl}/subscription"`);
    const [ligne] = await journal();
    expect(ligne.targetLabel).toBe(manager.email);
    expect(ligne.details).toBe("Rappel de fin d'essai envoyé (fin le 2026-12-01).");
  });

  it("le message est écrit dans la langue du gestionnaire", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({ trialEndsAt: FIN, language: "en" });

    await relancer(manager.id, token);

    const [msg] = messages();
    expect(msg.sujet).toBe("Your free trial ends in 5 days");
    expect(msg.html).toContain("in 5 days");
  });

  it("un essai qui finit CE JOUR annonce « demain » (jamais « aujourd'hui » ni un délai de 2 jours)", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({ trialEndsAt: new Date("2026-11-26T20:00:00.000Z") });

    const res = await relancer(manager.id, token);

    expect(res.status).toBe(200);
    expect(messages()[0].html).toContain("(demain)");
  });

  it("un essai qui finit à l'instant précis de la demande est terminé : refusé", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({ trialEndsAt: new Date("2026-11-26T10:00:00.000Z") });

    const res = await relancer(manager.id, token);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TRIAL_REMINDER_NOT_IN_TRIAL");
    expect(envoi).not.toHaveBeenCalled();
  });

  it("un compte en essai SANS date de fin n'est pas en essai en cours : 409, pas une erreur 500", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: null });

    const res = await relancer(manager.id, token);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TRIAL_REMINDER_NOT_IN_TRIAL");
  });

  it("la réclamation ne touche que le gestionnaire visé : un autre essai à la même échéance reste à relancer", async () => {
    const token = tokenFor(await createAdmin());
    const premier = await createManager({ trialEndsAt: FIN });
    const second = await createManager({ trialEndsAt: FIN });

    await relancer(premier.id, token);

    expect((await relire(premier.id)).endingNoticeFor!.getTime()).toBe(FIN.getTime());
    expect((await relire(second.id)).endingNoticeFor).toBeNull();
    expect((await relancer(second.id, token)).status).toBe(200);
  });

  it("un rappel déjà parti pour une ANCIENNE échéance (essai prolongé depuis) n'empêche pas le nouveau rappel", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({ trialEndsAt: FIN, endingNoticeFor: new Date("2026-11-30T10:00:00.000Z") });

    const res = await relancer(manager.id, token);

    expect(res.status).toBe(200);
    expect((await relire(manager.id)).endingNoticeFor!.getTime()).toBe(FIN.getTime());
  });

  it("si l'envoi échoue, seule la réclamation du gestionnaire visé est rendue : celle d'un autre compte reste en place", async () => {
    const token = tokenFor(await createAdmin());
    const cible = await createManager({ trialEndsAt: FIN });
    const voisin = await createManager({ trialEndsAt: FIN, endingNoticeFor: FIN }); // rappel déjà parti
    envoi.mockResolvedValueOnce({ simulated: false, error: true } as never);

    const res = await relancer(cible.id, token);

    expect(res.status).toBe(502);
    expect((await relire(cible.id)).endingNoticeFor).toBeNull();
    expect((await relire(voisin.id)).endingNoticeFor!.getTime()).toBe(FIN.getTime());
  });
});
