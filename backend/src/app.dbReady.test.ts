import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Régression : sur Vercel, src/app.ts est directement le point d'entrée
 * serverless (voir le commentaire à ce sujet dans app.ts) — src/index.ts, qui
 * appelait initDb() avant app.listen(), n'y est jamais exécuté. initDb()
 * était donc mort en production : toute colonne ajoutée à schema.ts après le
 * premier déploiement restait absente de la vraie base, et chaque requête qui
 * la nommait échouait avec "column ... does not exist" (masqué en 500
 * générique). Ces tests vérifient que app.ts déclenche bien initDb() lui-même
 * avant de traiter une requête, sans dépendre de src/index.ts.
 */
describe("initialisation du schéma avant la première requête (app.ts)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("appelle initDb() avant de traiter la toute première requête, sans le refaire pour les suivantes", async () => {
    const initDbMock = vi.fn().mockResolvedValue(undefined);
    vi.doMock("./db/init", () => ({ initDb: initDbMock }));

    const { app } = await import("./app");
    expect(initDbMock).not.toHaveBeenCalled();

    const first = await request(app).get("/api/health");
    expect(first.status).toBe(200);
    expect(initDbMock).toHaveBeenCalledTimes(1);

    const second = await request(app).get("/api/health");
    expect(second.status).toBe(200);
    // Mémorisée : pas de second appel pour la requête suivante sur la même instance.
    expect(initDbMock).toHaveBeenCalledTimes(1);
  });

  it("réessaie initDb() sur la requête suivante après un échec, plutôt que de rester bloqué dessus indéfiniment", async () => {
    const initDbMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("Base de données indisponible"))
      .mockResolvedValueOnce(undefined);
    vi.doMock("./db/init", () => ({ initDb: initDbMock }));

    const { app } = await import("./app");

    const first = await request(app).get("/api/health");
    expect(first.status).toBe(500);
    expect(initDbMock).toHaveBeenCalledTimes(1);

    const second = await request(app).get("/api/health");
    expect(second.status).toBe(200);
    expect(initDbMock).toHaveBeenCalledTimes(2);
  });

  /**
   * Un aperçu Vercel (branche ou commit non fusionné) partage la base de production : mêmes DATABASE_URL, clés Supabase et JWT_SECRET
   * (constat du 18/11/2026 : une seule base Supabase, aucune branche, variables attribuées à « production » ET « aperçu »). Or initDb()
   * ne fait pas que créer : il supprime des contraintes, change le type de colonnes et met des lignes à jour. Une branche non relue qui
   * modifie ce fichier l'exécutait donc sur la vraie base dès la première requête de son aperçu.
   */
  it("un aperçu Vercel n'exécute PAS initDb() : il partage la base de production", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const initDbMock = vi.fn().mockResolvedValue(undefined);
    vi.doMock("./db/init", () => ({ initDb: initDbMock }));

    const { app } = await import("./app");
    const reponse = await request(app).get("/api/health");

    expect(reponse.status).toBe(200);
    expect(initDbMock).not.toHaveBeenCalled();
  });

  it("un aperçu qui a sa propre base peut demander la mise à jour du schéma (PREVIEW_DB_MIGRATIONS=true)", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("PREVIEW_DB_MIGRATIONS", "true");
    const initDbMock = vi.fn().mockResolvedValue(undefined);
    vi.doMock("./db/init", () => ({ initDb: initDbMock }));

    const { app } = await import("./app");
    await request(app).get("/api/health");

    expect(initDbMock).toHaveBeenCalledTimes(1);
  });

  it("la production, elle, met toujours le schéma à jour", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const initDbMock = vi.fn().mockResolvedValue(undefined);
    vi.doMock("./db/init", () => ({ initDb: initDbMock }));

    const { app } = await import("./app");
    await request(app).get("/api/health");

    expect(initDbMock).toHaveBeenCalledTimes(1);
  });
});
