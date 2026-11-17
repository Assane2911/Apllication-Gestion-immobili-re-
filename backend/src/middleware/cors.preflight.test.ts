import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { env } from "../config/env";

/**
 * Le site et l'API sont deux origines : tout appel en JSON avec cookie est précédé d'une requête de vérification (OPTIONS) du
 * navigateur. Sans `Access-Control-Max-Age`, Chrome ne la mémorise que 5 secondes : presque chaque appel de l'API coûtait un
 * aller-retour de plus (de Dakar à Paris, environ 150 ms et une exécution de fonction en plus).
 */
const preflight = (origine: string) =>
  request(app)
    .options("/api/properties")
    .set("Origin", origine)
    .set("Access-Control-Request-Method", "POST")
    .set("Access-Control-Request-Headers", "content-type");

describe("requête de vérification CORS (preflight)", () => {
  it("est mémorisée un jour par le navigateur pour l'origine du site", async () => {
    const res = await preflight(env.frontendUrl);

    expect(res.status).toBe(204);
    expect(res.headers["access-control-max-age"]).toBe("86400");
    expect(res.headers["access-control-allow-origin"]).toBe(env.frontendUrl);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("n'autorise plus les origines des anciennes applications mobiles (Android, iOS)", async () => {
    for (const origine of ["https://localhost", "capacitor://localhost"]) {
      const res = await preflight(origine);
      expect(res.status, origine).toBe(403);
      expect(res.headers["access-control-allow-origin"], origine).toBeUndefined();
    }
  });

  it("une origine non autorisée reste refusée, et rien n'est mémorisé pour elle", async () => {
    const res = await preflight("https://site-malveillant.example");

    expect(res.status).toBe(403);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-max-age"]).toBeUndefined();
  });
});
