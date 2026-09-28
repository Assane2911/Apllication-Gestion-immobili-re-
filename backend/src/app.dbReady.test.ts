import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
});
