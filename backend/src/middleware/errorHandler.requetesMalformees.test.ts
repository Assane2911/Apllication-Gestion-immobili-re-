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

/**
 * Même principe pour les formulaires de fichiers : le lecteur multipart (busboy, sous multer) lève des `Error`
 * ordinaires — pas des `MulterError` — quand le corps est mal formé (pas de séparateur, en-tête de partie
 * corrompu, corps tronqué ou vide). Elles finissaient en « 500 Erreur interne » sur toutes les routes de
 * téléversement (biens, locataires, logo, tampon, scan de contrat, photos d'incident, annonces).
 */
describe("formulaires de fichiers mal formés — erreurs du client, pas du serveur", () => {
  async function gestionnaire() {
    const { authHeader, createManager, tokenFor } = await import("../test/authHelpers");
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: new Date(Date.now() + 86_400_000 * 30) });
    return authHeader(tokenFor({ id: manager.id, role: "MANAGER" }));
  }

  it.each([
    ["sans séparateur", "multipart/form-data", "x"],
    ["en-tête de partie corrompu", "multipart/form-data; boundary=zz", '--zz\r\nContent-Disp\x00osition: form-data; name="a"\r\n\r\nb\r\n--zz--\r\n'],
    ["corps vide", "multipart/form-data; boundary=zz", ""],
    ["corps tronqué", "multipart/form-data; boundary=zz", '--zz\r\nContent-Disposition: form-data; name="a"\r\n\r\nb'],
  ])("répond 400 (et non 500) à un formulaire %s", async (_nom, contentType, corps) => {
    const h = await gestionnaire();
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(app).post("/api/properties").set(h).set("Content-Type", contentType).send(corps);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FORMULAIRE_ILLISIBLE");
    expect(res.body.error).not.toMatch(/interne/i);
    expect(erreur).not.toHaveBeenCalled();
    erreur.mockRestore();
  });

  it("ne masque pas une vraie panne survenue après la lecture du formulaire", async () => {
    // Une erreur qui n'est pas celle du lecteur multipart reste une erreur serveur : seule la liste fermée des
    // messages du lecteur est traitée en 400.
    const h = await gestionnaire();
    const res = await request(app).post("/api/properties").set(h).field("title", "T").field("address", "A").field("surface", "10").field("rent", "100").field("currency", "EUR");
    expect(res.status).toBeLessThan(500);
  });
});
