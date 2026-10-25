import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { cspLimiterStore } from "../middleware/rateLimit";

/**
 * Le site envoie sa politique de sécurité de contenu en mode OBSERVATION (Content-Security-Policy-Report-Only) : le
 * navigateur ne bloque rien mais signale chaque violation ici. Sans point de collecte, l'observation ne servirait à
 * personne : les violations ne s'affichent que dans la console du visiteur.
 *
 * Ce point est public (le navigateur n'envoie aucun cookie) : il n'écrit RIEN en base, répond toujours 204, et ne
 * journalise qu'une ligne courte et nettoyée par rapport — ni requête, ni fragment d'adresse (un lien de
 * réinitialisation de mot de passe y figure), ni retour à la ligne (injection dans les journaux).
 */
const ROUTE = "/api/csp-report";

const rapportHistorique = (surcharge: Record<string, unknown> = {}) => ({
  "csp-report": {
    "document-uri": "https://www.immoplatformpro.com/login",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "blocked-uri": "https://exemple-tiers.test/script.js",
    ...surcharge,
  },
});

function envoyerHistorique(corps: unknown) {
  return request(app).post(ROUTE).set("Content-Type", "application/csp-report").send(JSON.stringify(corps));
}

describe("POST /api/csp-report", () => {
  let journal: string[] = [];

  beforeEach(async () => {
    await cspLimiterStore.resetAll();
    journal = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      journal.push(String(args[0]));
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const lignes = () => journal.filter((l) => l.startsWith("[csp]"));

  it("accepte un rapport au format historique (report-uri) : 204 et une ligne de journal", async () => {
    const res = await envoyerHistorique(rapportHistorique());

    expect(res.status).toBe(204);
    expect(lignes()).toHaveLength(1);
    expect(lignes()[0]).toContain("script-src-elem");
    expect(lignes()[0]).toContain("https://exemple-tiers.test/script.js");
    expect(lignes()[0]).toContain("https://www.immoplatformpro.com/login");
  });

  it("refuse un JSON mal formé (400 d'Express), jamais d'erreur serveur", async () => {
    const res = await request(app).post(ROUTE).set("Content-Type", "application/csp-report").send("{pas du json");

    expect(res.status).toBe(400);
  });

  it("accepte aussi le format de l'API de rapports (report-to) : un tableau de rapports", async () => {
    const res = await request(app)
      .post(ROUTE)
      .set("Content-Type", "application/reports+json")
      .send(
        JSON.stringify([
          { type: "csp-violation", url: "https://www.immoplatformpro.com/", body: { documentURL: "https://www.immoplatformpro.com/", effectiveDirective: "img-src", blockedURL: "https://pixel.test/p.gif" } },
          { type: "deprecation", body: { id: "x" } },
        ])
      );

    expect(res.status).toBe(204);
    expect(lignes()).toHaveLength(1); // le rapport qui n'est pas une violation CSP est ignoré
    expect(lignes()[0]).toContain("img-src");
    expect(lignes()[0]).toContain("https://pixel.test/p.gif");
  });

  it("retire la requête et le fragment des adresses : un jeton de réinitialisation n'arrive jamais dans les journaux", async () => {
    await envoyerHistorique(
      rapportHistorique({
        "document-uri": "https://www.immoplatformpro.com/reinitialiser-mot-de-passe?token=SECRET123#frag",
        "blocked-uri": "https://tiers.test/x.js?cle=SECRET456",
      })
    );

    expect(lignes()).toHaveLength(1);
    expect(lignes()[0]).not.toContain("SECRET123");
    expect(lignes()[0]).not.toContain("SECRET456");
    expect(lignes()[0]).toContain("/reinitialiser-mot-de-passe");
  });

  it("neutralise les retours à la ligne et les caractères de contrôle : une seule ligne, jamais de fausse entrée de journal", async () => {
    // (Le caractère nul est déjà refusé en amont par sansCaractereNul, sur toute l'API : il n'arrive jamais ici.)
    await envoyerHistorique(rapportHistorique({ "effective-directive": "script-src\n[cron] Résumé du jour — OK\u0007\r\n[csp] faux\u2028fin" }));

    expect(lignes()).toHaveLength(1);
    expect(lignes()[0]).not.toMatch(/[\r\n\u0000]/);
  });

  it("tronque les valeurs démesurées", async () => {
    await envoyerHistorique(rapportHistorique({ "blocked-uri": "https://tiers.test/" + "a".repeat(5000) }));

    expect(lignes()).toHaveLength(1);
    expect(lignes()[0].length).toBeLessThan(900);
  });

  it("ignore le bruit des extensions du navigateur (ce ne sont pas nos pages)", async () => {
    const res = await envoyerHistorique(rapportHistorique({ "blocked-uri": "chrome-extension://abcdef/content.js" }));
    await envoyerHistorique(rapportHistorique({ "blocked-uri": "moz-extension://abcdef/content.js" }));
    await envoyerHistorique(rapportHistorique({ "blocked-uri": "safari-web-extension://abcdef/content.js" }));

    expect(res.status).toBe(204);
    expect(lignes()).toEqual([]);
  });

  it.each([
    ["un corps vide", ""],
    ["du JSON qui n'est pas un objet", "42"],
    ["un objet sans rapport", '{"a":1}'],
    ["un tableau de n'importe quoi", '[1,"x",null,{"type":"csp-violation"}]'],
    ["un rapport dont les champs ne sont pas du texte", '{"csp-report":{"violated-directive":{"x":1},"blocked-uri":[1]}}'],
  ])("répond 204 sans erreur pour %s", async (_nom, corps) => {
    const res = await request(app).post(ROUTE).set("Content-Type", "application/csp-report").send(corps);

    expect(res.status).toBe(204);
  });

  it("ne journalise que quelques rapports par envoi", async () => {
    const rapports = Array.from({ length: 50 }, (_, i) => ({ type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: `https://t.test/${i}.gif`, documentURL: "https://www.immoplatformpro.com/" } }));

    await request(app).post(ROUTE).set("Content-Type", "application/reports+json").send(JSON.stringify(rapports));

    expect(lignes().length).toBeLessThanOrEqual(5);
  });

  it("n'exige aucune authentification et ne pose aucun cookie", async () => {
    const res = await envoyerHistorique(rapportHistorique());

    expect(res.status).toBe(204);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("autorise le navigateur à lire la réponse depuis le site : Cross-Origin-Resource-Policy cross-origin", async () => {
    // helmet pose « same-origin » partout. Le site (immoplatformpro.com) et l'API sont deux origines : sans cette
    // exception, le rapport ARRIVE (204, ligne de journal) mais Chrome affiche « ERR_BLOCKED_BY_RESPONSE.NotSameOrigin »
    // dans la console de chaque visiteur qui l'ouvre.
    const res = await envoyerHistorique(rapportHistorique());

    expect(res.status).toBe(204);
    expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
  });

  it("garde « same-origin » sur le reste de l'API (l'exception ne vaut que pour le collecteur)", async () => {
    const res = await request(app).get("/api/health");

    expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
  });

  it("refuse un corps trop volumineux (413), sans erreur serveur", async () => {
    const res = await request(app).post(ROUTE).set("Content-Type", "application/csp-report").send(JSON.stringify(rapportHistorique({ "blocked-uri": "x".repeat(20_000) })));

    expect(res.status).toBe(413);
  });

  it("limite le nombre d'envois par adresse IP (429 au-delà)", async () => {
    let dernier = 204;
    for (let i = 0; i < 60; i++) dernier = (await envoyerHistorique(rapportHistorique())).status;
    expect(dernier).toBe(204);

    const bloque = await envoyerHistorique(rapportHistorique());

    expect(bloque.status).toBe(429);
  });
});
