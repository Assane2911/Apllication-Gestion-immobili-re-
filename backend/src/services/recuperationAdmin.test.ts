import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { adminAuditLogs, users } from "../db/schema";
import { authHeader, createAdmin, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { reinitialiserDeuxFacteursAdmin } from "./recuperationAdmin.service";

/**
 * Un administrateur qui a perdu son téléphone ET ses codes de secours ne peut pas désactiver la 2FA depuis le site (elle exige un
 * code). La récupération passe par la ligne de commande, avec l'accès à la base : aucune route web n'existe pour cela.
 */
describe("récupération d'un administrateur sans téléphone ni codes de secours", () => {
  it("efface le secret et les codes de secours, révoque les sessions et garde le mot de passe", async () => {
    const admin = await createAdmin({ totpSecret: "SECRET", totpBackupCodesHash: "[\"h1\",\"h2\"]", totpLastUsedStep: 42, tokenVersion: 3 });
    const avant = admin.passwordHash;

    const res = await reinitialiserDeuxFacteursAdmin(` ${admin.email.toUpperCase()} `);

    expect(res).toMatchObject({ id: admin.id, avaitDeuxFacteurs: true });
    const [apres] = await testDb.select().from(users).where(eq(users.id, admin.id));
    expect(apres).toMatchObject({ totpSecret: null, totpEnabledAt: null, totpBackupCodesHash: null, totpLastUsedStep: null, tokenVersion: 4, passwordHash: avant, role: "ADMIN" });
  });

  it("révoque l'ancien jeton, puis l'administration exige la réactivation tout en laissant l'enrôlement ouvert", async () => {
    const admin = await createAdmin({ tokenVersion: 0 });
    const ancien = tokenFor(admin); // porte la version 0 (jeton émis avant la réinitialisation)
    expect((await request(app).get("/api/admin/dashboard/stats").set(authHeader(ancien))).status).toBe(200);

    await reinitialiserDeuxFacteursAdmin(admin.email);

    expect((await request(app).get("/api/admin/dashboard/stats").set(authHeader(ancien))).status).toBe(401);

    // Nouvelle session (version à jour) : l'administration est refusée tant que la 2FA manque, l'enrôlement reste ouvert.
    const frais = (await request(app).post("/api/auth/login").send({ email: admin.email, password: "Password123!" })).body.token as string;
    expect(frais).toBeTruthy();
    const refus = await request(app).get("/api/admin/dashboard/stats").set(authHeader(frais));
    expect(refus.status).toBe(403);
    expect(refus.body.code).toBe("TWO_FACTOR_SETUP_REQUIRED");
    expect((await request(app).post("/api/auth/2fa/setup").set(authHeader(frais))).status).toBe(200);
  });

  it("inscrit l'action au journal d'audit de l'administration", async () => {
    const admin = await createAdmin();
    await reinitialiserDeuxFacteursAdmin(admin.email);

    const [ligne] = await testDb.select().from(adminAuditLogs).where(eq(adminAuditLogs.action, "admin.two_factor_reset"));
    expect(ligne).toMatchObject({ adminId: admin.id, adminEmail: admin.email, targetUserId: admin.id, targetLabel: admin.email });
    expect(ligne.details).toContain("ligne de commande");
  });

  it("refuse un compte inconnu, et un compte qui n'est pas administrateur, sans rien modifier", async () => {
    await expect(reinitialiserDeuxFacteursAdmin("personne@test.local")).rejects.toThrow(/Aucun compte/);

    const gestionnaire = await createManager({ totpSecret: "SECRET", totpEnabledAt: new Date() });
    await expect(reinitialiserDeuxFacteursAdmin(gestionnaire.email)).rejects.toThrow(/n'est pas un compte administrateur/);
    const [intact] = await testDb.select().from(users).where(eq(users.id, gestionnaire.id));
    expect(intact.totpSecret).toBe("SECRET");
    expect(intact.totpEnabledAt).not.toBeNull();
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });

  it("n'existe sous aucune route web", async () => {
    const admin = await createAdmin();
    for (const route of ["/api/admin/reset-2fa", "/api/admin/two-factor/reset", "/api/auth/2fa/reset"]) {
      const res = await request(app).post(route).set(authHeader(tokenFor(admin))).send({ email: admin.email });
      expect([404, 403]).toContain(res.status);
    }
    const [intact] = await testDb.select().from(users).where(eq(users.id, admin.id));
    expect(intact.totpEnabledAt).not.toBeNull();
  });
});
