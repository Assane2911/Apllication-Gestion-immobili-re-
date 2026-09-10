import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "../app";
import { env } from "../config/env";

/**
 * Vérifie explicitement le repli "fail-closed" de assertCronAuthorized
 * (cron.controller.ts) quand CRON_SECRET n'est PAS configuré — c'est le
 * scénario du bug corrigé précédemment ("Rendre le fail-closed du cron
 * indépendant de NODE_ENV") : env.nodeEnv retombe silencieusement sur
 * "development" si NODE_ENV n'est pas défini, donc un simple `=== "production"`
 * restait vulnérable si cette variable venait à manquer sur un vrai
 * déploiement Vercel. Le code vérifie désormais AUSSI `VERCEL === "1"`
 * (positionné automatiquement par Vercel sur chaque déploiement, quel que
 * soit NODE_ENV) avant d'autoriser le repli développement.
 *
 * Tous les autres fichiers de test tournent avec CRON_SECRET déjà configuré
 * (voir setupTestDb.ts) : ce fichier le désactive volontairement pour ce cas
 * précis, puis restaure l'état d'origine après chaque test (env est un objet
 * mutable partagé par tout le module chargé dans ce fichier de test).
 */
describe("assertCronAuthorized : repli fail-closed quand CRON_SECRET est absent", () => {
  const originalCronSecret = env.cronSecret;
  const originalNodeEnv = env.nodeEnv;
  const originalVercel = process.env.VERCEL;

  afterEach(() => {
    env.cronSecret = originalCronSecret;
    env.nodeEnv = originalNodeEnv;
    if (originalVercel === undefined) {
      delete process.env.VERCEL;
    } else {
      process.env.VERCEL = originalVercel;
    }
  });

  it("bloque (500) en production même sans CRON_SECRET", async () => {
    env.cronSecret = "";
    env.nodeEnv = "production";

    const res = await request(app).get("/api/cron/daily");

    expect(res.status).toBe(500);
  });

  it("bloque (500) même si NODE_ENV retombe sur 'development' tant que VERCEL=1 (déploiement serverless réel)", async () => {
    env.cronSecret = "";
    env.nodeEnv = "development";
    process.env.VERCEL = "1";

    const res = await request(app).get("/api/cron/daily");

    expect(res.status).toBe(500);
  });

  it("autorise (200) en développement local réel, quand VERCEL n'est pas positionné", async () => {
    env.cronSecret = "";
    env.nodeEnv = "development";
    delete process.env.VERCEL;

    const res = await request(app).get("/api/cron/rent-due-soon-reminders");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
