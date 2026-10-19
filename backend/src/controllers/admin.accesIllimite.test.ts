import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { adminAuditLogs, users } from "../db/schema";
import { authHeader, createAdmin, createManager, createTeamMember, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

const JOUR = 86_400_000;
const dans = (jours: number) => new Date(Date.now() + jours * JOUR);

function offrir(managerId: string, token: string, body: Record<string, unknown> = { reason: "Compte de la direction" }) {
  return request(app).post(`/api/admin/managers/${managerId}/subscription/grant-unlimited`).set(authHeader(token)).send(body);
}

function retirer(managerId: string, token: string, body: Record<string, unknown> = { reason: "Fin de la convention" }) {
  return request(app).post(`/api/admin/managers/${managerId}/subscription/revoke-unlimited`).set(authHeader(token)).send(body);
}

async function relire(id: string) {
  const [u] = await testDb.select().from(users).where(eq(users.id, id));
  return u;
}

describe("POST /api/admin/managers/:id/subscription/grant-unlimited", () => {
  it("exige l'authentification et refuse un gestionnaire", async () => {
    const manager = await createManager();
    expect((await request(app).post(`/api/admin/managers/${manager.id}/subscription/grant-unlimited`).send({ reason: "xxx" })).status).toBe(401);
    expect((await offrir(manager.id, tokenFor(manager))).status).toBe(403);
  });

  it("donne un accès sans échéance à un compte en essai : il passe les contrôles d'abonnement", async () => {
    const admin = await createAdmin();
    const manager = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: dans(-3) });

    // Essai expiré : l'API métier est fermée.
    expect((await request(app).get("/api/properties").set(authHeader(tokenFor(manager)))).status).toBe(402);

    const res = await offrir(manager.id, tokenFor(admin));
    expect(res.status).toBe(200);

    const apres = await relire(manager.id);
    expect(apres.subscriptionStatus).toBe("ACTIVE");
    expect(apres.subscriptionEndsAt).toBeNull();
    expect(apres.subscriptionPlan).toBe("ENTERPRISE");

    expect((await request(app).get("/api/properties").set(authHeader(tokenFor(manager)))).status).toBe(200);
  });

  it("trace l'octroi dans le journal d'audit avec le motif", async () => {
    const admin = await createAdmin();
    const manager = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: dans(5) });

    await offrir(manager.id, tokenFor(admin), { reason: "Compte de la direction" });

    const lignes = await testDb.select().from(adminAuditLogs);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ action: "subscription.grant_unlimited", adminId: admin.id, targetUserId: manager.id });
    expect(lignes[0].details).toContain("Compte de la direction");
  });

  it("exige un motif d'au moins 3 caractères", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager();

    expect((await offrir(manager.id, token, {})).status).toBe(400);
    expect((await offrir(manager.id, token, { reason: "  a " })).status).toBe(400);
    expect((await offrir(manager.id, token, { reason: "x".repeat(501) })).status).toBe(400);
    expect((await relire(manager.id)).subscriptionStatus).toBe("TRIAL");
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });

  it("refuse un compte déjà illimité (aucune trace en double)", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: null });

    const res = await offrir(manager.id, token);

    expect(res.status).toBe(409);
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });

  it("refuse un abonnement Stripe : le webhook réécrirait la fin de période", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({
      subscriptionStatus: "ACTIVE",
      subscriptionEndsAt: dans(20),
      stripeSubscriptionId: "sub_test_illimite",
    });

    const res = await offrir(manager.id, token);

    expect(res.status).toBe(409);
    expect((await relire(manager.id)).subscriptionEndsAt).not.toBeNull();
  });

  it("remplace un abonnement payant daté par un accès sans échéance", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", subscriptionEndsAt: dans(20) });

    expect((await offrir(manager.id, token)).status).toBe(200);

    const apres = await relire(manager.id);
    expect(apres.subscriptionEndsAt).toBeNull();
    expect(apres.subscriptionStatus).toBe("ACTIVE");
  });

  it("répond 404 pour un compte qui n'est pas un gestionnaire propriétaire", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager();
    const collaborateur = await createTeamMember(manager.id);

    expect((await offrir(collaborateur.id, token)).status).toBe(404);
    expect((await offrir("00000000-0000-0000-0000-000000000000", token)).status).toBe(404);
  });
});

describe("POST /api/admin/managers/:id/subscription/revoke-unlimited", () => {
  it("ferme l'accès d'un compte illimité et trace le retrait", async () => {
    const admin = await createAdmin();
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: null });

    const res = await retirer(manager.id, tokenFor(admin));
    expect(res.status).toBe(200);

    const apres = await relire(manager.id);
    expect(apres.subscriptionStatus).toBe("EXPIRED");
    expect(apres.subscriptionEndsAt).toBeNull();

    expect((await request(app).get("/api/properties").set(authHeader(tokenFor(manager)))).status).toBe(402);

    const lignes = await testDb.select().from(adminAuditLogs);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ action: "subscription.revoke_unlimited", adminId: admin.id, targetUserId: manager.id });
    expect(lignes[0].details).toContain("Fin de la convention");
  });

  it("refuse un compte qui n'a pas d'accès illimité (on ne résilie pas un abonnement payé par ce chemin)", async () => {
    const token = tokenFor(await createAdmin());
    const paye = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: dans(30) });
    const essai = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: dans(5) });

    expect((await retirer(paye.id, token)).status).toBe(409);
    expect((await retirer(essai.id, token)).status).toBe(409);
    expect((await relire(paye.id)).subscriptionEndsAt).not.toBeNull();
    expect((await relire(essai.id)).subscriptionStatus).toBe("TRIAL");
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });

  it("exige un motif", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: null });

    expect((await retirer(manager.id, token, {})).status).toBe(400);
    expect((await relire(manager.id)).subscriptionStatus).toBe("ACTIVE");
  });

  it("un compte redevenu EXPIRED peut de nouveau se voir offrir des jours", async () => {
    const token = tokenFor(await createAdmin());
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: null });
    await retirer(manager.id, token);

    const res = await request(app)
      .post(`/api/admin/managers/${manager.id}/subscription/grant-days`)
      .set(authHeader(token))
      .send({ days: 7, reason: "Reprise" });

    expect(res.status).toBe(200);
    expect((await relire(manager.id)).subscriptionStatus).toBe("TRIAL");
  });
});
