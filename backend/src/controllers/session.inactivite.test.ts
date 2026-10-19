import jwt from "jsonwebtoken";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { createAdmin, createManager, createTenant, createTenantPortalUser, tokenFor } from "../test/authHelpers";
import {
  DUREE_INACTIVITE_ADMIN_MS,
  DUREE_INACTIVITE_MS,
  DUREE_SESSION_MAX_MS,
  dureeInactiviteMs,
  signerJetonWeb,
} from "../utils/session";

/**
 * Déconnexion à l'inactivité. Sur le web, le jeton du cookie est COURT (15 min pour l'administrateur, 30 min
 * pour les autres) et ne se prolonge que sur un geste de l'utilisateur (POST /auth/session/refresh) : les
 * requêtes automatiques de l'interface ne le prolongent pas. Une durée maximale de 12 h court depuis la
 * connexion. L'app mobile (jeton dans l'en-tête Authorization) garde sa session longue.
 */
const MINUTE = 60_000;

function cookieDe(res: request.Response): string {
  const brut = ((res.headers["set-cookie"] ?? []) as unknown as string[]).find((c) => c.startsWith("token="));
  if (!brut) throw new Error("aucun cookie de session");
  return brut.split(";")[0];
}
const jetonDe = (cookie: string) => cookie.slice("token=".length);
const decode = (jeton: string) => jwt.decode(jeton) as { exp: number; iat: number; sst?: number; role: string };
const dureeSec = (jeton: string) => {
  const d = decode(jeton);
  return d.exp - d.iat;
};

afterEach(() => vi.useRealTimers());

describe("durées d'inactivité par rôle", () => {
  it("15 minutes pour l'administrateur, 30 pour tous les autres", () => {
    expect(DUREE_INACTIVITE_ADMIN_MS).toBe(15 * MINUTE);
    expect(DUREE_INACTIVITE_MS).toBe(30 * MINUTE);
    expect(dureeInactiviteMs("ADMIN")).toBe(15 * MINUTE);
    for (const role of ["MANAGER", "TENANT", "OWNER"] as const) expect(dureeInactiviteMs(role)).toBe(30 * MINUTE);
  });
});

describe("signerJetonWeb", () => {
  const claims = { userId: "u1", role: "MANAGER" as const, tokenVersion: 0 };

  it("expire après la durée d'inactivité du rôle", () => {
    const { token } = signerJetonWeb(claims)!;
    expect(dureeSec(token)).toBe(30 * 60);
    expect(dureeSec(signerJetonWeb({ ...claims, role: "ADMIN" })!.token)).toBe(15 * 60);
  });

  it("ne dépasse jamais 12 h depuis le début de la session", () => {
    const maintenant = new Date("2026-10-19T12:00:00Z");
    const debut = new Date(maintenant.getTime() - DUREE_SESSION_MAX_MS + 10 * MINUTE);
    const { token, expireLe } = signerJetonWeb(claims, debut, maintenant)!;
    expect(expireLe.getTime()).toBe(maintenant.getTime() + 10 * MINUTE);
    expect(decode(token).sst).toBe(Math.floor(debut.getTime() / 1000));
  });

  it("refuse de signer une session dont les 12 h sont écoulées", () => {
    const maintenant = new Date("2026-10-19T12:00:00Z");
    expect(signerJetonWeb(claims, new Date(maintenant.getTime() - DUREE_SESSION_MAX_MS - 1000), maintenant)).toBeNull();
  });
});

describe("connexion : cookie court, jeton du corps long", () => {
  it("le cookie d'un gestionnaire expire à 30 min, celui d'un administrateur à 15 min", async () => {
    await createManager({ email: "gest-session@test.local" });
    const gest = await request(app).post("/api/auth/login").send({ email: "gest-session@test.local", password: "Password123!" });
    expect(gest.status).toBe(200);
    expect(dureeSec(jetonDe(cookieDe(gest)))).toBe(30 * 60);

    await createAdmin({ email: "admin-session@test.local" });
    const admin = await request(app).post("/api/auth/login").send({ email: "admin-session@test.local", password: "Password123!" });
    expect(admin.status).toBe(200);
    expect(dureeSec(jetonDe(cookieDe(admin)))).toBe(15 * 60);
  });

  it("le jeton du corps (app mobile) garde la durée longue", async () => {
    await createManager({ email: "mobile-session@test.local" });
    const res = await request(app).post("/api/auth/login").send({ email: "mobile-session@test.local", password: "Password123!" });
    expect(res.body.token).toBeTypeOf("string");
    expect(dureeSec(res.body.token)).toBeGreaterThan(24 * 3600);
  });
});

describe("POST /api/auth/session/refresh", () => {
  async function connecte(email: string) {
    await createManager({ email });
    const res = await request(app).post("/api/auth/login").send({ email, password: "Password123!" });
    return cookieDe(res);
  }
  const rafraichir = (cookie: string) =>
    request(app).post("/api/auth/session/refresh").set("Cookie", cookie).set("X-Requested-With", "XMLHttpRequest");

  it("prolonge la session web : nouveau cookie, début de session conservé", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T08:00:00Z"));
    const cookie = await connecte("prolonge@test.local");
    const avant = decode(jetonDe(cookie));

    vi.setSystemTime(new Date("2026-10-19T08:20:00Z"));
    const res = await rafraichir(cookie);

    expect(res.status).toBe(200);
    expect(res.body.renewed).toBe(true);
    const apres = decode(jetonDe(cookieDe(res)));
    expect(apres.exp).toBe(Math.floor(new Date("2026-10-19T08:50:00Z").getTime() / 1000));
    expect(apres.sst).toBe(avant.sst);
  });

  it("le cookie expiré après l'inactivité est refusé", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T08:00:00Z"));
    const cookie = await connecte("inactif@test.local");

    vi.setSystemTime(new Date("2026-10-19T08:31:00Z"));
    const me = await request(app).get("/api/auth/me").set("Cookie", cookie).set("X-Requested-With", "XMLHttpRequest");

    expect(me.status).toBe(401);
    expect((await rafraichir(cookie)).status).toBe(401);
  });

  it("une requête ordinaire ne prolonge pas la session (seul le geste de l'utilisateur le fait)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T08:00:00Z"));
    const cookie = await connecte("passif@test.local");

    vi.setSystemTime(new Date("2026-10-19T08:20:00Z"));
    const me = await request(app).get("/api/auth/me").set("Cookie", cookie).set("X-Requested-With", "XMLHttpRequest");

    expect(me.status).toBe(200);
    expect(me.headers["set-cookie"]).toBeUndefined();
  });

  it("refuse de prolonger au-delà de 12 h depuis la connexion", async () => {
    const manager = await createManager({ email: "douze-heures@test.local" });
    const ancien = jwt.sign(
      {
        userId: manager.id,
        role: "MANAGER",
        tokenVersion: 0,
        sst: Math.floor((Date.now() - DUREE_SESSION_MAX_MS - MINUTE) / 1000),
        exp: Math.floor((Date.now() + 5 * MINUTE) / 1000),
      },
      env.jwtSecret
    );

    const res = await rafraichir(`token=${ancien}`);

    expect(res.status).toBe(401);
    expect(res.headers["set-cookie"]?.[0] ?? "").not.toMatch(/token=ey/);
  });

  it("ne change rien pour l'app mobile (jeton dans l'en-tête Authorization)", async () => {
    const manager = await createManager();
    const res = await request(app).post("/api/auth/session/refresh").set("Authorization", `Bearer ${tokenFor(manager)}`);

    expect(res.status).toBe(200);
    expect(res.body.renewed).toBe(false);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("exige l'authentification", async () => {
    expect((await request(app).post("/api/auth/session/refresh")).status).toBe(401);
  });

  it("fonctionne pour un locataire", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id);
    const compte = await createTenantPortalUser(tenant);
    const res = await request(app).post("/api/auth/login").send({ email: compte.email, password: "Password123!" });
    expect(res.status).toBe(200);
    expect(dureeSec(jetonDe(cookieDe(res)))).toBe(30 * 60);
  });
});
