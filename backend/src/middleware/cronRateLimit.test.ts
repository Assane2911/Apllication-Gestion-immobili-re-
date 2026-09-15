import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../app";
import { cronLimiterStore } from "./rateLimit";

const CRON_SECRET = process.env.CRON_SECRET!;
const ROUTE = "/api/cron/rent-due-reminders";

/**
 * Vérifie cronLimiter (rateLimit.ts) : la seule protection des routes
 * /api/cron/* était jusqu'ici la comparaison en temps constant du secret
 * (cron.controller.ts::secretValide), qui empêche une attaque par mesure de
 * TIMING mais pas un nombre illimité de TENTATIVES réseau pour deviner
 * CRON_SECRET par force brute. Ce fichier n'avait aucun test avant l'ajout
 * du rate-limiter : une régression de configuration (limite augmentée par
 * erreur, middleware retiré de la route) serait passée inaperçue.
 */
describe("cronLimiter (limite par IP sur les routes /api/cron/*)", () => {
  // Chaque test part d'un compteur vierge. Sans cela, le test précédent qui
  // épuise volontairement le quota (pour vérifier le blocage au 21e essai)
  // laisserait le compteur au-dessus de la limite : `skipSuccessfulRequests`
  // ne fait que STOPPER l'incrémentation lors d'une requête réussie, il ne
  // réinitialise pas rétroactivement un compteur déjà au-delà de la limite —
  // la requête suivante serait donc bloquée par le 429 dès la vérification du
  // quota, avant même d'atteindre la route et de pouvoir réussir.
  beforeEach(async () => {
    await cronLimiterStore.resetAll();
  });

  it("autorise 20 échecs d'authentification puis bloque le 21e avec 429", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await request(app).get(ROUTE).set({ Authorization: "Bearer mauvais-secret" });
      expect(res.status).toBe(401);
    }

    const blocked = await request(app).get(ROUTE).set({ Authorization: "Bearer mauvais-secret" });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("Trop de tentatives. Réessayez plus tard.");
  });

  // Régression : un déploiement réel appelle ces routes avec le BON secret à
  // chaque exécution planifiée (Vercel Cron Jobs, un script ops qui relance
  // la tâche plusieurs fois dans la journée) — ces appels légitimes ne
  // doivent jamais épuiser le même quota que celui qui vise les tentatives
  // de deviner le secret.
  it("n'entame pas le quota lors d'appels répétés avec le bon secret", async () => {
    for (let i = 0; i < 25; i++) {
      const res = await request(app).get(ROUTE).set({ Authorization: `Bearer ${CRON_SECRET}` });
      expect(res.status).toBe(200);
    }
  });
});
