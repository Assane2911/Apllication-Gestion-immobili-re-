import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { activityLogs, agencySettings } from "../db/schema";
import {
  authHeader,
  createAdmin,
  createContract,
  createManager,
  createOwner,
  createPlatformSubscription,
  createProperty,
  createTeamMember,
  createTenant,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

const daysFromNow = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

async function adminToken() {
  const admin = await createAdmin();
  return tokenFor(admin);
}

describe("GET /api/admin/managers", () => {
  it("exige une authentification", async () => {
    const res = await request(app).get("/api/admin/managers");
    expect(res.status).toBe(401);
  });

  it("refuse un gestionnaire (réservé à l'administrateur)", async () => {
    const manager = await createManager();
    const res = await request(app).get("/api/admin/managers").set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(403);
  });

  it("liste les gestionnaires avec formule, statut et volumétrie, sans collaborateurs ni administrateurs", async () => {
    const token = await adminToken();
    const manager = await createManager({ email: "agence-a@test.local", subscriptionPlan: "PRO" });
    await createTeamMember(manager.id);
    await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "Agence Alpha" });
    await createProperty(manager.id);
    await createProperty(manager.id);
    await createTenant(manager.id);

    const res = await request(app).get("/api/admin/managers").set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      id: manager.id,
      email: "agence-a@test.local",
      agencyName: "Agence Alpha",
      plan: "PRO",
      status: "TRIAL",
      propertiesCount: 2,
      tenantsCount: 1,
    });
  });

  it("ne renvoie aucun champ sensible", async () => {
    const token = await adminToken();
    await createManager({ totpSecret: "SECRET-TOTP", resetPasswordTokenHash: "hash-reset", stripeCustomerId: "cus_123" });

    const res = await request(app).get("/api/admin/managers").set(authHeader(token));

    const brut = JSON.stringify(res.body);
    expect(brut).not.toContain("passwordHash");
    expect(brut).not.toContain("SECRET-TOTP");
    expect(brut).not.toContain("hash-reset");
    expect(brut).not.toContain("cus_123");
    expect(brut).not.toContain("$2"); // préfixe d'un hash bcrypt
  });

  it("recherche par email ou nom d'agence (insensible à la casse)", async () => {
    const token = await adminToken();
    const a = await createManager({ email: "dupont@test.local" });
    const b = await createManager({ email: "autre@test.local" });
    await testDb.insert(agencySettings).values({ userId: b.id, agencyName: "Immo Soleil" });

    const parEmail = await request(app).get("/api/admin/managers").query({ search: "DUPONT" }).set(authHeader(token));
    expect(parEmail.body.items.map((i: { id: string }) => i.id)).toEqual([a.id]);

    const parAgence = await request(app).get("/api/admin/managers").query({ search: "soleil" }).set(authHeader(token));
    expect(parAgence.body.items.map((i: { id: string }) => i.id)).toEqual([b.id]);
  });

  it("lit littéralement les jokers LIKE saisis dans la recherche", async () => {
    const token = await adminToken();
    await createManager({ email: "un@test.local" });
    await createManager({ email: "deux@test.local" });

    const res = await request(app).get("/api/admin/managers").query({ search: "%" }).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);

    const underscore = await request(app).get("/api/admin/managers").query({ search: "u_" }).set(authHeader(token));
    expect(underscore.body.total).toBe(0);
  });

  it("filtre par formule", async () => {
    const token = await adminToken();
    await createManager({ subscriptionPlan: "STARTER" });
    const pro = await createManager({ subscriptionPlan: "PRO" });

    const res = await request(app).get("/api/admin/managers").query({ plan: "PRO" }).set(authHeader(token));
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([pro.id]);
  });

  it("filtre sur le statut CALCULÉ : un essai échu stocké TRIAL est EXPIRED", async () => {
    const token = await adminToken();
    const essaiEchu = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(-3) });
    const essaiActif = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(5) });
    const actif = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: daysFromNow(20) });
    const actifEchu = await createManager({ subscriptionStatus: "ACTIVE", subscriptionEndsAt: daysFromNow(-1) });

    const ids = async (status: string) => {
      const res = await request(app).get("/api/admin/managers").query({ status }).set(authHeader(token));
      return res.body.items.map((i: { id: string }) => i.id).sort();
    };

    expect(await ids("EXPIRED")).toEqual([essaiEchu.id, actifEchu.id].sort());
    expect(await ids("TRIAL")).toEqual([essaiActif.id]);
    expect(await ids("ACTIVE")).toEqual([actif.id]);
  });

  it("pagine après filtrage et renvoie le total filtré", async () => {
    const token = await adminToken();
    for (let i = 0; i < 5; i++) await createManager({ subscriptionPlan: "PRO" });
    await createManager({ subscriptionPlan: "STARTER" });

    const page2 = await request(app)
      .get("/api/admin/managers")
      .query({ plan: "PRO", page: 2, pageSize: 2 })
      .set(authHeader(token));

    expect(page2.body.total).toBe(5);
    expect(page2.body.totalPages).toBe(3);
    expect(page2.body.page).toBe(2);
    expect(page2.body.items).toHaveLength(2);
  });

  it("rejette un filtre invalide", async () => {
    const token = await adminToken();
    const res = await request(app).get("/api/admin/managers").query({ plan: "GOLD" }).set(authHeader(token));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/admin/managers/:id", () => {
  it("refuse un gestionnaire et exige une authentification", async () => {
    const manager = await createManager();
    expect((await request(app).get(`/api/admin/managers/${manager.id}`)).status).toBe(401);
    const res = await request(app).get(`/api/admin/managers/${manager.id}`).set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(403);
  });

  it("renvoie la fiche complète : abonnement, usage, agence, activité et facturation", async () => {
    const token = await adminToken();
    const manager = await createManager({
      email: "fiche@test.local",
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "PRO",
      subscriptionEndsAt: daysFromNow(20),
      totpEnabledAt: new Date(),
    });
    await testDb.insert(agencySettings).values({
      userId: manager.id,
      agencyName: "Agence Fiche",
      phone: "+221770000000",
      iban: "FR7630006000011234567890189",
      bic: "AGRIFRPP",
    });
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createOwner(manager.id);
    await createContract(property.id, tenant.id, { status: "ACTIVE" });
    await createTeamMember(manager.id);
    await createPlatformSubscription(manager.id, { plan: "PRO", amount: 29, paymentRef: "REF-42" });
    await testDb.insert(activityLogs).values({
      managerId: manager.id,
      actorLabel: manager.email,
      action: "property.create",
      entityType: "property",
      entityLabel: "Bien",
    });

    const res = await request(app).get(`/api/admin/managers/${manager.id}`).set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: manager.id,
      email: "fiche@test.local",
      twoFactorEnabled: true,
      subscription: { status: "ACTIVE", plan: "PRO", autoRenew: false },
      agency: { agencyName: "Agence Fiche", phone: "+221770000000" },
      usage: { properties: 1, tenants: 1, owners: 1, activeContracts: 1, collaborators: 1 },
    });
    expect(res.body.lastActivityAt).not.toBeNull();
    expect(res.body.billingHistory).toHaveLength(1);
    expect(res.body.billingHistory[0]).toMatchObject({ plan: "PRO", amount: 29, paymentRef: "REF-42" });
  });

  it("n'expose ni secret, ni hash, ni IBAN/BIC de l'agence", async () => {
    const token = await adminToken();
    const manager = await createManager({ totpSecret: "SECRET-TOTP", stripeCustomerId: "cus_999" });
    await testDb.insert(agencySettings).values({
      userId: manager.id,
      agencyName: "Agence",
      iban: "FR7630006000011234567890189",
      bic: "AGRIFRPP",
    });

    const res = await request(app).get(`/api/admin/managers/${manager.id}`).set(authHeader(token));

    const brut = JSON.stringify(res.body);
    for (const interdit of ["passwordHash", "SECRET-TOTP", "cus_999", "FR7630006000011234567890189", "AGRIFRPP", "$2"]) {
      expect(brut).not.toContain(interdit);
    }
    expect(res.body.agency).not.toHaveProperty("iban");
    expect(res.body.agency).not.toHaveProperty("bic");
  });

  it("renvoie le statut calculé (EXPIRED) et non la colonne obsolète", async () => {
    const token = await adminToken();
    const manager = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: daysFromNow(-5) });
    const res = await request(app).get(`/api/admin/managers/${manager.id}`).set(authHeader(token));
    expect(res.body.subscription.status).toBe("EXPIRED");
  });

  it("limite l'historique de facturation aux 10 derniers paiements", async () => {
    const token = await adminToken();
    const manager = await createManager();
    for (let i = 0; i < 12; i++) await createPlatformSubscription(manager.id);
    const res = await request(app).get(`/api/admin/managers/${manager.id}`).set(authHeader(token));
    expect(res.body.billingHistory).toHaveLength(10);
  });

  it("renvoie 404 pour un id inconnu, un collaborateur ou un administrateur", async () => {
    const admin = await createAdmin();
    const token = tokenFor(admin);
    const manager = await createManager();
    const collaborateur = await createTeamMember(manager.id);

    for (const id of ["inconnu", collaborateur.id, admin.id]) {
      const res = await request(app).get(`/api/admin/managers/${id}`).set(authHeader(token));
      expect(res.status).toBe(404);
    }
  });
});
