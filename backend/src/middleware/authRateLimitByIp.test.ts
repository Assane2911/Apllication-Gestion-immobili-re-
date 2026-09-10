import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";

/**
 * Vérifie authIpLimiter (rateLimit.ts) : 20 requêtes autorisées par fenêtre
 * de 15 minutes depuis une même adresse IP sur les routes d'authentification,
 * la 21e doit être bloquée avec un 429. Un email différent est utilisé à
 * chaque appel pour ne jamais déclencher authEmailLimiter (limite de 8 par
 * email) et isoler le comportement testé à la seule limite par IP.
 *
 * Ce contrôle protège /login, /register, /forgot-password et consorts contre
 * un brute-force depuis une seule adresse (ajouté après un audit sécurité) et
 * n'avait jusqu'ici aucun test : une régression de configuration (limite
 * augmentée par erreur, middleware retiré d'une route) serait passée
 * inaperçue.
 */
describe("authIpLimiter (limite globale par IP sur les routes d'authentification)", () => {
  it("autorise 20 tentatives puis bloque la 21e avec 429", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await request(app)
        .post("/api/auth/forgot-password")
        .send({ email: `ip-limit-${i}@test.local` });
      expect(res.status).toBe(200);
    }

    const blocked = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "ip-limit-21@test.local" });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("Trop de tentatives depuis cette adresse. Réessayez dans quelques minutes.");
  });
});
