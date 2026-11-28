import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { activityLogs, adminAuditLogs, agencySettings, users } from "../db/schema";
import { authHeader, createAdmin, createContract, createManager, createOwner, createPlatformSubscription, createProperty, createTeamMember, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Audit par sabotage de admin.controller.ts : ce que les tests du pilotage de la plateforme ne vérifiaient pas.
 * Tableau de bord (bornes des essais, revenu par formule), liste des gestionnaires (ordre, pages, recherche, statut, volumétrie),
 * fiche d'un gestionnaire (chaque décompte et chaque champ rendu), journal d'audit (filtres, ordre, champs),
 * suspension et réactivation (motif, courses, trace, réponse).
 */
const jours = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);
const auth = async () => authHeader(tokenFor(await createAdmin()));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("tableau de bord", () => {
  it("relance les essais à 7 jours restants (inclus) et pas à 8, avec l'adresse et la date de fin de chaque essai", async () => {
    const h = await auth();
    const finSept = new Date(Date.now() + 6.5 * 24 * 60 * 60 * 1000);
    const sept = await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: finSept });
    await createManager({ subscriptionStatus: "TRIAL", trialEndsAt: new Date(Date.now() + 7.5 * 24 * 60 * 60 * 1000) });

    const res = await request(app).get("/api/admin/dashboard/stats").set(h);

    expect(res.body.trialsEndingSoon).toHaveLength(1);
    expect(res.body.trialsEndingSoon[0]).toMatchObject({ userId: sept.id, email: sept.email, daysRemaining: 7, trialEndsAt: finSept.toISOString() });
  });

  it("le revenu par formule additionne les gestionnaires de la même formule et de la même devise", async () => {
    const h = await auth();
    for (const montant of [29, 31]) {
      const m = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", subscriptionEndsAt: jours(20) });
      await createPlatformSubscription(m.id, { plan: "PRO", amount: montant, currency: "EUR" });
    }

    const res = await request(app).get("/api/admin/dashboard/stats").set(h);

    expect(res.body.mrr.byCurrency).toEqual([{ currency: "EUR", total: 60, byPlan: { STARTER: 0, PRO: 60, ENTERPRISE: 0 }, contributors: 2 }]);
  });
});

describe("liste des gestionnaires", () => {
  it("du plus récent au plus ancien, page par page, avec le statut calculé, la création et des volumes à zéro pour une agence vide", async () => {
    const h = await auth();
    const ancien = await createManager({ createdAt: new Date(2026, 0, 1), subscriptionStatus: "TRIAL", trialEndsAt: jours(-3) });
    const milieu = await createManager({ createdAt: new Date(2026, 3, 1) });
    const recent = await createManager({ createdAt: new Date(2026, 6, 1) });

    const p1 = await request(app).get("/api/admin/managers?pageSize=2&page=1").set(h);
    const p2 = await request(app).get("/api/admin/managers?pageSize=2&page=2").set(h);

    expect(p1.body.items.map((i: { id: string }) => i.id)).toEqual([recent.id, milieu.id]);
    expect(p2.body.items.map((i: { id: string }) => i.id)).toEqual([ancien.id]);
    expect(p1.body).toMatchObject({ total: 3, totalPages: 2, pageSize: 2 });
    expect(p1.body.items[0]).toMatchObject({ propertiesCount: 0, tenantsCount: 0, createdAt: recent.createdAt.toISOString() });
    // Essai expiré en base (« TRIAL ») : le statut rendu est le statut calculé.
    expect(p2.body.items[0].status).toBe("EXPIRED");
  });

  it("un paramètre mal formé est refusé (400, code et message), même une formule inconnue", async () => {
    const h = await auth();

    const res = await request(app).get("/api/admin/managers?plan=GOLD").set(h);

    expect([res.status, res.body.code, res.body.error]).toEqual([400, "SEARCH_PARAMS_INVALID", "Paramètres de recherche invalides"]);
  });

  it("la recherche ignore les espaces autour, accepte 100 caractères, lit une barre oblique littéralement ; le statut « annulé » se filtre", async () => {
    const h = await auth();
    const avecBarre = await createManager();
    await testDb.insert(agencySettings).values({ userId: avecBarre.id, agencyName: "Agence A\\B" });
    const autre = await createManager();
    await testDb.insert(agencySettings).values({ userId: autre.id, agencyName: "Agence AB" });
    const annule = await createManager({ subscriptionStatus: "CANCELLED", subscriptionEndsAt: jours(10) });
    const ids = (r: request.Response) => (r.body.items as Array<{ id: string }>).map((i) => i.id);

    const barre = await request(app).get("/api/admin/managers").query({ search: "A\\B" }).set(h);
    const espaces = await request(app).get("/api/admin/managers").query({ search: `  ${autre.email}  ` }).set(h);
    const cent = await request(app).get("/api/admin/managers").query({ search: "x".repeat(100) }).set(h);
    const centUn = await request(app).get("/api/admin/managers").query({ search: "x".repeat(101) }).set(h);
    const statut = await request(app).get("/api/admin/managers").query({ status: "CANCELLED" }).set(h);

    expect(ids(barre)).toEqual([avecBarre.id]);
    expect(ids(espaces)).toEqual([autre.id]);
    expect(cent.status).toBe(200);
    expect(centUn.status).toBe(400);
    expect(ids(statut)).toEqual([annule.id]);
  });
});

describe("fiche d'un gestionnaire", () => {
  it("chaque décompte est celui de CE gestionnaire et de sa propre catégorie (biens, locataires, propriétaires, contrats actifs, collaborateurs)", async () => {
    const h = await auth();
    const manager = await createManager();
    const autre = await createManager();
    const b1 = await createProperty(manager.id);
    const b2 = await createProperty(manager.id);
    const bAutre = await createProperty(autre.id);
    const t1 = await createTenant(manager.id);
    await createTenant(manager.id);
    await createTenant(manager.id);
    const tAutre = await createTenant(autre.id);
    await createOwner(manager.id);
    await createOwner(autre.id);
    await createOwner(autre.id);
    await createContract(b1.id, t1.id, { status: "ACTIVE" });
    await createContract(b2.id, t1.id, { status: "TERMINATED" });
    await createContract(bAutre.id, tAutre.id, { status: "ACTIVE" });
    await createContract(bAutre.id, tAutre.id, { status: "ACTIVE" });
    await createTeamMember(manager.id);
    await createTeamMember(autre.id);
    await createTeamMember(autre.id);

    const res = await request(app).get(`/api/admin/managers/${manager.id}`).set(h);

    expect(res.body.usage).toEqual({ properties: 2, tenants: 3, owners: 1, activeContracts: 1, collaborators: 1 });
  });

  it("rend la dernière activité de CE gestionnaire, et ses dix derniers paiements, du plus récent au plus ancien, avec chaque champ", async () => {
    const h = await auth();
    const manager = await createManager({ currency: "XOF", subscriptionPaymentMethod: "PAYDUNYA", stripeSubscriptionId: "sub_fiche_1", emailVerifiedAt: new Date(2026, 1, 2) });
    const autre = await createManager();
    const ligne = (managerId: string, date: Date) => ({ managerId, actorLabel: "x", action: "property.create", entityType: "property", entityLabel: "Bien", createdAt: date });
    await testDb.insert(activityLogs).values([ligne(manager.id, new Date(2026, 2, 1)), ligne(manager.id, new Date(2026, 4, 1)), ligne(autre.id, new Date(2026, 8, 1))]);
    let dernier = { id: "" };
    for (let i = 1; i <= 11; i += 1) {
      dernier = await createPlatformSubscription(manager.id, { plan: "PRO", amount: i, currency: "XOF", billingCycle: "ANNUAL", status: "PAID", paymentMethod: "PAYDUNYA", paymentRef: `ref-${i}`, startDate: new Date(2026, 0, i), endDate: new Date(2026, 11, i), createdAt: new Date(2026, 0, i) });
    }
    await createPlatformSubscription(autre.id, { amount: 999, createdAt: new Date(2026, 6, 1) });

    const res = await request(app).get(`/api/admin/managers/${manager.id}`).set(h);

    expect(res.body.lastActivityAt).toBe(new Date(2026, 4, 1).toISOString());
    expect(res.body).toMatchObject({ currency: "XOF", createdAt: manager.createdAt.toISOString(), emailVerifiedAt: new Date(2026, 1, 2).toISOString() });
    expect(res.body.subscription).toMatchObject({ paymentMethod: "PAYDUNYA", autoRenew: true });
    expect(res.body.billingHistory).toHaveLength(10);
    expect(res.body.billingHistory.map((b: { amount: number }) => b.amount)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    expect(res.body.billingHistory[0]).toEqual({
      id: dernier.id,
      plan: "PRO",
      amount: 11,
      currency: "XOF",
      billingCycle: "ANNUAL",
      status: "PAID",
      paymentMethod: "PAYDUNYA",
      paymentRef: "ref-11",
      startDate: new Date(2026, 0, 11).toISOString(),
      endDate: new Date(2026, 11, 11).toISOString(),
      createdAt: new Date(2026, 0, 11).toISOString(),
    });
  });

  it("rend l'identité publique de l'agence, le nombre de jours d'essai restants, et refuse un inconnu avec son code et son message", async () => {
    const h = await auth();
    const manager = await createManager({ trialEndsAt: jours(4.5) });
    await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "Agence du Port", phone: "+221 77 000 00 00", email: "contact@port.test", address: "1 quai du Port", siretOrId: "SN-123" });

    const res = await request(app).get(`/api/admin/managers/${manager.id}`).set(h);
    const inconnu = await request(app).get("/api/admin/managers/inconnu").set(h);

    expect(res.body.agency).toEqual({ agencyName: "Agence du Port", phone: "+221 77 000 00 00", email: "contact@port.test", address: "1 quai du Port", siretOrId: "SN-123" });
    expect(res.body.subscription.trialDaysRemaining).toBe(5);
    expect([inconnu.status, inconnu.body.code, inconnu.body.error]).toEqual([404, "MANAGER_NOT_FOUND", "Gestionnaire introuvable"]);
  });
});

describe("journal d'audit", () => {
  it("rend chaque champ, du plus récent au plus ancien, départagé par l'identifiant à date égale ; le filtre de gestionnaire a des bornes (1 à 100 caractères)", async () => {
    const h = await auth();
    const meme = new Date(2026, 5, 1);
    const ligne = (id: string, valeurs: Partial<typeof adminAuditLogs.$inferInsert> = {}) => ({ id, adminEmail: "admin@test.local", action: "manager.suspend", targetUserId: "cible-1", targetLabel: "cible@test.local", details: "Détail", createdAt: meme, ...valeurs });
    await testDb.insert(adminAuditLogs).values([ligne("a1"), ligne("b2"), ligne("c3", { createdAt: new Date(2026, 4, 1), targetUserId: "x".repeat(100) })]);

    const tout = await request(app).get("/api/admin/audit-logs").set(h);
    const vide = await request(app).get("/api/admin/audit-logs?targetUserId=").set(h);
    const cent = await request(app).get("/api/admin/audit-logs").query({ targetUserId: "x".repeat(100) }).set(h);
    const centUn = await request(app).get("/api/admin/audit-logs").query({ targetUserId: "x".repeat(101) }).set(h);
    const filtre = await request(app).get("/api/admin/audit-logs?action=manager.suspend&targetUserId=cible-1").set(h);

    expect(tout.body.items.map((i: { id: string }) => i.id)).toEqual(["b2", "a1", "c3"]);
    expect(tout.body.items[0]).toEqual({ id: "b2", adminEmail: "admin@test.local", action: "manager.suspend", targetUserId: "cible-1", targetLabel: "cible@test.local", details: "Détail", createdAt: meme.toISOString() });
    expect(vide.status).toBe(400);
    expect([cent.status, cent.body.total]).toEqual([200, 1]);
    expect(centUn.status).toBe(400);
    expect(filtre.body.items.map((i: { id: string }) => i.id)).toEqual(["b2", "a1"]);
  });

  it("un filtre mal formé est refusé avec son code et son message", async () => {
    const h = await auth();

    const res = await request(app).get("/api/admin/audit-logs?action=inconnue").set(h);

    expect([res.status, res.body.code, res.body.error]).toEqual([400, "SEARCH_PARAMS_INVALID", "Paramètres de recherche invalides"]);
  });
});

describe("suspension", () => {
  const MOTIF = "Facture impayée";
  const suspendre = (id: string, h: Record<string, string>, reason: string = MOTIF) => request(app).post(`/api/admin/managers/${id}/suspend`).set(h).send({ reason });

  it("le motif est rogné puis compté : 3 lettres au moins, 500 au plus", async () => {
    const h = await auth();
    const m = await createManager();

    const court = await suspendre(m.id, h, "ab ");
    const trois = await suspendre(m.id, h, "abc");
    const m2 = await createManager();
    const long = await suspendre(m2.id, h, "x".repeat(501));
    const m3 = await createManager();
    const limite = await suspendre(m3.id, h, "x".repeat(500));

    expect(court.status).toBe(400);
    expect(trois.status).toBe(200);
    expect(long.status).toBe(400);
    expect(limite.status).toBe(200);
  });

  it("la réponse et la trace d'un compte sans facturation Stripe : succès, date, pas de mention de pause", async () => {
    const h = await auth();
    const m = await createManager();

    const res = await suspendre(m.id, h);

    expect(res.body).toEqual({ success: true, suspendedAt: expect.any(String), billingPaused: false });
    const [trace] = await testDb.select().from(adminAuditLogs);
    expect(trace.details).toBe(`Compte suspendu. Motif : ${MOTIF}`);
    const deja = await suspendre(m.id, h);
    expect([deja.status, deja.body.code, deja.body.error]).toEqual([409, "ACCOUNT_ALREADY_SUSPENDED", "Ce compte est déjà suspendu"]);
  });

  it("un compte suspendu pendant l'appel à Stripe n'est pas écrasé : 409, motif d'origine conservé, une seule trace", async () => {
    const h = await auth();
    const m = await createManager({ stripeSubscriptionId: "sub_course_1" });
    const cle = env.payments.stripeSecretKey;
    env.payments.stripeSecretKey = "sk_test_fake_key";
    vi.stubGlobal("fetch", async () => {
      await testDb.update(users).set({ suspendedAt: new Date(), suspensionReason: "Autre administrateur" }).where(eq(users.id, m.id));
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const res = await suspendre(m.id, h);
    env.payments.stripeSecretKey = cle;

    expect([res.status, res.body.code, res.body.error]).toEqual([409, "ACCOUNT_ALREADY_SUSPENDED", "Ce compte est déjà suspendu"]);
    const [u] = await testDb.select().from(users).where(eq(users.id, m.id));
    expect(u.suspensionReason).toBe("Autre administrateur");
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });
});

describe("réactivation", () => {
  const reactiver = (id: string, h: Record<string, string>) => request(app).post(`/api/admin/managers/${id}/reactivate`).set(h);

  it("réponse et trace d'un compte sans facturation Stripe ; un compte non suspendu est refusé avec son message", async () => {
    const h = await auth();
    const m = await createManager({ suspendedAt: new Date(), suspensionReason: "Impayé" });
    const actif = await createManager();

    const res = await reactiver(m.id, h);
    const non = await reactiver(actif.id, h);

    expect(res.body).toEqual({ success: true, billingResumed: false });
    const [trace] = await testDb.select().from(adminAuditLogs);
    expect(trace).toMatchObject({ action: "manager.reactivate", targetUserId: m.id, targetLabel: m.email, details: "Suspension levée" });
    expect([non.status, non.body.code, non.body.error]).toEqual([409, "ACCOUNT_NOT_SUSPENDED", "Ce compte n'est pas suspendu"]);
  });

  it("un compte réactivé pendant l'appel à Stripe n'est pas réécrit : 409 et une seule trace", async () => {
    const h = await auth();
    const m = await createManager({ stripeSubscriptionId: "sub_course_2", suspendedAt: new Date(), suspensionReason: "Impayé" });
    const cle = env.payments.stripeSecretKey;
    env.payments.stripeSecretKey = "sk_test_fake_key";
    vi.stubGlobal("fetch", async () => {
      await testDb.update(users).set({ suspendedAt: null, suspensionReason: null }).where(eq(users.id, m.id));
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const res = await reactiver(m.id, h);
    env.payments.stripeSecretKey = cle;

    expect([res.status, res.body.code, res.body.error]).toEqual([409, "ACCOUNT_NOT_SUSPENDED", "Ce compte n'est pas suspendu"]);
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });

  it("suspendre ou réactiver un identifiant inconnu : 404 avec son code et son message", async () => {
    const h = await auth();

    const res = await request(app).post("/api/admin/managers/inconnu/reactivate").set(h);

    expect([res.status, res.body.code, res.body.error]).toEqual([404, "MANAGER_NOT_FOUND", "Gestionnaire introuvable"]);
  });
});

