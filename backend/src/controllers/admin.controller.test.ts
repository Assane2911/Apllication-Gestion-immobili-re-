import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { agencySettings } from "../db/schema";
import {
  authHeader,
  createAdmin,
  createContract,
  createManager,
  createPlatformSubscription,
  createProperty,
  createTeamMember,
  createTenant,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

afterEach(() => {
  vi.restoreAllMocks();
});

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

describe("validation des virements : les routes n'existent plus", () => {
  it.each([
    ["get", "/api/admin/subscriptions/pending-bank-transfers"],
    ["post", "/api/admin/subscriptions/abc/confirm-bank-transfer"],
    ["post", "/api/admin/subscriptions/abc/reject-bank-transfer"],
    ["get", "/api/admin/settings"],
    ["put", "/api/admin/settings"],
  ] as const)("%s %s : 404, même pour un administrateur", async (methode, url) => {
    const admin = await createAdmin();

    const res = await request(app)[methode](url).set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(404);
  });
});

describe("GET /api/admin/dashboard/stats", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).get("/api/admin/dashboard/stats");
    expect(res.status).toBe(401);
  });

  it("refuse l'accès à un gestionnaire (réservé aux administrateurs)", async () => {
    const manager = await createManager();
    const res = await request(app)
      .get("/api/admin/dashboard/stats")
      .set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(403);
  });

  it("répartit les gestionnaires par statut réel d'abonnement (essai actif / payant actif / sans accès)", async () => {
    const admin = await createAdmin();
    // Essai en cours.
    await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(9) });
    // Abonnement payant en cours de validité.
    await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: daysFromNow(20) });
    // Essai expiré depuis longtemps, jamais passé payant : sans accès malgré
    // la colonne "subscriptionStatus" toujours à TRIAL (jamais réévaluée en
    // base, seulement à la connexion — computeSubscriptionInfo doit la
    // corriger côté lecture).
    await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(-5) });

    const res = await request(app)
      .get("/api/admin/dashboard/stats")
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(200);
    expect(res.body.managers.total).toBe(3);
    expect(res.body.managers.trialActive).toBe(1);
    expect(res.body.managers.subscriptionActive).toBe(1);
    expect(res.body.managers.expired).toBe(1);
  });

  it("liste les essais se terminant dans les 7 jours, triés par urgence, en excluant les essais plus lointains", async () => {
    const admin = await createAdmin();
    const urgent = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(2) });
    const soonish = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(6) });
    await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(25) });
    await testDb.insert(agencySettings).values({ userId: urgent.id, agencyName: "Agence du Port" });

    const res = await request(app)
      .get("/api/admin/dashboard/stats")
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(200);
    expect(res.body.trialsEndingSoon).toHaveLength(2);
    expect(res.body.trialsEndingSoon[0].userId).toBe(urgent.id);
    expect(res.body.trialsEndingSoon[0].agencyName).toBe("Agence du Port");
    expect(res.body.trialsEndingSoon[1].userId).toBe(soonish.id);
    expect(res.body.trialsEndingSoon[1].agencyName).toBeNull();
  });

  it("calcule le MRR à partir du dernier paiement confirmé de chaque abonnement payant actif, en ramenant l'annuel au mensuel", async () => {
    const admin = await createAdmin();

    const proManager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", subscriptionEndsAt: daysFromNow(15) });
    await createPlatformSubscription(proManager.id, { plan: "PRO", amount: 29, billingCycle: "MONTHLY", status: "PAID" });

    const enterpriseManager = await createManager({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "ENTERPRISE",
      subscriptionEndsAt: daysFromNow(200),
    });
    // Un paiement PENDING plus récent ne doit pas être pris en compte (virement
    // bancaire pas encore validé) : seul le dernier paiement PAID compte.
    await createPlatformSubscription(enterpriseManager.id, { plan: "ENTERPRISE", amount: 470, billingCycle: "ANNUAL", status: "PAID" });
    await createPlatformSubscription(enterpriseManager.id, { plan: "ENTERPRISE", amount: 470, billingCycle: "ANNUAL", status: "PENDING" });

    // Essai en cours : ne contribue jamais au MRR.
    await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(5) });

    const res = await request(app)
      .get("/api/admin/dashboard/stats")
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(200);
    expect(res.body.mrr.contributors).toBe(2);
    expect(res.body.mrr.byCurrency).toHaveLength(1);
    const eurMrr = res.body.mrr.byCurrency[0];
    expect(eurMrr.currency).toBe("EUR");
    expect(eurMrr.byPlan.PRO).toBe(29);
    expect(eurMrr.byPlan.ENTERPRISE).toBe(39.17);
    expect(eurMrr.total).toBe(68.17);
  });

  it("compte le volume global d'usage (biens, locataires, contrats actifs) tous gestionnaires confondus", async () => {
    const admin = await createAdmin();

    const managerA = await createManager();
    const propertyA = await createProperty(managerA.id);
    const tenantA = await createTenant(managerA.id);
    await createContract(propertyA.id, tenantA.id, { status: "ACTIVE" });

    const managerB = await createManager();
    const propertyB1 = await createProperty(managerB.id);
    await createProperty(managerB.id);
    const tenantB = await createTenant(managerB.id);
    await createContract(propertyB1.id, tenantB.id, { status: "ENDED" });

    const res = await request(app)
      .get("/api/admin/dashboard/stats")
      .set(authHeader(tokenFor(admin)));

    expect(res.status).toBe(200);
    expect(res.body.usage.totalProperties).toBe(3);
    expect(res.body.usage.totalTenants).toBe(2);
    expect(res.body.usage.activeContracts).toBe(1);
  });
});

describe("GET /api/admin/dashboard/stats — clients réels et comptes suspendus", () => {
  const stats = async (admin: Awaited<ReturnType<typeof createAdmin>>) =>
    (await request(app).get("/api/admin/dashboard/stats").set(authHeader(tokenFor(admin)))).body;

  it("ne compte que les gestionnaires propriétaires : les collaborateurs invités ne sont pas des clients", async () => {
    const admin = await createAdmin();
    const proprietaire = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: daysFromNow(20) });
    await createTeamMember(proprietaire.id);
    await createTeamMember(proprietaire.id, { subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(3) });

    const corps = await stats(admin);

    expect(corps.managers).toMatchObject({ total: 1, subscriptionActive: 1, trialActive: 0, expired: 0 });
    // Un collaborateur en « essai » ne déclenche pas non plus de relance commerciale.
    expect(corps.trialsEndingSoon).toHaveLength(0);
  });

  it("compte les suspendus à part, sans les retirer de leur statut d'abonnement", async () => {
    const admin = await createAdmin();
    await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: daysFromNow(20), suspendedAt: new Date(), suspensionReason: "Impayé" });
    await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(10), suspendedAt: new Date(), suspensionReason: "Abus" });
    await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: daysFromNow(20) });

    const corps = await stats(admin);

    expect(corps.managers).toMatchObject({ total: 3, subscriptionActive: 2, trialActive: 1, suspended: 2 });
  });

  it("exclut un compte suspendu du revenu récurrent attendu et des relances d'essai", async () => {
    const admin = await createAdmin();
    const actif = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", subscriptionEndsAt: daysFromNow(15) });
    await createPlatformSubscription(actif.id, { plan: "PRO", amount: 29, billingCycle: "MONTHLY", status: "PAID" });
    const suspendu = await createManager({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "ENTERPRISE",
      subscriptionEndsAt: daysFromNow(15),
      suspendedAt: new Date(),
      suspensionReason: "Impayé",
    });
    await createPlatformSubscription(suspendu.id, { plan: "ENTERPRISE", amount: 99, billingCycle: "MONTHLY", status: "PAID" });
    await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(2), suspendedAt: new Date(), suspensionReason: "Abus" });

    const corps = await stats(admin);

    expect(corps.mrr.contributors).toBe(1);
    expect(corps.mrr.byCurrency[0].total).toBe(29);
    expect(corps.trialsEndingSoon).toHaveLength(0);
  });
});
