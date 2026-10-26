import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { db } from "../db/client";
import { baseRepond, reinitialiserSantePourTests } from "../services/sante.service";

/**
 * `/api/health` répond « ok » dès que la fonction démarre : il ne touche pas la base. Une base injoignable (mot de
 * passe changé, projet Supabase en pause, quota de connexions épuisé) laisse donc le site « en ligne » aux yeux d'une
 * sonde, alors que plus aucune page ne s'affiche. `/api/health/ready` interroge la base (`select 1`) et répond 503 quand
 * elle ne répond pas, pour qu'une sonde externe (UptimeRobot) prévienne.
 *
 * Il est public, sans détail technique, et son résultat est gardé quelques secondes : un visiteur qui l'appelle en boucle
 * ne peut pas mitrailler la base.
 */
describe("GET /api/health/ready", () => {
  beforeEach(() => {
    reinitialiserSantePourTests();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 26, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("répond 200 « ok » quand la base répond", async () => {
    const res = await request(app).get("/api/health/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("répond 503 « degraded » quand la base échoue, sans aucun détail technique ni secret", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "execute").mockRejectedValue(new Error("password authentication failed for user postgres.iljmbgwpcdplfddiiunp"));
    const res = await request(app).get("/api/health/ready");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "degraded" });
    expect(res.text).not.toMatch(/password|postgres|iljmbgwpcdplfddiiunp/i);
  });

  it("n'est jamais conservé par un cache (une sonde doit voir l'état du moment)", async () => {
    const res = await request(app).get("/api/health/ready");
    expect(res.headers["cache-control"]).toMatch(/no-store/);
  });

  it("garde le résultat dix secondes : des appels rapprochés n'interrogent la base qu'une fois", async () => {
    const espion = vi.spyOn(db, "execute");
    await request(app).get("/api/health/ready");
    await request(app).get("/api/health/ready");
    await request(app).get("/api/health/ready");
    expect(espion).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(2026, 9, 26, 12, 0, 11));
    await request(app).get("/api/health/ready");
    expect(espion).toHaveBeenCalledTimes(2);
  });

  it("une panne gardée en mémoire n'empêche pas de constater le rétablissement après dix secondes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const espion = vi.spyOn(db, "execute").mockRejectedValueOnce(new Error("connexion refusée"));
    expect((await request(app).get("/api/health/ready")).status).toBe(503);
    expect((await request(app).get("/api/health/ready")).status).toBe(503); // encore en mémoire
    expect(espion).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(2026, 9, 26, 12, 0, 11));
    expect((await request(app).get("/api/health/ready")).status).toBe(200);
  });

  it("/api/health, lui, ne touche jamais la base", async () => {
    const espion = vi.spyOn(db, "execute");
    const res = await request(app).get("/api/health");
    expect(res.body).toEqual({ status: "ok" });
    expect(espion).not.toHaveBeenCalled();
  });
});

describe("baseRepond", () => {
  beforeEach(() => reinitialiserSantePourTests());
  afterEach(() => vi.restoreAllMocks());

  it("tient une base qui ne répond pas dans le délai pour hors service, sans attendre sa réponse", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "execute").mockImplementation(() => new Promise(() => {}) as never);
    const debut = Date.now();
    await expect(baseRepond({ delaiMs: 60 })).resolves.toBe(false);
    expect(Date.now() - debut).toBeLessThan(1000);
  });

  it("des appels simultanés partagent une seule vérification", async () => {
    const espion = vi.spyOn(db, "execute");
    const resultats = await Promise.all([baseRepond(), baseRepond(), baseRepond()]);
    expect(resultats).toEqual([true, true, true]);
    expect(espion).toHaveBeenCalledTimes(1);
  });
});
