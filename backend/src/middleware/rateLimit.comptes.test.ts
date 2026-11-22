import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { genererCodeTotp, genererSecretTotp } from "../services/totp.service";
import {
  authHeader,
  createAdmin,
  createContract,
  createManager,
  createProperty,
  createTeamMember,
  createTenant,
  tokenFor,
} from "../test/authHelpers";

/**
 * Les limiteurs « par compte » comptent sous une CLÉ qui désigne l'auteur du geste. Pour un collaborateur d'agence, le jeton porte
 * l'identité de l'AGENCE (userId) et sa propre identité (collaboratorId) : la clé doit retenir celle du collaborateur, sinon tous les
 * collaborateurs d'une agence (et son propriétaire) épuisent le MÊME quota, et l'un d'eux bloque les autres. Le quota restant est lu
 * dans l'en-tête standard `RateLimit-Remaining`, présent même sur une réponse d'erreur : la limite se vérifie donc sans en épuiser
 * une seule (quelques requêtes suffisent à voir si deux auteurs partagent un compteur).
 */
const restant = (res: request.Response) => Number(res.headers["ratelimit-remaining"]);

/** Secondes avant la remise à zéro du compteur, annoncées par `RateLimit-Reset` : la fenêtre du limiteur, à quelques secondes près. */
const fenetre = (res: request.Response) => Number(res.headers["ratelimit-reset"]);
const QUART_D_HEURE = 15 * 60;
const UNE_HEURE = 60 * 60;

async function agenceAvecCollaborateur() {
  const manager = await createManager();
  const collaborateur = await createTeamMember(manager.id);
  const jetonCollaborateur = tokenFor({ id: manager.id, role: "MANAGER" }, null, null, collaborateur.id);
  const jetonProprietaire = tokenFor(manager);
  return { manager, collaborateur, jetonCollaborateur, jetonProprietaire };
}

describe("limite d'envoi de messages : un compteur par auteur", () => {
  it("un collaborateur et le propriétaire de l'agence ne partagent pas le même quota", async () => {
    const { manager, jetonCollaborateur, jetonProprietaire } = await agenceAvecCollaborateur();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const envoyer = (jeton: string) => request(app).post(`/api/messages/${contract.id}`).set(authHeader(jeton)).send({});

    const c1 = await envoyer(jetonCollaborateur);
    expect(restant(c1)).toBe(59);
    const c2 = await envoyer(jetonCollaborateur);
    expect(restant(c2)).toBe(58);

    // Le propriétaire repart de la limite entière : son compteur n'est pas celui de son collaborateur.
    const p1 = await envoyer(jetonProprietaire);
    expect(restant(p1)).toBe(59);
    // Et la limite annoncée est bien celle des messages (60), pas celle d'un autre limiteur.
    expect(Number(p1.headers["ratelimit-limit"])).toBe(60);
    expect(fenetre(p1)).toBeGreaterThan(QUART_D_HEURE - 30);
    expect(fenetre(p1)).toBeLessThanOrEqual(QUART_D_HEURE);
  });
});

describe("limite de dépôt de photos d'incident : un compteur par auteur", () => {
  it("un collaborateur et le propriétaire de l'agence ne partagent pas le même quota", async () => {
    const { jetonCollaborateur, jetonProprietaire } = await agenceAvecCollaborateur();
    const deposer = (jeton: string) => request(app).post("/api/issues/inexistant/photo").set(authHeader(jeton));

    expect(restant(await deposer(jetonCollaborateur))).toBe(29);
    expect(restant(await deposer(jetonCollaborateur))).toBe(28);

    const proprietaire = await deposer(jetonProprietaire);
    expect(restant(proprietaire)).toBe(29);
    expect(Number(proprietaire.headers["ratelimit-limit"])).toBe(30);
    expect(fenetre(proprietaire)).toBeGreaterThan(QUART_D_HEURE - 30);
    expect(fenetre(proprietaire)).toBeLessThanOrEqual(QUART_D_HEURE);
  });

  it("deux collaborateurs de la même agence ont chacun le leur", async () => {
    const manager = await createManager();
    const un = await createTeamMember(manager.id);
    const deux = await createTeamMember(manager.id);
    const deposer = (collaboratorId: string) =>
      request(app).post("/api/issues/inexistant/photo").set(authHeader(tokenFor({ id: manager.id, role: "MANAGER" }, null, null, collaboratorId)));

    expect(restant(await deposer(un.id))).toBe(29);
    expect(restant(await deposer(un.id))).toBe(28);
    expect(restant(await deposer(deux.id))).toBe(29);
  });
});

describe("limite du second facteur : un compteur par auteur", () => {
  it("un collaborateur et le propriétaire de l'agence ne partagent pas le même quota", async () => {
    const { jetonCollaborateur, jetonProprietaire } = await agenceAvecCollaborateur();
    const confirmer = (jeton: string) => request(app).post("/api/auth/2fa/confirm").set(authHeader(jeton)).send({});

    expect(restant(await confirmer(jetonCollaborateur))).toBe(7);
    expect(restant(await confirmer(jetonCollaborateur))).toBe(6);

    const proprietaire = await confirmer(jetonProprietaire);
    expect(restant(proprietaire)).toBe(7);
    expect(Number(proprietaire.headers["ratelimit-limit"])).toBe(8);
    expect(fenetre(proprietaire)).toBeGreaterThan(QUART_D_HEURE - 30);
    expect(fenetre(proprietaire)).toBeLessThanOrEqual(QUART_D_HEURE);
  });
});

describe("limite d'envoi de messages libres de l'administration : un compteur par administrateur", () => {
  it("deux administrateurs ne partagent pas le même quota", async () => {
    const un = await createAdmin();
    const deux = await createAdmin();
    const ecrire = (admin: { id: string }) =>
      request(app).post("/api/admin/users/inexistant/message").set(authHeader(tokenFor(admin as never))).send({});

    expect(restant(await ecrire(un))).toBe(29);
    expect(restant(await ecrire(un))).toBe(28);
    const autre = await ecrire(deux);
    expect(restant(autre)).toBe(29);
    expect(Number(autre.headers["ratelimit-limit"])).toBe(30);
    expect(fenetre(autre)).toBeGreaterThan(UNE_HEURE - 30);
    expect(fenetre(autre)).toBeLessThanOrEqual(UNE_HEURE);
  });
});

describe("limite des invitations d'équipe : un compteur par agence, partagé entre inviter et renvoyer", () => {
  it("compte les deux gestes ensemble, sans toucher à une autre agence", async () => {
    const entreprise = { subscriptionPlan: "ENTERPRISE" as const, subscriptionStatus: "ACTIVE" as const, subscriptionEndsAt: new Date(Date.now() + 30 * 86_400_000) };
    const agence = await createManager(entreprise);
    const autre = await createManager(entreprise);
    const inviter = (m: { id: string }) => request(app).post("/api/team").set(authHeader(tokenFor(m as never))).send({});
    const renvoyer = (m: { id: string }) => request(app).post("/api/team/inexistant/resend").set(authHeader(tokenFor(m as never))).send({});

    const premier = await inviter(agence);
    expect(restant(premier)).toBe(29);
    expect(Number(premier.headers["ratelimit-limit"])).toBe(30);
    expect(fenetre(premier)).toBeGreaterThan(UNE_HEURE - 30);
    expect(fenetre(premier)).toBeLessThanOrEqual(UNE_HEURE);
    expect(restant(await renvoyer(agence))).toBe(28);
    expect(restant(await inviter(autre))).toBe(29);
  });
});

describe("compte désigné par le jeton intermédiaire du second facteur", () => {
  const jetonEnAttente = (userId: string, extra: Record<string, unknown> = {}) =>
    jwt.sign({ userId, purpose: "2fa_pending", ...extra }, env.jwtSecret, { expiresIn: "5m" });
  const verifier = (pendingToken: string, code = "000000") => request(app).post("/api/auth/2fa/verify-login").send({ pendingToken, code });

  it("un jeton signé mais d'un autre usage ne désigne personne : il ne compte pas contre le compte visé", async () => {
    const victime = await createManager();
    const detourne = jwt.sign({ userId: victime.id, purpose: "access" }, env.jwtSecret, { expiresIn: "5m" });

    await verifier(detourne);
    await verifier(detourne);

    // Le vrai jeton de la victime repart d'un compteur intact : 8 moins cet unique échec.
    expect(restant(await verifier(jetonEnAttente(victime.id)))).toBe(7);
  });

  it("un jeton forgé (autre secret) ne désigne personne : il ne compte pas contre le compte visé", async () => {
    const victime = await createManager();
    const forge = jwt.sign({ userId: victime.id, purpose: "2fa_pending" }, "autre-secret", { expiresIn: "5m" });

    await verifier(forge);
    await verifier(forge);

    expect(restant(await verifier(jetonEnAttente(victime.id)))).toBe(7);
  });

  it("un identifiant qui n'est pas un texte ne désigne personne : deux jetons de ce genre se partagent le compteur de l'adresse", async () => {
    const un = await verifier(jetonEnAttente(null as never, { userId: 111 }));
    const deux = await verifier(jetonEnAttente(null as never, { userId: 222 }));

    // Un compteur par identifiant donnerait 7 aux deux ; celui de l'adresse, partagé, décroît.
    expect(restant(deux)).toBe(restant(un) - 1);
  });

  it("une connexion réussie ne consomme pas le quota : seuls les échecs comptent", async () => {
    const secret = genererSecretTotp();
    const manager = await createManager({ totpSecret: secret, totpEnabledAt: new Date() });

    const reussie = await verifier(jetonEnAttente(manager.id), await genererCodeTotp(secret));
    expect(reussie.status).toBe(200);

    // Une vraie connexion suivie d'un échec : le compteur n'a bougé que pour l'échec.
    expect(restant(await verifier(jetonEnAttente(manager.id)))).toBe(7);
  });
});

describe("refus au-delà de la limite : message et code propres à chaque limiteur", () => {
  /** Envoie `limite` requêtes (toutes acceptées par le limiteur), puis une de plus : celle-là est refusée en 429. */
  async function depasser(envoyer: () => request.Test, limite: number) {
    for (let i = 0; i < limite; i++) {
      expect((await envoyer()).status).not.toBe(429);
    }
    return envoyer();
  }

  it("messagerie : 60 envois passent, le 61e est refusé avec son code", async () => {
    const { jetonProprietaire } = await agenceAvecCollaborateur();
    const res = await depasser(() => request(app).post("/api/messages/inexistant").set(authHeader(jetonProprietaire)).send({}), 60);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "Trop de messages envoyés en peu de temps. Réessayez dans quelques minutes.", code: "MESSAGE_RATE_LIMITED" });
  });

  it("photos d'incident : 30 dépôts passent, le 31e est refusé avec son code", async () => {
    const { jetonProprietaire } = await agenceAvecCollaborateur();
    const res = await depasser(() => request(app).post("/api/issues/inexistant/photo").set(authHeader(jetonProprietaire)), 30);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "Trop de photos envoyées en peu de temps. Réessayez dans quelques minutes.", code: "ISSUE_RATE_LIMITED" });
  });

  it("invitations d'équipe : 30 invitations passent, la 31e est refusée avec son code", async () => {
    const agence = await createManager({ subscriptionPlan: "ENTERPRISE", subscriptionStatus: "ACTIVE", subscriptionEndsAt: new Date(Date.now() + 30 * 86_400_000) });
    const res = await depasser(() => request(app).post("/api/team").set(authHeader(tokenFor(agence))).send({}), 30);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "Trop d'invitations envoyées en peu de temps. Réessayez dans une heure.", code: "TEAM_INVITE_RATE_LIMITED" });
  });

  it("messages libres de l'administration : 30 envois passent, le 31e est refusé avec son code", async () => {
    const admin = await createAdmin();
    const res = await depasser(() => request(app).post("/api/admin/users/inexistant/message").set(authHeader(tokenFor(admin as never))).send({}), 30);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "Trop de messages envoyés en peu de temps. Réessayez dans une heure.", code: "ADMIN_MESSAGE_RATE_LIMITED" });
  });
});
