import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";

/**
 * Vérifie authEmailLimiter (rateLimit.ts) : 8 requêtes autorisées par fenêtre
 * de 15 minutes pour un même email ciblé, la 9e doit être bloquée avec un
 * 429 — même si la limite globale par IP (20) n'est pas atteinte. Protège un
 * compte précis contre une attaque distribuée sur plusieurs adresses IP.
 *
 * Fichier séparé de authRateLimitByIp.test.ts pour repartir d'un compteur IP
 * vierge : chaque fichier de test recharge son propre module rateLimit.ts
 * (voir le commentaire sur `isolate` dans src/test/setupTestDb.ts), donc les
 * 8 appels ci-dessous ne risquent pas d'être bloqués par la limite IP (20)
 * déjà épuisée par un autre fichier.
 */
describe("authEmailLimiter (limite par email ciblé sur les routes d'authentification)", () => {
  it("autorise 8 tentatives pour le même email puis bloque la 9e avec 429", async () => {
    const email = "email-limit-target@test.local";
    for (let i = 0; i < 8; i++) {
      const res = await request(app).post("/api/auth/forgot-password").send({ email });
      expect(res.status).toBe(200);
    }

    const blocked = await request(app).post("/api/auth/forgot-password").send({ email });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("Trop de tentatives pour ce compte. Réessayez dans quelques minutes.");
  });
});
