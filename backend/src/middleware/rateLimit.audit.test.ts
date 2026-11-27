import express, { type RequestHandler } from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import {
  adminMessageLimiter,
  agendaFeedLimiter,
  agendaFeedLimiterStore,
  authEmailLimiter,
  authIpLimiter,
  authSecondFacteurLimiter,
  cspLimiter,
  cspLimiterStore,
  equipeInvitationLimiter,
  incidentPhotoLimiter,
  listingLeadLimiter,
  messagerieEnvoiLimiter,
} from "./rateLimit";

/**
 * Audit par sabotage de rateLimit.ts : ce que les tests de chaque route ne vérifiaient pas — les en-têtes annoncés au client, la
 * normalisation de l'adresse e-mail visée, le repli sur l'adresse IP quand rien ne désigne un compte, et les messages et fenêtres
 * des limiteurs publics. Chaque limiteur est monté seul, sur une mini-application, derrière un en-tête X-Forwarded-For qui permet de
 * jouer plusieurs adresses.
 */
const QUART_D_HEURE = 15 * 60;

function miniApp(limiteur: RequestHandler, statut = 200, utilisateur?: Record<string, unknown>) {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.post(
    "/",
    (req, _res, next) => {
      if (utilisateur) (req as unknown as { user: unknown }).user = utilisateur;
      next();
    },
    limiteur,
    (_req, res) => {
      res.status(statut).json({ ok: true });
    }
  );
  return app;
}

const depuis = (app: express.Express, ip: string, corps: object = {}) => request(app).post("/").set("X-Forwarded-For", ip).send(corps);
const restant = (res: request.Response) => Number(res.headers["ratelimit-remaining"]);
const fenetre = (res: request.Response) => Number(res.headers["ratelimit-reset"]);

afterEach(async () => {
  await agendaFeedLimiterStore.resetAll();
  await cspLimiterStore.resetAll();
});

describe("en-têtes annoncés au client", () => {
  it("la limite par IP annonce son plafond et le reste dans les en-têtes standard, sans les anciens en-têtes", async () => {
    const res = await depuis(miniApp(authIpLimiter), "10.0.0.1");

    expect(res.status).toBe(200);
    expect(res.headers["ratelimit-limit"]).toBe("20");
    expect(restant(res)).toBe(19);
    expect(fenetre(res)).toBeGreaterThan(QUART_D_HEURE - 30);
    expect(fenetre(res)).toBeLessThanOrEqual(QUART_D_HEURE);
    expect(res.headers["x-ratelimit-limit"]).toBeUndefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeUndefined();
  });
});

describe("limite par e-mail : une seule clé par adresse, quelle que soit sa forme", () => {
  it("les espaces autour et la casse ne changent pas le compteur : « Alice@Test.local » et « alice@test.local » comptent ensemble", async () => {
    const app = miniApp(authEmailLimiter);
    expect(restant(await depuis(app, "10.0.1.1", { email: "alice@test.local" }))).toBe(7);
    expect(restant(await depuis(app, "10.0.1.2", { email: "  alice@test.local  " }))).toBe(6);
    expect(restant(await depuis(app, "10.0.1.3", { email: "ALICE@TEST.LOCAL" }))).toBe(5);
    expect(restant(await depuis(app, "10.0.1.4", { email: "  Alice@Test.local" }))).toBe(4);
  });

  it("deux adresses différentes ont chacune leur compteur", async () => {
    const app = miniApp(authEmailLimiter);
    expect(restant(await depuis(app, "10.0.1.5", { email: "alice@test.local" }))).toBe(7);
    expect(restant(await depuis(app, "10.0.1.5", { email: "bob@test.local" }))).toBe(7);
  });

  it.each([[{}], [{ email: "" }], [{ email: "   " }], [{ email: 5 }], [{ email: ["a@test.local"] }], [{ email: { a: 1 } }], [{ email: null }]])(
    "sans adresse exploitable (%j), le compteur retombe sur l'IP : deux adresses IP ne se partagent pas un compteur",
    async (corps) => {
      const app = miniApp(authEmailLimiter);
      expect(restant(await depuis(app, "10.0.2.1", corps))).toBe(7);
      expect(restant(await depuis(app, "10.0.2.2", corps))).toBe(7);
      expect(restant(await depuis(app, "10.0.2.1", corps))).toBe(6);
    }
  );

  it("refuse la 9e tentative sur la même adresse avec le message de l'e-mail visé", async () => {
    const app = miniApp(authEmailLimiter);
    for (let i = 0; i < 8; i++) expect((await depuis(app, `10.0.3.${i}`, { email: "cible@test.local" })).status).toBe(200);
    const res = await depuis(app, "10.0.3.99", { email: "cible@test.local" });
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "Trop de tentatives pour ce compte. Réessayez dans quelques minutes." });
  });
});

describe("limite du second facteur : sans compte identifiable, par IP", () => {
  it.each([[{}], [{ pendingToken: 12345 }], [{ pendingToken: "pas-un-jeton" }]])("corps %j : deux adresses IP ne se partagent pas un compteur", async (corps) => {
    const app = miniApp(authSecondFacteurLimiter, 401);
    expect(restant(await depuis(app, "10.0.4.1", corps))).toBe(7);
    expect(restant(await depuis(app, "10.0.4.2", corps))).toBe(7);
    expect(restant(await depuis(app, "10.0.4.1", corps))).toBe(6);
  });

  it("le 9e échec est refusé avec le message du compte visé", async () => {
    const app = miniApp(authSecondFacteurLimiter, 401);
    for (let i = 0; i < 8; i++) expect((await depuis(app, "10.0.5.1")).status).toBe(401);
    const res = await depuis(app, "10.0.5.1");
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "Trop de tentatives pour ce compte. Réessayez dans quelques minutes." });
  });
});

describe("limiteurs par compte : sans utilisateur reconnu, le repli se fait par adresse IP", () => {
  it.each([
    ["messagerie", messagerieEnvoiLimiter, 60],
    ["photos d'incident", incidentPhotoLimiter, 30],
    ["invitations d'équipe", equipeInvitationLimiter, 30],
    ["messages de l'administration", adminMessageLimiter, 30],
  ])("%s : deux adresses IP ne se partagent pas un compteur, et rien ne plante", async (_nom, limiteur, plafond) => {
    const app = miniApp(limiteur);
    const a = await depuis(app, "10.0.6.1");
    const b = await depuis(app, "10.0.6.2");
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(restant(a)).toBe(plafond - 1);
    expect(restant(b)).toBe(plafond - 1);
    expect(restant(await depuis(app, "10.0.6.1"))).toBe(plafond - 2);
  });
});

describe("limiteurs publics : plafond, fenêtre et message", () => {
  async function jusquAuRefus(app: express.Express, plafond: number, statut = 200) {
    for (let i = 0; i < plafond; i++) expect((await depuis(app, "10.0.7.1")).status).toBe(statut);
    return depuis(app, "10.0.7.1");
  }

  it("calendrier public : 30 échecs passent, le 31e est refusé avec son message en texte brut", async () => {
    const res = await jusquAuRefus(miniApp(agendaFeedLimiter, 404), 30, 404);
    expect(res.status).toBe(429);
    expect(res.text).toBe("Too many attempts. Try again later.");
  });

  it("rapports de sécurité du navigateur : 60 par minute passent, le 61e est refusé ; la fenêtre est d'une minute", async () => {
    const app = miniApp(cspLimiter);
    const premier = await depuis(app, "10.0.7.2");
    expect(fenetre(premier)).toBeGreaterThan(30);
    expect(fenetre(premier)).toBeLessThanOrEqual(60);

    for (let i = 1; i < 60; i++) expect((await depuis(app, "10.0.7.2")).status).toBe(200);
    const res = await depuis(app, "10.0.7.2");
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "Trop de rapports envoyés depuis cette adresse." });
  });

  it("demandes de contact de la vitrine : 10 passent, la 11e est refusée avec son message ; la fenêtre est de 15 minutes", async () => {
    const app = miniApp(listingLeadLimiter);
    const premier = await depuis(app, "10.0.7.3");
    expect(fenetre(premier)).toBeGreaterThan(QUART_D_HEURE - 30);
    expect(fenetre(premier)).toBeLessThanOrEqual(QUART_D_HEURE);

    for (let i = 1; i < 10; i++) expect((await depuis(app, "10.0.7.3")).status).toBe(200);
    const res = await depuis(app, "10.0.7.3");
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "Trop de demandes envoyées depuis cette adresse. Réessayez dans quelques minutes." });
  });
});
