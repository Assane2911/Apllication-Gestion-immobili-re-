import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { adminAuditLogs, platformSubscriptions, users } from "../db/schema";
import { authHeader, createAdmin, createManager, createTeamMember, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

const JOUR = 86_400_000;
const dans = (jours: number) => new Date(Date.now() + jours * JOUR);
const PROCHE_MS = 5_000;

async function adminToken() {
  return tokenFor(await createAdmin());
}

function offrir(managerId: string, token: string, body: Record<string, unknown> = { days: 10, reason: "Geste commercial" }) {
  return request(app).post(`/api/admin/managers/${managerId}/subscription/grant-days`).set(authHeader(token)).send(body);
}

function changerPlan(managerId: string, token: string, body: Record<string, unknown> = { plan: "PRO", reason: "Erreur de souscription" }) {
  return request(app).post(`/api/admin/managers/${managerId}/subscription/change-plan`).set(authHeader(token)).send(body);
}

async function relire(id: string) {
  const [u] = await testDb.select().from(users).where(eq(users.id, id));
  return u;
}

describe("POST /api/admin/managers/:id/subscription/grant-days", () => {
  it("exige l'authentification et refuse un gestionnaire", async () => {
    const manager = await createManager();
    expect((await request(app).post(`/api/admin/managers/${manager.id}/subscription/grant-days`).send({ days: 5, reason: "xxx" })).status).toBe(401);
    expect((await offrir(manager.id, tokenFor(manager))).status).toBe(403);
  });

  it("prolonge l'essai en cours (jamais subscriptionEndsAt) et trace avant → après", async () => {
    const admin = await createAdmin();
    const fin = dans(5);
    const manager = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: fin });

    const res = await offrir(manager.id, tokenFor(admin), { days: 10, reason: "Geste commercial" });

    expect(res.status).toBe(200);
    const apres = await relire(manager.id);
    expect(apres.trialEndsAt!.getTime()).toBe(fin.getTime() + 10 * JOUR);
    expect(apres.subscriptionEndsAt).toBeNull();
    expect(apres.subscriptionStatus).toBe("TRIAL");

    const lignes = await testDb.select().from(adminAuditLogs);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ action: "subscription.grant_days", adminId: admin.id, targetUserId: manager.id });
    expect(lignes[0].details).toContain("10 jour(s) offert(s) sur l'essai");
    expect(lignes[0].details).toContain("Geste commercial");
  });

  it("rend de l'accès à un essai expiré : N jours à partir de MAINTENANT, pas de l'ancienne date", async () => {
    const token = await adminToken();
    const manager = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: dans(-90) });

    await offrir(manager.id, token, { days: 7, reason: "Incident" });

    const apres = await relire(manager.id);
    expect(Math.abs(apres.trialEndsAt!.getTime() - (Date.now() + 7 * JOUR))).toBeLessThan(PROCHE_MS);
    const detail = await request(app).get(`/api/admin/managers/${manager.id}`).set(authHeader(token));
    expect(detail.body.subscription.status).toBe("TRIAL");
    expect(detail.body.subscription.trialDaysRemaining).toBe(7);
  });

  it("prolonge un abonnement payant sans toucher à l'essai", async () => {
    const token = await adminToken();
    const essai = dans(-40);
    const fin = dans(20);
    const manager = await createManager({ subscriptionStatus: "ACTIVE", trialEndsAt: essai, subscriptionEndsAt: fin });

    await offrir(manager.id, token, { days: 15, reason: "Compensation" });

    const apres = await relire(manager.id);
    expect(apres.subscriptionEndsAt!.getTime()).toBe(fin.getTime() + 15 * JOUR);
    expect(apres.trialEndsAt!.getTime()).toBe(essai.getTime());
    expect(apres.subscriptionStatus).toBe("ACTIVE");
  });

  it("un abonnement payant expiré repart de MAINTENANT", async () => {
    const token = await adminToken();
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: dans(-30) });

    await offrir(manager.id, token, { days: 5, reason: "Retard de virement" });

    const apres = await relire(manager.id);
    expect(Math.abs(apres.subscriptionEndsAt!.getTime() - (Date.now() + 5 * JOUR))).toBeLessThan(PROCHE_MS);
  });

  it("rouvre l'accès d'un abonnement résilié et expiré", async () => {
    const token = await adminToken();
    const manager = await createManager({ subscriptionStatus: "CANCELLED", subscriptionEndsAt: dans(-3) });

    await offrir(manager.id, token, { days: 10, reason: "Résiliation par erreur" });

    const detail = await request(app).get(`/api/admin/managers/${manager.id}`).set(authHeader(token));
    expect(detail.body.subscription.status).toBe("CANCELLED"); // actif jusqu'au terme, pas EXPIRED
    expect((await relire(manager.id)).subscriptionStatus).toBe("CANCELLED");
  });

  it("un statut stocké EXPIRED redevient un essai", async () => {
    const token = await adminToken();
    const manager = await createManager({ subscriptionStatus: "EXPIRED", trialEndsAt: dans(-10) });

    await offrir(manager.id, token, { days: 4, reason: "Réouverture" });

    const apres = await relire(manager.id);
    expect(apres.subscriptionStatus).toBe("TRIAL");
    expect(apres.trialEndsAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("refuse un abonnement ACTIVE sans échéance (illimité : on le raccourcirait)", async () => {
    const token = await adminToken();
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: null });

    const res = await offrir(manager.id, token);

    expect(res.status).toBe(409);
    expect((await relire(manager.id)).subscriptionEndsAt).toBeNull();
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });

  it("refuse un abonnement Stripe à renouvellement automatique, sans rien modifier ni tracer", async () => {
    const token = await adminToken();
    const fin = dans(20);
    const manager = await createManager({
      subscriptionStatus: "ACTIVE",
      subscriptionEndsAt: fin,
      stripeSubscriptionId: "sub_test_123",
    });

    const res = await offrir(manager.id, token);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("Stripe");
    expect((await relire(manager.id)).subscriptionEndsAt!.getTime()).toBe(fin.getTime());
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });

  it("valide les paramètres : jours entiers entre 1 et 365, motif obligatoire", async () => {
    const token = await adminToken();
    const manager = await createManager();
    for (const body of [
      { days: 0, reason: "motif ok" },
      { days: 366, reason: "motif ok" },
      { days: 1.5, reason: "motif ok" },
      { days: "abc", reason: "motif ok" },
      { days: 5, reason: "  " },
      { days: 5 },
    ]) {
      expect((await offrir(manager.id, token, body)).status).toBe(400);
    }
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });

  it("renvoie 404 pour un id inconnu, un collaborateur ou un administrateur", async () => {
    const admin = await createAdmin();
    const token = tokenFor(admin);
    const manager = await createManager();
    const collaborateur = await createTeamMember(manager.id);
    for (const id of ["inconnu", collaborateur.id, admin.id]) {
      expect((await offrir(id, token)).status).toBe(404);
    }
  });

  it("deux ajustements simultanés s'additionnent au lieu de s'écraser", async () => {
    const token = await adminToken();
    const fin = dans(10);
    const manager = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: fin });

    const [a, b] = await Promise.all([
      offrir(manager.id, token, { days: 10, reason: "Premier admin" }),
      offrir(manager.id, token, { days: 10, reason: "Second admin" }),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await relire(manager.id)).trialEndsAt!.getTime()).toBe(fin.getTime() + 20 * JOUR);
  });
});

describe("POST /api/admin/managers/:id/subscription/change-plan", () => {
  it("exige l'authentification et refuse un gestionnaire", async () => {
    const manager = await createManager();
    expect((await request(app).post(`/api/admin/managers/${manager.id}/subscription/change-plan`).send({ plan: "PRO", reason: "xxx" })).status).toBe(401);
    expect((await changerPlan(manager.id, tokenFor(manager))).status).toBe(403);
  });

  it("change la formule, laisse les dates et la facturation intactes, et trace", async () => {
    const admin = await createAdmin();
    const fin = dans(20);
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "STARTER", subscriptionEndsAt: fin });

    const res = await changerPlan(manager.id, tokenFor(admin), { plan: "ENTERPRISE", reason: "Geste commercial" });

    expect(res.status).toBe(200);
    const apres = await relire(manager.id);
    expect(apres.subscriptionPlan).toBe("ENTERPRISE");
    expect(apres.subscriptionEndsAt!.getTime()).toBe(fin.getTime());
    // Aucun revenu fabriqué : pas de paiement créé.
    expect(await testDb.select().from(platformSubscriptions)).toHaveLength(0);

    const lignes = await testDb.select().from(adminAuditLogs);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ action: "subscription.change_plan", targetUserId: manager.id });
    expect(lignes[0].details).toContain("Starter → Entreprise");
    expect(lignes[0].details).toContain("Geste commercial");
  });

  it("refuse la formule déjà en place (409), sans trace", async () => {
    const token = await adminToken();
    const manager = await createManager({ subscriptionPlan: "PRO" });
    expect((await changerPlan(manager.id, token, { plan: "PRO", reason: "Doublon" })).status).toBe(409);
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });

  it("refuse un abonnement Stripe (409)", async () => {
    const token = await adminToken();
    const manager = await createManager({ subscriptionPlan: "STARTER", stripeSubscriptionId: "sub_test_456" });
    expect((await changerPlan(manager.id, token)).status).toBe(409);
    expect((await relire(manager.id)).subscriptionPlan).toBe("STARTER");
  });

  it("valide la formule et le motif", async () => {
    const token = await adminToken();
    const manager = await createManager();
    expect((await changerPlan(manager.id, token, { plan: "GOLD", reason: "motif ok" })).status).toBe(400);
    expect((await changerPlan(manager.id, token, { plan: "PRO", reason: "" })).status).toBe(400);
    expect((await changerPlan(manager.id, token, { plan: "PRO" })).status).toBe(400);
  });

  it("renvoie 404 pour un collaborateur ou un administrateur", async () => {
    const admin = await createAdmin();
    const token = tokenFor(admin);
    const manager = await createManager();
    const collaborateur = await createTeamMember(manager.id);
    expect((await changerPlan(collaborateur.id, token)).status).toBe(404);
    expect((await changerPlan(admin.id, token)).status).toBe(404);
  });
});
