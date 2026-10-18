import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { env } from "../config/env";

/**
 * Régression : une requête que le client a mal formée n'est pas une panne du serveur. errorHandler ne
 * reconnaissait que ZodError, MulterError et ApiError ; tout autre `Error` — dont les erreurs du lecteur de
 * corps de requête (JSON illisible, corps trop gros), d'une URL mal encodée et du contrôle CORS — tombait dans
 * la branche « 500 Erreur interne » : journal d'erreurs bruyant, attente de l'envoi à Sentry, et un message qui
 * accuse le serveur à tort. N'importe qui, sans compte, pouvait ainsi provoquer ces 500 à volonté.
 */
describe("requêtes malformées — erreurs du client, pas du serveur", () => {
  it("répond 400 à un corps JSON illisible", async () => {
    const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send('{"email": "a@b.fr", ');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JSON|illisible|invalide/i);
    expect(res.body.error).not.toMatch(/interne/i);
  });

  it("répond 413 à un corps plus gros que la limite", async () => {
    const enorme = JSON.stringify({ email: "a@b.fr", password: "x".repeat(11 * 1024 * 1024) });

    const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send(enorme);

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/volumineux|trop/i);
  });

  it("répond 400 à une URL mal encodée", async () => {
    const res = await request(app).get("/api/listings/public/%E0%A4%A");

    expect(res.status).toBe(400);
  });

  it("répond 403 à une origine non autorisée, sans la traiter comme une panne", async () => {
    const errreur = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(app).get("/api/health").set("Origin", "https://site-malveillant.example");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/origine/i);
    expect(errreur).not.toHaveBeenCalled();
    errreur.mockRestore();
  });

  it("laisse passer l'origine du frontend, et les appels sans origine", async () => {
    const frontend = await request(app).get("/api/health").set("Origin", env.frontendUrl);
    const sansOrigine = await request(app).get("/api/health");

    expect(frontend.status).toBe(200);
    expect(frontend.headers["access-control-allow-origin"]).toBe(env.frontendUrl);
    expect(sansOrigine.status).toBe(200);
  });
});
