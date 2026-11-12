import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { users } from "../db/schema";
import { authHeader, createAdmin, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * L'espace d'administration exige la double authentification. Un administrateur qui ne l'a pas encore activée n'est pas
 * enfermé dehors : il se connecte, l'administration lui est refusée, et l'activation de la 2FA reste ouverte avec sa session.
 */
const ROUTES_ADMIN = ["/api/admin/dashboard/stats", "/api/admin/managers", "/api/admin/settings", "/api/admin/audit-logs"];

describe("administration — double authentification obligatoire", () => {
  it("refuse (403, code traduisible) toute route d'administration à un administrateur sans 2FA", async () => {
    const admin = await createAdmin({ totpEnabledAt: null });
    for (const route of ROUTES_ADMIN) {
      const res = await request(app).get(route).set(authHeader(tokenFor(admin)));
      expect(res.status, route).toBe(403);
      expect(res.body.code, route).toBe("TWO_FACTOR_SETUP_REQUIRED");
    }
  });

  it("refuse aussi les écritures, sans rien modifier", async () => {
    const admin = await createAdmin({ totpEnabledAt: null });
    const cible = await createManager();
    const res = await request(app).post(`/api/admin/managers/${cible.id}/suspend`).set(authHeader(tokenFor(admin))).send({ reason: "Test" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TWO_FACTOR_SETUP_REQUIRED");
    const [apres] = await testDb.select().from(users).where(eq(users.id, cible.id));
    expect(apres.suspendedAt).toBeNull();
  });

  it("laisse passer un administrateur qui a activé la 2FA", async () => {
    const admin = await createAdmin(); // 2FA activée par défaut dans l'aide de test
    for (const route of ROUTES_ADMIN) {
      const res = await request(app).get(route).set(authHeader(tokenFor(admin)));
      expect(res.status, route).toBe(200);
    }
  });

  it("n'est pas enfermé dehors : l'administrateur sans 2FA peut s'enrôler avec sa session, puis accéder à l'administration", async () => {
    const admin = await createAdmin({ totpEnabledAt: null });
    const token = tokenFor(admin);

    const avant = await request(app).get("/api/admin/dashboard/stats").set(authHeader(token));
    expect(avant.status).toBe(403);

    const setup = await request(app).post("/api/auth/2fa/setup").set(authHeader(token));
    expect(setup.status).toBe(200);
    expect(setup.body.secret).toBeTruthy();

    // Le profil dit que la 2FA manque : c'est ce que l'interface lit pour proposer l'activation.
    const me = await request(app).get("/api/auth/me").set(authHeader(token));
    expect(me.status).toBe(200);
    expect(me.body.twoFactorEnabled).toBe(false);

    // Une fois la 2FA activée (confirmation faite, représentée ici par la date), l'administration s'ouvre sans nouvelle connexion.
    await testDb.update(users).set({ totpEnabledAt: new Date() }).where(eq(users.id, admin.id));
    const apres = await request(app).get("/api/admin/dashboard/stats").set(authHeader(token));
    expect(apres.status).toBe(200);
  });

  it("ne touche ni les gestionnaires ni leurs routes", async () => {
    const manager = await createManager();
    const res = await request(app).get("/api/dashboard/stats").set(authHeader(tokenFor(manager)));
    expect(res.status).not.toBe(403);
  });
});
