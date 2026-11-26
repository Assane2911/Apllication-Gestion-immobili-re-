import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { adminAuditLogs, agencySettings, platformSubscriptions } from "../db/schema";
import { authHeader, createAdmin, createManager, createPlatformSubscription, createTeamMember, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Administration de la plateforme : revenu récurrent par devise, recherche des gestionnaires, virements bancaires et
 * suspension. Ce sont les chiffres sur lesquels l'exploitant décide (MRR) et les gestes qui coupent ou ouvrent un accès.
 */

const JOUR = 24 * 3600 * 1000;
const dans = (ms: number) => new Date(Date.now() + ms);
const admin = async () => authHeader(tokenFor(await createAdmin()));
const abonne = (o: Parameters<typeof createManager>[0] = {}) => createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "STARTER", subscriptionEndsAt: dans(30 * JOUR), ...o });
const stats = async (h: Record<string, string>) => (await request(app).get("/api/admin/dashboard/stats").set(h)).body;

describe("tableau de bord : revenu récurrent (MRR)", () => {
  it("un abonnement annuel est ramené au mois, chaque devise a son total et sa répartition par formule, la plus forte en tête", async () => {
    const h = await admin();
    const a = await abonne();
    const b = await abonne({ subscriptionPlan: "PRO" });
    const c = await abonne({ subscriptionPlan: "ENTERPRISE" });
    await createPlatformSubscription(a.id, { plan: "STARTER", amount: 9, currency: "EUR" });
    await createPlatformSubscription(b.id, { plan: "PRO", amount: 120, currency: "EUR", billingCycle: "ANNUAL" });
    await createPlatformSubscription(c.id, { plan: "ENTERPRISE", amount: 25000, currency: "XOF" });

    const { mrr } = await stats(h);

    expect(mrr.contributors).toBe(3);
    expect(mrr.byCurrency.map((d: { currency: string }) => d.currency)).toEqual(["XOF", "EUR"]);
    expect(mrr.byCurrency[0]).toEqual({ currency: "XOF", total: 25000, byPlan: { STARTER: 0, PRO: 0, ENTERPRISE: 25000 }, contributors: 1 });
    expect(mrr.byCurrency[1]).toEqual({ currency: "EUR", total: 19, byPlan: { STARTER: 9, PRO: 10, ENTERPRISE: 0 }, contributors: 2 });
  });

  it("seul le DERNIER paiement confirmé de chaque gestionnaire compte, et un paiement en attente ou rejeté ne compte pas", async () => {
    const h = await admin();
    const m = await abonne();
    await createPlatformSubscription(m.id, { amount: 9, currency: "EUR", createdAt: dans(-60 * JOUR) });
    await createPlatformSubscription(m.id, { amount: 29, plan: "PRO", currency: "EUR", createdAt: dans(-30 * JOUR) });
    await createPlatformSubscription(m.id, { amount: 99, plan: "ENTERPRISE", currency: "EUR", status: "PENDING", createdAt: dans(-1 * JOUR) });
    await createPlatformSubscription(m.id, { amount: 77, currency: "EUR", status: "REJECTED", createdAt: dans(-2 * JOUR) });

    const { mrr } = await stats(h);

    expect(mrr.contributors).toBe(1);
    expect(mrr.byCurrency).toHaveLength(1);
    expect(mrr.byCurrency[0].total).toBe(29);
    expect(mrr.byCurrency[0].byPlan.PRO).toBe(29);
  });

  it("une devise vide est comptée en euros", async () => {
    const h = await admin();
    const m = await abonne();
    await createPlatformSubscription(m.id, { amount: 15, currency: "" });

    const { mrr } = await stats(h);

    expect(mrr.byCurrency).toEqual([{ currency: "EUR", total: 15, byPlan: { STARTER: 15, PRO: 0, ENTERPRISE: 0 }, contributors: 1 }]);
  });

  it("un abonnement dont le gestionnaire a été supprimé (paiement anonymisé) ne compte pas, ni un compte suspendu, ni un essai", async () => {
    const h = await admin();
    const suspendu = await abonne({ suspendedAt: new Date() });
    const essai = await createManager();
    await createPlatformSubscription(suspendu.id, { amount: 50, currency: "EUR" });
    await createPlatformSubscription(essai.id, { amount: 40, currency: "EUR" });
    await testDb.insert(platformSubscriptions).values({ userId: null, plan: "PRO", amount: 60, currency: "EUR", status: "PAID", paymentMethod: "DEMO", startDate: new Date(), endDate: dans(30 * JOUR) });

    const { mrr } = await stats(h);

    expect(mrr.contributors).toBe(0);
    expect(mrr.byCurrency).toEqual([]);
  });

  it("les chiffres de comptes : un collaborateur invité n'est pas un client, un compte suspendu reste compté dans son statut", async () => {
    const h = await admin();
    const proprio = await abonne({ subscriptionPlan: "ENTERPRISE" });
    await createTeamMember(proprio.id);
    await abonne({ suspendedAt: new Date() });
    await createManager(); // essai en cours

    const { managers } = await stats(h);

    expect(managers).toEqual({ total: 3, trialActive: 1, subscriptionActive: 2, expired: 0, suspended: 1 });
  });

  it("essais bientôt terminés : dans la semaine, du plus proche au plus lointain, ni les lointains ni les suspendus, avec le nom d'agence s'il existe", async () => {
    const h = await admin();
    const proche = await createManager({ trialEndsAt: dans(2 * JOUR - 3600_000) });
    const moinsProche = await createManager({ trialEndsAt: dans(6 * JOUR - 3600_000) });
    await createManager({ trialEndsAt: dans(20 * JOUR) });
    await createManager({ trialEndsAt: dans(1 * JOUR), suspendedAt: new Date() });
    await testDb.insert(agencySettings).values({ userId: proche.id, agencyName: "Agence Dakar" });

    const { trialsEndingSoon } = await stats(h);

    expect(trialsEndingSoon.map((t: { userId: string }) => t.userId)).toEqual([proche.id, moinsProche.id]);
    expect(trialsEndingSoon[0].agencyName).toBe("Agence Dakar");
    expect(trialsEndingSoon[1].agencyName).toBeNull();
    expect(trialsEndingSoon[0].daysRemaining).toBeLessThan(trialsEndingSoon[1].daysRemaining);
  });
});

describe("tableau de bord : plafond des essais affichés", () => {
  it("onze essais qui se terminent bientôt : seuls les dix plus proches sont rendus", async () => {
    const h = await admin();
    const crees = [];
    for (let i = 0; i < 11; i++) crees.push(await createManager({ trialEndsAt: dans((i % 6 + 1) * JOUR - 3600_000 + i * 60_000) }));

    const { trialsEndingSoon, managers } = await stats(h);

    expect(managers.trialActive).toBe(11);
    expect(trialsEndingSoon).toHaveLength(10);
    const jours = trialsEndingSoon.map((t: { daysRemaining: number }) => t.daysRemaining);
    expect(jours).toEqual([...jours].sort((x: number, y: number) => x - y));
    const restants = crees.map((m) => m.id).filter((id) => !trialsEndingSoon.some((t: { userId: string }) => t.userId === id));
    expect(restants).toHaveLength(1);
  });
});

describe("GET /api/admin/managers : recherche", () => {
  const trouves = async (h: Record<string, string>, recherche: string) =>
    ((await request(app).get("/api/admin/managers").query({ search: recherche }).set(h)).body.items as Array<{ email: string }>).map((m) => m.email).sort();

  it("la recherche porte sur l'adresse e-mail ou le nom d'agence, sans tenir compte de la casse", async () => {
    const h = await admin();
    const a = await createManager({ email: "contact@ngor-immo.test" });
    const b = await createManager({ email: "autre@exemple.test" });
    await createManager({ email: "personne@exemple.test" });
    await testDb.insert(agencySettings).values({ userId: b.id, agencyName: "Résidences Almadies" });

    expect(await trouves(h, "NGOR")).toEqual([a.email]);
    expect(await trouves(h, "almadies")).toEqual([b.email]);
    expect(await trouves(h, "introuvable")).toEqual([]);
  });

  it("les caractères joker saisis sont lus littéralement (« % » et « _ » n'ouvrent pas toute la liste)", async () => {
    const h = await admin();
    const avecPourcent = await createManager({ email: "promo100%@exemple.test" });
    const avecTiret = await createManager({ email: "jean_paul@exemple.test" });
    await createManager({ email: "jeanXpaul@exemple.test" });
    await createManager({ email: "promo100x@exemple.test" });

    expect(await trouves(h, "100%")).toEqual([avecPourcent.email]);
    expect(await trouves(h, "jean_paul")).toEqual([avecTiret.email]);
    expect((await trouves(h, "%")).length).toBe(1);
  });

  it("une recherche vide ne filtre rien ; un collaborateur invité n'apparaît jamais", async () => {
    const h = await admin();
    const a = await abonne({ subscriptionPlan: "ENTERPRISE" });
    await createTeamMember(a.id, { email: "collab@exemple.test" });

    const tous = await trouves(h, "");

    expect(tous).toEqual([a.email]);
  });

  it("le filtre par formule se combine avec la recherche", async () => {
    const h = await admin();
    await abonne({ email: "pro-1@exemple.test", subscriptionPlan: "PRO" });
    await abonne({ email: "starter-1@exemple.test", subscriptionPlan: "STARTER" });

    const res = await request(app).get("/api/admin/managers").query({ search: "-1@", plan: "PRO" }).set(h);

    expect((res.body.items as Array<{ email: string }>).map((m) => m.email)).toEqual(["pro-1@exemple.test"]);
  });

  it("des paramètres invalides sont refusés (400)", async () => {
    const h = await admin();

    expect((await request(app).get("/api/admin/managers").query({ plan: "GOLD" }).set(h)).status).toBe(400);
    expect((await request(app).get("/api/admin/managers").query({ search: "x".repeat(101) }).set(h)).status).toBe(400);
  });
});

describe("fiche, suspension et réactivation : comptes visés", () => {
  it("la fiche d'un identifiant inconnu, d'un collaborateur invité ou d'un administrateur est introuvable (404)", async () => {
    const h = await admin();
    const proprio = await abonne({ subscriptionPlan: "ENTERPRISE" });
    const collab = await createTeamMember(proprio.id);
    const autreAdmin = await createAdmin();

    for (const id of ["inconnu", collab.id, autreAdmin.id]) {
      const res = await request(app).get(`/api/admin/managers/${id}`).set(h);
      expect(res.status, id).toBe(404);
      expect(res.body.code, id).toBe("MANAGER_NOT_FOUND");
    }
  });

  it("suspendre ou réactiver un compte inconnu ou un collaborateur : 404, aucune trace d'audit", async () => {
    const h = await admin();
    const proprio = await abonne({ subscriptionPlan: "ENTERPRISE" });
    const collab = await createTeamMember(proprio.id);

    for (const id of ["inconnu", collab.id]) {
      expect((await request(app).post(`/api/admin/managers/${id}/suspend`).set(h).send({ reason: "Motif de test" })).status).toBe(404);
      expect((await request(app).post(`/api/admin/managers/${id}/reactivate`).set(h).send({})).status).toBe(404);
    }
    expect(await testDb.select().from(adminAuditLogs)).toEqual([]);
  });

  it("réactiver un compte qui n'est pas suspendu : 409 (ACCOUNT_NOT_SUSPENDED), sans trace d'audit", async () => {
    const h = await admin();
    const m = await abonne();

    const res = await request(app).post(`/api/admin/managers/${m.id}/reactivate`).set(h).send({});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ACCOUNT_NOT_SUSPENDED");
    expect(await testDb.select().from(adminAuditLogs)).toEqual([]);
  });

  it("suspendre deux fois : le second est refusé (409), une seule trace ; réactiver rouvre le compte", async () => {
    const h = await admin();
    const m = await abonne();

    const premier = await request(app).post(`/api/admin/managers/${m.id}/suspend`).set(h).send({ reason: "Impayé répété" });
    const second = await request(app).post(`/api/admin/managers/${m.id}/suspend`).set(h).send({ reason: "Impayé répété" });
    const levee = await request(app).post(`/api/admin/managers/${m.id}/reactivate`).set(h).send({});

    expect(premier.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("ACCOUNT_ALREADY_SUSPENDED");
    expect(levee.status).toBe(200);
    const rouvert = (await request(app).get(`/api/admin/managers/${m.id}`).set(h)).body;
    expect(rouvert.suspendedAt).toBeNull();
    expect(rouvert.suspensionReason).toBeNull();
    expect((await testDb.select().from(adminAuditLogs)).map((l: { action: string }) => l.action).sort()).toEqual(["manager.reactivate", "manager.suspend"]);
  });
});
