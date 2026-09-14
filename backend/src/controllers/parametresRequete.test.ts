import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { authHeader, createManager, tokenFor } from "../test/authHelpers";

/**
 * Express rend un TABLEAU dès qu'un paramètre de requête est répété
 * (?x=a&x=b), et un objet pour ?x[y]=1. Plusieurs routes l'affirmaient
 * `string` par un simple `as` — une promesse que rien ne tenait — puis
 * passaient la valeur telle quelle à la base.
 */
describe("paramètres de requête mal formés", () => {
  describe("GET /api/activity-log", () => {
    it("refuse un paramètre répété au lieu de partir en erreur serveur", async () => {
      // Régression : le tableau arrivait jusqu'à eq(), Postgres refusait le
      // paramètre, et une URL bricolée se soldait par un 500. Une requête
      // mal formée est la faute de l'appelant : elle mérite un 400.
      const manager = await createManager();

      const res = await request(app)
        .get("/api/activity-log?entityType=property&entityType=tenant")
        .set(authHeader(tokenFor(manager)));

      expect(res.status).toBe(400);
    });

    it("accepte un filtre normal", async () => {
      const manager = await createManager();

      const res = await request(app)
        .get("/api/activity-log?entityType=property")
        .set(authHeader(tokenFor(manager)));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("accepte l'absence de filtre", async () => {
      const manager = await createManager();

      const res = await request(app).get("/api/activity-log").set(authHeader(tokenFor(manager)));

      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/expenses/export", () => {
    const CHEMIN = "/api/expenses/export";

    // Régression, et la plus sournoise du lot. Une date illisible donnait un
    // Invalid Date, et TOUTE comparaison avec un Invalid Date est fausse : le
    // filtre n'échouait pas, il excluait chaque ligne une par une. Une faute
    // de frappe dans l'URL produisait donc un rapport comptable vide,
    // impossible à distinguer d'un trimestre sans activité.
    it.each([
      ["une date illisible", "?from=le-premier-janvier"],
      ["un jour qui n'existe pas", "?from=2026-06-31"],
      ["un 29 février hors année bissextile", "?from=2026-02-29"],
      ["un mois hors bornes", "?from=2026-13-45"],
      ["un format sans zéro initial", "?from=2026-9-1"],
      ["une date de fin illisible", "?to=31/12/2026"],
      ["un paramètre répété", "?from=2026-01-01&from=2026-02-01"],
    ])("refuse %s", async (_cas, requete) => {
      const manager = await createManager();

      const res = await request(app).get(`${CHEMIN}${requete}`).set(authHeader(tokenFor(manager)));

      expect(res.status).toBe(400);
    });

    it.each([
      ["une période complète", "?from=2026-01-01&to=2026-12-31"],
      ["un 29 février d'année bissextile", "?from=2028-02-29"],
      ["aucun filtre", ""],
    ])("accepte %s", async (_cas, requete) => {
      const manager = await createManager();

      const res = await request(app).get(`${CHEMIN}${requete}`).set(authHeader(tokenFor(manager)));

      expect(res.status).toBe(200);
    });
  });
});
