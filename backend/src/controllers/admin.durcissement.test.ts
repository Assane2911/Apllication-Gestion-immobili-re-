import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { adminAuditLogs, platformSubscriptions, users } from "../db/schema";
import { genererCodeTotp } from "../services/totp.service";
import { authHeader, createAdmin, createManager, createPortalUser, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Régression : les routes de double authentification étaient réservées au rôle
 * MANAGER (`requireRole("MANAGER")`), alors que la connexion, elle, l'exige de
 * tout compte qui l'a activée. Le compte ADMINISTRATEUR — celui qui confirme les virements,
 * suspend et supprime des agences — était donc le seul à ne pas pouvoir être protégé
 * par un second facteur : toute l'application reposait sur un mot de passe.
 */
describe("double authentification du compte administrateur", () => {
  it("permet à l'administrateur de l'activer, puis lui impose le code à la connexion", async () => {
    const admin = await createAdmin();
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

  it("permet à l'administrateur de la désactiver avec son mot de passe", async () => {
    const admin = await createAdmin();
    const token = tokenFor(admin);
    const setup = await request(app).post("/api/auth/2fa/setup").set(authHeader(token));
    await request(app)
      .post("/api/auth/2fa/confirm")
      .set(authHeader(token))
      .send({ code: await genererCodeTotp(setup.body.secret) })
      .expect(200);

    const res = await request(app).post("/api/auth/2fa/disable").set(authHeader(token)).send({ password: "Password123!" });

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

async function virementEnAttente(managerId: string) {
  const [record] = await testDb
    .insert(platformSubscriptions)
    .values({
      userId: managerId,
      plan: "PRO",
      amount: 29,
      status: "PENDING",
      paymentMethod: "BANK_TRANSFER",
      paymentRef: "VIR-DOUBLE-CLIC",
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })
    .returning();
  return record;
}

describe("confirmation d'un virement — double clic", () => {
  /**
   * Régression : activateSubscriptionRecord est idempotent (un virement déjà
   * confirmé ne rouvre rien), mais le contrôleur écrivait quand même une nouvelle
   * entrée « Virement confirmé » à chaque appel. Un double clic faisait croire à
   * deux encaissements dans le journal d'audit.
   */
  it("n'écrit qu'une seule entrée d'audit, et répond sans erreur la seconde fois", async () => {
    const admin = await createAdmin();
    const manager = await createManager();
    const record = await virementEnAttente(manager.id);
    const confirmer = () => request(app).post(`/api/admin/subscriptions/${record.id}/confirm-bank-transfer`).set(authHeader(tokenFor(admin)));

    expect((await confirmer()).status).toBe(200);
    expect((await confirmer()).status).toBe(200);

    const traces = (await testDb.select().from(adminAuditLogs)).filter((l: { action: string }) => l.action === "subscription.bank_transfer.confirm");
    expect(traces).toHaveLength(1);
  });
});

describe("coordonnées bancaires de la plateforme — journal d'audit", () => {
  const IBAN = "FR7630006000011234567890189";
  const traces = async () =>
    (await testDb.select().from(adminAuditLogs)).filter((l: { action: string }) => l.action === "platform.bank_details.update");

  /**
   * Régression : l'entrée disait seulement « coordonnées modifiées », même quand
   * rien n'avait changé, sans dire QUEL champ. C'est le compte sur lequel toutes
   * les agences virent leur abonnement : un IBAN remplacé doit se voir au premier
   * coup d'œil dans le journal — sans que l'IBAN complet n'y figure.
   */
  it("nomme le champ modifié (IBAN reconnaissable à ses 4 derniers caractères), jamais la valeur complète", async () => {
    const admin = await createAdmin();
    const put = (corps: Record<string, unknown>) => request(app).put("/api/admin/settings").set(authHeader(tokenFor(admin))).send(corps);

    await put({ iban: IBAN, bic: "BNPAFRPPXXX" }).expect(200);

    const [entree] = await traces();
    expect(entree.details).toContain("IBAN");
    expect(entree.details).toContain("…0189");
    expect(entree.details).toContain("BIC");
    expect(entree.details).not.toContain(IBAN);
    expect(entree.details).not.toContain("BNPAFRPPXXX");
  });

  it("ne trace rien quand l'enregistrement ne change rien", async () => {
    const admin = await createAdmin();
    const put = (corps: Record<string, unknown>) => request(app).put("/api/admin/settings").set(authHeader(tokenFor(admin))).send(corps);
    await put({ iban: IBAN, bic: "BNPAFRPPXXX" }).expect(200);
    const avant = (await traces()).length;

    await put({ iban: IBAN, bic: "BNPAFRPPXXX" }).expect(200);

    expect((await traces()).length).toBe(avant);
  });

  it("ne nomme que le champ réellement modifié", async () => {
    const admin = await createAdmin();
    const put = (corps: Record<string, unknown>) => request(app).put("/api/admin/settings").set(authHeader(tokenFor(admin))).send(corps);
    await put({ iban: IBAN, bic: "BNPAFRPPXXX" }).expect(200);

    await put({ iban: IBAN, bic: "AGRIFRPPXXX" }).expect(200);

    const toutes = await traces();
    const derniere = toutes[toutes.length - 1];
    expect(derniere.details).toContain("BIC");
    expect(derniere.details).not.toContain("IBAN");
  });
});
