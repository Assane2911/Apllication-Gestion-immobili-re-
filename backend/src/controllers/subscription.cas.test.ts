import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { platformSubscriptions, users } from "../db/schema";
import * as paymentService from "../services/payment.service";
import { calculerJoursCredit, calculerPeriode } from "../services/subscriptionPeriod.service";
import { authHeader, createManager, createPlatformSubscription, createProperty, createTeamMember, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Souscription et statut de l'abonnement : ce que les tests existants ne verrouillaient pas. L'historique et le compteur de biens du
 * statut sont ceux du gestionnaire connecté seulement (jamais d'une autre agence), l'historique se lit du plus récent au plus ancien,
 * le plafond n'est « dépassé » qu'au-delà de la limite, le prestataire reçoit l'usage « abonnement » et les bons paramètres, et le crédit
 * de jours d'un changement de formule se calcule sur le DERNIER paiement RÉGLÉ (son montant, son cycle) — jamais sur un paiement en
 * attente ou rejeté, ni sur le plus ancien.
 */
const JOUR = 86_400_000;

afterEach(() => {
  vi.restoreAllMocks();
});

const statut = (m: Parameters<typeof tokenFor>[0]) => request(app).get("/api/subscription/status").set(authHeader(tokenFor(m)));

describe("GET /api/subscription/status — historique et biens du seul gestionnaire connecté", () => {
  it("l'historique ne contient que les paiements du gestionnaire, du plus récent au plus ancien", async () => {
    const moi = await createManager();
    const autre = await createManager();
    const ancien = await createPlatformSubscription(moi.id, { plan: "STARTER", amount: 9, createdAt: new Date(Date.now() - 40 * JOUR) });
    const recent = await createPlatformSubscription(moi.id, { plan: "PRO", amount: 29, createdAt: new Date(Date.now() - 10 * JOUR) });
    const milieu = await createPlatformSubscription(moi.id, { plan: "PRO", amount: 29, createdAt: new Date(Date.now() - 25 * JOUR) });
    await createPlatformSubscription(autre.id, { plan: "ENTERPRISE", amount: 49, createdAt: new Date(Date.now() - 5 * JOUR) });

    const res = await statut(moi);

    expect(res.status).toBe(200);
    expect(res.body.history.map((h: { id: string }) => h.id)).toEqual([recent.id, milieu.id, ancien.id]);
    expect(res.body.history.every((h: { userId: string }) => h.userId === moi.id)).toBe(true);
  });

  it("le compteur de biens ne compte que les biens du gestionnaire, pas ceux des autres agences", async () => {
    const moi = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "STARTER", trialEndsAt: null, subscriptionEndsAt: new Date(Date.now() + 30 * JOUR) });
    const autre = await createManager();
    await createProperty(moi.id, { title: "Mon bien" });
    for (let i = 0; i < 4; i++) await createProperty(autre.id, { title: `Autre ${i}` });

    const res = await statut(moi);

    expect(res.body.propertyUsage).toEqual({ count: 1, max: 5, exceeded: false });
  });

  it("le plafond n'est dépassé qu'au-delà de la limite : exactement 5 biens en formule Démarrage n'est pas un dépassement", async () => {
    const moi = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "STARTER", trialEndsAt: null, subscriptionEndsAt: new Date(Date.now() + 30 * JOUR) });
    for (let i = 0; i < 5; i++) await createProperty(moi.id, { title: `Bien ${i}` });

    expect((await statut(moi)).body.propertyUsage).toEqual({ count: 5, max: 5, exceeded: false });

    await createProperty(moi.id, { title: "Bien 6" });
    expect((await statut(moi)).body.propertyUsage).toEqual({ count: 6, max: 5, exceeded: true });
  });
});

describe("POST /api/subscription/subscribe — ce qui part au prestataire", () => {
  it("transmet l'usage « abonnement », le montant et la devise du plan, le cycle et une référence propre au compte", async () => {
    const manager = await createManager({ currency: "XOF" });
    const espion = vi.spyOn(paymentService, "initiatePayment");

    const res = await request(app)
      .post("/api/subscription/subscribe")
      .set(authHeader(tokenFor(manager)))
      .send({ plan: "PRO", billingCycle: "ANNUAL", paymentMethod: "DEMO" });

    expect(res.status).toBe(200);
    expect(espion).toHaveBeenCalledTimes(1);
    const appel = espion.mock.calls[0][0];
    expect(appel).toMatchObject({
      method: "DEMO",
      amount: 144000,
      currency: "XOF",
      usage: "ABONNEMENT",
      payerEmail: manager.email,
      returnPath: "/subscription",
      autoRenew: false,
      billingCycle: "ANNUAL",
    });
    expect(appel.invoiceId).toMatch(new RegExp(`^sub_${manager.id}_\\d+$`));
  });
});

describe("POST /api/subscription/subscribe — le crédit de jours d'un changement de formule", () => {
  /** Jours de crédit attendus : les jours restants de l'ancienne formule, convertis au tarif de la nouvelle (voir calculerJoursCredit). */
  function creditAttendu(opts: { ancienDebut: Date; ancienCycle: "MONTHLY" | "ANNUAL"; ancienMontant: number; joursRestants: number; nouveauMontant: number }) {
    const nominal = calculerPeriode({ maintenant: opts.ancienDebut, cycle: opts.ancienCycle, finActuelle: null });
    const ancienCycleJours = Math.max(1, Math.round((nominal.endDate.getTime() - nominal.startDate.getTime()) / JOUR));
    const maintenant = new Date();
    const base = calculerPeriode({ maintenant, cycle: "MONTHLY", finActuelle: null });
    const nouveauCycleJours = Math.max(1, Math.round((base.endDate.getTime() - base.startDate.getTime()) / JOUR));
    return { nouveauCycleJours, jours: calculerJoursCredit({ ancienMontant: opts.ancienMontant, ancienCycleJours, joursRestants: opts.joursRestants, nouveauMontant: opts.nouveauMontant, nouveauCycleJours }) };
  }

  async function passerEnPro(manager: Awaited<ReturnType<typeof createManager>>) {
    const avant = Date.now();
    const res = await request(app)
      .post("/api/subscription/subscribe")
      .set(authHeader(tokenFor(manager)))
      .send({ plan: "PRO", billingCycle: "MONTHLY", paymentMethod: "DEMO" });
    expect(res.status).toBe(200);
    const [maj] = await testDb.select().from(users).where(eq(users.id, manager.id));
    return (maj.subscriptionEndsAt!.getTime() - avant) / JOUR;
  }

  it("un paiement en attente ou rejeté, même plus récent, n'est jamais pris pour référence : seul le dernier paiement RÉGLÉ compte", async () => {
    const debut = new Date(Date.now() - 20 * JOUR);
    const fin = new Date(Date.now() + 10 * JOUR);
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "STARTER", subscriptionEndsAt: fin });
    await createPlatformSubscription(manager.id, { plan: "STARTER", amount: 9, billingCycle: "MONTHLY", startDate: debut, endDate: fin, createdAt: new Date(Date.now() - 20 * JOUR) });
    // Plus récents, mais pas réglés : un paiement PayDunya attendu à 29 et un ancien virement rejeté à 49.
    await createPlatformSubscription(manager.id, { plan: "PRO", amount: 29, status: "PENDING", paymentMethod: "PAYDUNYA", billingCycle: "MONTHLY", startDate: debut, endDate: fin, createdAt: new Date(Date.now() - 5 * JOUR) });
    await createPlatformSubscription(manager.id, { plan: "ENTERPRISE", amount: 49, status: "REJECTED", paymentMethod: "BANK_TRANSFER", billingCycle: "MONTHLY", startDate: debut, endDate: fin, createdAt: new Date(Date.now() - 2 * JOUR) });

    const joursTotal = await passerEnPro(manager);

    const { nouveauCycleJours, jours } = creditAttendu({ ancienDebut: debut, ancienCycle: "MONTHLY", ancienMontant: 9, joursRestants: 10, nouveauMontant: 29 });
    // Environ 3 jours de crédit (9 €) ; avec 29 € ou 49 € on en aurait eu 10 ou plus.
    expect(jours).toBeLessThan(4);
    expect(Math.abs(joursTotal - (nouveauCycleJours + jours))).toBeLessThanOrEqual(1);
  });

  it("entre deux paiements réglés, le plus récent sert de référence", async () => {
    const debut = new Date(Date.now() - 20 * JOUR);
    const fin = new Date(Date.now() + 10 * JOUR);
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "STARTER", subscriptionEndsAt: fin });
    // Le plus ancien, réglé à 29, ne doit pas être retenu : le dernier réglé est à 9.
    await createPlatformSubscription(manager.id, { plan: "PRO", amount: 29, billingCycle: "MONTHLY", startDate: new Date(Date.now() - 80 * JOUR), endDate: new Date(Date.now() - 50 * JOUR), createdAt: new Date(Date.now() - 80 * JOUR) });
    await createPlatformSubscription(manager.id, { plan: "STARTER", amount: 9, billingCycle: "MONTHLY", startDate: debut, endDate: fin, createdAt: new Date(Date.now() - 20 * JOUR) });

    const joursTotal = await passerEnPro(manager);

    const { nouveauCycleJours, jours } = creditAttendu({ ancienDebut: debut, ancienCycle: "MONTHLY", ancienMontant: 9, joursRestants: 10, nouveauMontant: 29 });
    expect(Math.abs(joursTotal - (nouveauCycleJours + jours))).toBeLessThanOrEqual(1);
  });

  it("le cycle du dernier paiement compte : un abonnement ANNUEL est valorisé sur 365 jours, pas sur 30", async () => {
    const debut = new Date(Date.now() - 100 * JOUR);
    const fin = new Date(Date.now() + 265 * JOUR);
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "STARTER", subscriptionEndsAt: fin });
    await createPlatformSubscription(manager.id, { plan: "STARTER", amount: 86, billingCycle: "ANNUAL", startDate: debut, endDate: fin, createdAt: new Date(Date.now() - 100 * JOUR) });

    const joursTotal = await passerEnPro(manager);

    const { nouveauCycleJours, jours } = creditAttendu({ ancienDebut: debut, ancienCycle: "ANNUAL", ancienMontant: 86, joursRestants: 265, nouveauMontant: 29 });
    // 265 jours d'un abonnement annuel à 86 € valent ~62 € : environ 64 jours de formule Pro ; sur un cycle de 30 jours ce serait ~800.
    expect(jours).toBeLessThan(100);
    expect(Math.abs(joursTotal - (nouveauCycleJours + jours))).toBeLessThanOrEqual(1);
  });
});

describe("POST /api/subscription/subscribe — ce qui est enregistré et annoncé", () => {
  it("un paiement confirmé active le compte (moyen de paiement compris), enregistre la ligne payée avec sa référence et ses dates, et l'annonce", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/subscription/subscribe")
      .set(authHeader(tokenFor(manager)))
      .send({ plan: "PRO", billingCycle: "MONTHLY", paymentMethod: "DEMO" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain("a été activé avec succès");
    expect(res.body.message).not.toContain("en attente");
    const [compte] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(compte).toMatchObject({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", subscriptionPaymentMethod: "DEMO" });
    const [ligne] = await testDb.select().from(platformSubscriptions).where(eq(platformSubscriptions.userId, manager.id));
    expect(ligne).toMatchObject({ plan: "PRO", amount: 29, currency: "EUR", billingCycle: "MONTHLY", status: "PAID", paymentMethod: "DEMO" });
    expect(ligne.paymentRef).toBeTruthy();
    expect(ligne.paymentRef).toBe(res.body.payment.reference);
    expect(ligne.endDate.getTime()).toBeGreaterThan(ligne.startDate.getTime());
    expect(res.body.record.id).toBe(ligne.id);
    expect(compte.subscriptionEndsAt).toEqual(ligne.endDate);
  });

  it("un virement n'est plus accepté : 400, aucune ligne d'historique, l'essai reste intact", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/subscription/subscribe")
      .set(authHeader(tokenFor(manager)))
      .send({ plan: "STARTER", billingCycle: "ANNUAL", paymentMethod: "BANK_TRANSFER", bankReference: "VIR-42" });

    expect(res.status).toBe(400);
    const [compte] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(compte.subscriptionStatus).toBe("TRIAL");
    expect(compte.subscriptionPaymentMethod).toBeNull();
    expect(await testDb.select().from(platformSubscriptions).where(eq(platformSubscriptions.userId, manager.id))).toHaveLength(0);
  });
});

describe("collaborateur d'une agence : jamais l'abonnement", () => {
  async function agence() {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: new Date(Date.now() + 20 * JOUR) });
    const collaborateur = await createTeamMember(manager.id);
    const jeton = tokenFor({ id: manager.id, role: "MANAGER" }, null, null, collaborateur.id);
    return { manager, jeton };
  }

  it("ne peut pas résilier : 403 OWNER_ONLY_SUBSCRIPTION, et l'abonnement reste actif", async () => {
    const { manager, jeton } = await agence();

    const res = await request(app).post("/api/subscription/cancel").set(authHeader(jeton));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("OWNER_ONLY_SUBSCRIPTION");
    const [compte] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(compte.subscriptionStatus).toBe("ACTIVE");
  });

  it("ne peut pas souscrire : 403 OWNER_ONLY_SUBSCRIPTION, et aucun paiement n'est tenté", async () => {
    const { manager, jeton } = await agence();
    const espion = vi.spyOn(paymentService, "initiatePayment");

    const res = await request(app).post("/api/subscription/subscribe").set(authHeader(jeton)).send({ plan: "STARTER", billingCycle: "MONTHLY", paymentMethod: "DEMO" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("OWNER_ONLY_SUBSCRIPTION");
    expect(espion).not.toHaveBeenCalled();
    const [compte] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(compte.subscriptionPlan).toBe("ENTERPRISE");
  });

  it("le propriétaire, lui, résilie sa propre agence sans toucher à celle d'un autre", async () => {
    const { manager } = await agence();
    const autre = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", subscriptionEndsAt: new Date(Date.now() + 20 * JOUR) });

    const res = await request(app).post("/api/subscription/cancel").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const [le_mien] = await testDb.select().from(users).where(eq(users.id, manager.id));
    const [le_leur] = await testDb.select().from(users).where(eq(users.id, autre.id));
    expect(le_mien.subscriptionStatus).toBe("CANCELLED");
    expect(le_leur.subscriptionStatus).toBe("ACTIVE");
  });
});
