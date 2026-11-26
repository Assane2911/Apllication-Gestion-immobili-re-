import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { users } from "../db/schema";
import { genererCodeTotp } from "../services/totp.service";
import { authHeader, createAdmin, createPortalUser, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Régression : les routes de double authentification étaient réservées au rôle
 * MANAGER (`requireRole("MANAGER")`), alors que la connexion, elle, l'exige de
 * tout compte qui l'a activée. Le compte ADMINISTRATEUR — celui qui
 * suspend et supprime des agences — était donc le seul à ne pas pouvoir être protégé
 * par un second facteur : toute l'application reposait sur un mot de passe.
 */
describe("double authentification du compte administrateur", () => {
  it("permet à l'administrateur de l'activer, puis lui impose le code à la connexion", async () => {
    const admin = await createAdmin({ totpEnabledAt: null });
    const token = tokenFor(admin);

    const setup = await request(app).post("/api/auth/2fa/setup").set(authHeader(token));
    expect(setup.status).toBe(200);
    const confirm = await request(app)
      .post("/api/auth/2fa/confirm")
      .set(authHeader(token))
      .send({ code: await genererCodeTotp(setup.body.secret) });
    expect(confirm.status).toBe(200);
    expect(confirm.body.backupCodes).toHaveLength(8);

    const [row] = await testDb.select().from(users).where(eq(users.id, admin.id));
    expect(row.totpEnabledAt).not.toBeNull();

    // La connexion par mot de passe seul ne donne plus de session.
    const login = await request(app).post("/api/auth/login").send({ email: admin.email, password: "Password123!" });
    expect(login.status).toBe(200);
    expect(login.body.twoFactorRequired).toBe(true);
    expect(login.body.token).toBeUndefined();

    // Avec le code, la session ADMIN est émise et ouvre bien le panneau.
    const verifie = await request(app)
      .post("/api/auth/2fa/verify-login")
      .send({ pendingToken: login.body.pendingToken, code: await genererCodeTotp(setup.body.secret) });
    expect(verifie.status).toBe(200);
    expect(verifie.body.user.role).toBe("ADMIN");
    const panneau = await request(app).get("/api/admin/dashboard/stats").set(authHeader(verifie.body.token));
    expect(panneau.status).toBe(200);
  });

  it("permet à l'administrateur de la désactiver avec son mot de passe et un code de secours", async () => {
    const admin = await createAdmin({ totpEnabledAt: null });
    const token = tokenFor(admin);
    const setup = await request(app).post("/api/auth/2fa/setup").set(authHeader(token));
    const confirmation = await request(app)
      .post("/api/auth/2fa/confirm")
      .set(authHeader(token))
      .send({ code: await genererCodeTotp(setup.body.secret) })
      .expect(200);

    const res = await request(app).post("/api/auth/2fa/disable").set(authHeader(token)).send({ password: "Password123!", code: confirmation.body.backupCodes[0] });

    expect(res.status).toBe(200);
    const [row] = await testDb.select().from(users).where(eq(users.id, admin.id));
    expect(row.totpEnabledAt).toBeNull();
  });

  it("reste refusée aux comptes locataire et propriétaire", async () => {
    for (const role of ["TENANT", "OWNER"] as const) {
      const compte = await createPortalUser(role);
      const res = await request(app).post("/api/auth/2fa/setup").set(authHeader(tokenFor(compte, "fiche-1")));
      expect(res.status, role).toBe(403);
    }
  });
});
