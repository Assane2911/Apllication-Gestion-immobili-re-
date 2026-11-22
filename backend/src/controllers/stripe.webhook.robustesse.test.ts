import * as Sentry from "@sentry/node";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { activityLogs, invoices, platformSubscriptions, users } from "../db/schema";
import * as emailService from "../services/email.service";
import * as echecPrelevement from "../services/echecPrelevement.service";
import * as paiementEnLigne from "../services/paiementEnLigne.service";
import * as paiementNonRapproche from "../services/paiementNonRapproche.service";
import * as subscriptionActivation from "../services/subscriptionActivation.service";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Webhook Stripe : lecture de l'en-tête de signature et événements incomplets ou inattendus. La route est publique, sa sécurité est la
 * signature ; et Stripe REJOUE tout ce qui n'obtient pas un 200 — un événement authentique mais incomplet doit donc recevoir un 200
 * sans rien faire, jamais une erreur. Le fichier principal vérifie les paiements ; ici, la robustesse.
 */

const SECRET = "whsec_test_do_not_use_in_production"; // celui que setupTestDb.ts force
const URL = "/api/payments/stripe/webhook";

const maintenant = () => Math.floor(Date.now() / 1000);
const hmac = (t: number | string, corps: string) => crypto.createHmac("sha256", SECRET).update(`${t}.${corps}`).digest("hex");
const signer = (corps: string, t = maintenant()) => `t=${t},v1=${hmac(t, corps)}`;
const livrer = (corps: string, entete?: string) => request(app).post(URL).set("Content-Type", "application/json").set("stripe-signature", entete ?? signer(corps)).send(corps);
const evenement = (type: string, objet?: unknown) => JSON.stringify(objet === undefined ? { type } : { type, data: { object: objet } });

let courriel: ReturnType<typeof vi.spyOn>;
let stripe: ReturnType<typeof vi.fn>;

beforeEach(() => {
  courriel = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false } as never);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  stripe = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ id: "cs_loyer" }] }) });
  vi.stubGlobal("fetch", stripe);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loyerStripe(extra: Partial<typeof invoices.$inferInsert> = {}) {
  const manager = await createManager();
  const property = await createProperty(manager.id, { title: "Villa Ngor" });
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id);
  const invoice = await createInvoice(contract.id, { status: "PENDING", paymentMethod: "STRIPE", paymentRef: "cs_loyer", amount: 500, periodMonth: 3, periodYear: 2026, ...extra });
  return { manager, invoice };
}
const journal = (managerId: string) => testDb.select().from(activityLogs).where(eq(activityLogs.managerId, managerId));
const facture = async (id: string) => (await testDb.select().from(invoices).where(eq(invoices.id, id)))[0];

describe("webhook Stripe : en-tête de signature", () => {
  const corps = evenement("customer.created", { id: "cus_1" });

  it("une signature correcte est acceptée, y compris accompagnée de schémas inconnus (v0) ou d'une ancienne signature pendant une rotation de secret", async () => {
    const t = maintenant();
    const bonne = hmac(t, corps);

    expect((await livrer(corps, `t=${t},v1=${bonne}`)).status).toBe(200);
    expect((await livrer(corps, `t=${t},v0=garbage,v1=${bonne}`)).status).toBe(200);
    expect((await livrer(corps, `t=${t},v1=${"0".repeat(64)},v1=${bonne}`)).status).toBe(200);
    expect((await livrer(corps, ` t=${t}`.trim() + `,v1=${bonne},autre`)).status).toBe(200); // un morceau sans « = » est ignoré
  });

  it("un en-tête incomplet est refusé : sans signature, sans horodatage, signature vide, horodatage illisible", async () => {
    const t = maintenant();
    const bonne = hmac(t, corps);

    for (const entete of [`t=${t}`, `t=${t},v1=`, `v1=${bonne}`, `t=abc,v1=${bonne}`, `t=,v1=${bonne}`, "n'importe quoi", `v0=${bonne}`]) {
      const res = await livrer(corps, entete);
      expect(res.status, entete).toBe(401);
    }
  });

  it("un horodatage illisible est refusé MÊME si la signature a été calculée avec lui", async () => {
    const t = "abc";

    expect((await livrer(corps, `t=${t},v1=${hmac(t, corps)}`)).status).toBe(401);
    expect((await livrer(corps, `t=NaN,v1=${hmac("NaN", corps)}`)).status).toBe(401);
  });

  it("l'horodatage est borné dans les DEUX sens : trop ancien et trop dans le futur sont refusés, 4 minutes d'écart sont tolérées", async () => {
    const t = maintenant();

    expect((await livrer(corps, signer(corps, t - 600))).status).toBe(401);
    expect((await livrer(corps, signer(corps, t + 600))).status).toBe(401);
    expect((await livrer(corps, signer(corps, t - 240))).status).toBe(200);
    expect((await livrer(corps, signer(corps, t + 240))).status).toBe(200);
  });

  it("une signature de mauvaise longueur, ou calculée avec un autre secret, ou sur un corps modifié, est refusée sans erreur", async () => {
    const t = maintenant();

    expect((await livrer(corps, `t=${t},v1=abc`)).status).toBe(401);
    expect((await livrer(corps, `t=${t},v1=${hmac(t, corps)}00`)).status).toBe(401); // trop longue
    const autreSecret = crypto.createHmac("sha256", "whsec_autre").update(`${t}.${corps}`).digest("hex");
    expect((await livrer(corps, `t=${t},v1=${autreSecret}`)).status).toBe(401);
    expect((await livrer(corps + " ", `t=${t},v1=${hmac(t, corps)}`)).status).toBe(401); // un espace de plus change l'empreinte
  });

  it("un événement authentique dont le corps n'est pas du JSON reçoit 400 ; une requête sans corps du tout aussi", async () => {
    const illisible = "pas du json";
    expect((await livrer(illisible)).status).toBe(400);

    const sansCorps = await request(app).post(URL).set("stripe-signature", `t=${maintenant()},v1=${"0".repeat(64)}`);
    expect(sansCorps.status).toBe(400);
  });
});

describe("webhook Stripe : événements authentiques mais incomplets", () => {
  it("chaque type d'événement reçu SANS données répond 200 sans rien faire ni appeler Stripe (sinon Stripe le rejouerait)", async () => {
    const types = [
      "invoice.paid",
      "invoice.payment_failed",
      "charge.refunded",
      "charge.dispute.created",
      "customer.subscription.deleted",
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
    ];

    for (const type of types) {
      const res = await livrer(evenement(type));
      expect(res.status, type).toBe(200);
      expect(res.body, type).toEqual({ received: true });
    }
    expect(stripe).not.toHaveBeenCalled();
    expect(courriel).not.toHaveBeenCalled();
  });

  it("remboursement ou litige auquel il manque l'identifiant, le paiement ou le montant : ignoré, Stripe n'est pas interrogé, personne n'est prévenu", async () => {
    await loyerStripe();
    const incompletsRemboursement = [
      { payment_intent: "pi_1", amount_refunded: 100 },
      { id: "ch_1", amount_refunded: 100 },
      { id: "ch_1", payment_intent: "pi_1" },
      { id: "ch_1", payment_intent: "pi_1", amount_refunded: "100" },
      { id: "ch_1", payment_intent: null, amount_refunded: 100 },
    ];
    const incompletsLitige = [
      { payment_intent: "pi_1", amount: 100 },
      { id: "dp_1", amount: 100 },
      { id: "dp_1", payment_intent: "pi_1" },
      { id: "dp_1", payment_intent: "pi_1", amount: "100" },
    ];

    for (const o of incompletsRemboursement) expect((await livrer(evenement("charge.refunded", o))).status).toBe(200);
    for (const o of incompletsLitige) expect((await livrer(evenement("charge.dispute.created", o))).status).toBe(200);

    expect(stripe).not.toHaveBeenCalled();
    expect(courriel).not.toHaveBeenCalled();
  });

  it("un remboursement complet sans devise est quand même signalé (la devise de la facture sert au message), et un montant à 0 aussi", async () => {
    const { manager } = await loyerStripe();

    const res = await livrer(evenement("charge.refunded", { id: "ch_1", payment_intent: "pi_1", amount_refunded: 0 }));

    expect(res.status).toBe(200);
    expect(stripe).toHaveBeenCalledTimes(1);
    expect(courriel).toHaveBeenCalledTimes(1);
    expect((await journal(manager.id)).map((l: { action: string }) => l.action)).toContain("paiement_en_ligne.rembourse");
  });

  it("un litige sans motif ni date limite (absents ou null) est signalé sans les mentionner", async () => {
    const { manager } = await loyerStripe();

    await livrer(evenement("charge.dispute.created", { id: "dp_1", payment_intent: "pi_1", amount: 50000, currency: "eur" }));
    await livrer(evenement("charge.dispute.created", { id: "dp_2", payment_intent: "pi_1", amount: 50000, currency: "eur", reason: null, evidence_details: { due_by: null } }));

    const lignes = (await journal(manager.id)).filter((l: { action: string }) => l.action === "paiement_en_ligne.litige");
    expect(lignes).toHaveLength(2);
    for (const l of lignes) {
      expect(l.details).not.toContain("motif");
      expect(l.details).not.toContain("réponse avant");
    }
  });

  it("un litige avec une date limite non numérique est signalé sans date", async () => {
    const { manager } = await loyerStripe();

    await livrer(evenement("charge.dispute.created", { id: "dp_3", payment_intent: "pi_1", amount: 50000, currency: "eur", reason: "fraudulent", evidence_details: { due_by: "demain" } }));

    const [ligne] = (await journal(manager.id)).filter((l: { action: string }) => l.action === "paiement_en_ligne.litige");
    expect(ligne.details).toContain("motif : fraudulent");
    expect(ligne.details).not.toContain("réponse avant");
  });

  it("la suppression d'un abonnement sans identifiant ne touche à aucun compte", async () => {
    const manager = await createManager({ stripeSubscriptionId: "sub_garde", stripeCustomerId: "cus_garde" });
    const expirer = vi.spyOn(subscriptionActivation, "expireStripeSubscription");

    expect((await livrer(evenement("customer.subscription.deleted", {}))).status).toBe(200);
    expect((await livrer(evenement("customer.subscription.deleted", { id: "" }))).status).toBe(200);

    expect(expirer).not.toHaveBeenCalled();

    const [compte] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(compte.stripeSubscriptionId).toBe("sub_garde");
  });

  it("une session sans identifiant ou sans référence est ignorée avec un avertissement, la facture n'est pas touchée", async () => {
    const { invoice } = await loyerStripe();
    const avertissement = vi.spyOn(console, "warn").mockImplementation(() => {});

    await livrer(evenement("checkout.session.completed", { payment_status: "paid", amount_total: 50000, currency: "eur", client_reference_id: invoice.id }));
    await livrer(evenement("checkout.session.completed", { id: "cs_loyer", payment_status: "paid", amount_total: 50000, currency: "eur" }));

    expect((await facture(invoice.id)).status).toBe("PENDING");
    expect(avertissement.mock.calls.filter((c) => String(c[0]).includes("incomplet"))).toHaveLength(2);
  });

  it("la référence peut venir des métadonnées de la session quand client_reference_id est absent", async () => {
    const { invoice } = await loyerStripe();

    const res = await livrer(evenement("checkout.session.completed", { id: "cs_loyer", payment_status: "paid", amount_total: 50000, currency: "eur", metadata: { reference: invoice.id } }));

    expect(res.status).toBe(200);
    expect((await facture(invoice.id)).status).toBe("PAID");
  });
});

describe("webhook Stripe : paiement sans montant exploitable", () => {
  it("un loyer payé SANS montant n'est jamais soldé : le gestionnaire est prévenu avec un montant de 0", async () => {
    const { manager, invoice } = await loyerStripe();
    const signaler = vi.spyOn(paiementNonRapproche, "signalerPaiementNonRapproche");

    const res = await livrer(evenement("checkout.session.completed", { id: "cs_loyer", payment_status: "paid", currency: "eur", client_reference_id: invoice.id }));

    expect(res.status).toBe(200);
    expect(signaler).toHaveBeenCalledTimes(1);
    expect(signaler.mock.calls[0][0].montant).toBe(0); // jamais NaN
    expect((await facture(invoice.id)).status).toBe("PENDING");
    expect(courriel).toHaveBeenCalledTimes(1);
    expect(courriel.mock.calls[0][0]).toBe(manager.email);
    expect((await journal(manager.id)).map((l: { action: string }) => l.action)).toContain("paiement_en_ligne.non_rapproche");
  });

  it("un abonnement payé SANS montant n'est pas activé et est signalé à Sentry", async () => {
    const signal = vi.spyOn(Sentry, "captureMessage");
    const manager = await createManager({ subscriptionStatus: "EXPIRED" });
    const [abonnement] = await testDb
      .insert(platformSubscriptions)
      .values({ userId: manager.id, plan: "PRO", amount: 29, currency: "EUR", status: "PENDING", paymentMethod: "STRIPE", paymentRef: "cs_abo", startDate: new Date(2026, 8, 1), endDate: new Date(2026, 9, 1) })
      .returning();

    const res = await livrer(evenement("checkout.session.completed", { id: "cs_abo", payment_status: "paid", currency: "eur", client_reference_id: `sub_${manager.id}_1` }));

    expect(res.status).toBe(200);
    expect((await testDb.select().from(platformSubscriptions).where(eq(platformSubscriptions.id, abonnement.id)))[0].status).toBe("PENDING");
    expect(signal).toHaveBeenCalledTimes(1);
  });

  it("un abonnement dont la session n'est connue d'aucune ligne est signalé à Sentry, sans rien activer", async () => {
    const signal = vi.spyOn(Sentry, "captureMessage");
    const manager = await createManager({ subscriptionStatus: "EXPIRED" });

    const res = await livrer(evenement("checkout.session.completed", { id: "cs_inconnue", payment_status: "paid", amount_total: 2900, currency: "eur", client_reference_id: `sub_${manager.id}_1` }));

    expect(res.status).toBe(200);
    expect(signal).toHaveBeenCalledTimes(1);
    expect((await testDb.select().from(users).where(eq(users.id, manager.id)))[0].subscriptionStatus).toBe("EXPIRED");
  });

  it("une facture déjà soldée par une autre livraison du même événement : pas de quittance en double, réponse 200", async () => {
    const { invoice } = await loyerStripe();
    vi.spyOn(paiementEnLigne, "solderEnLigne").mockResolvedValue(null as never); // la base tranche : une autre livraison a déjà soldé

    const res = await livrer(evenement("checkout.session.completed", { id: "cs_loyer", payment_status: "paid", amount_total: 50000, currency: "eur", client_reference_id: invoice.id }));

    expect(res.status).toBe(200);
    expect(courriel).not.toHaveBeenCalled(); // aucune quittance
  });
});

describe("webhook Stripe : prélèvement raté et renouvellement incomplets", () => {
  const echec = (extra: Record<string, unknown>) => evenement("invoice.payment_failed", { id: "in_echec", subscription: "sub_stripe_echec", billing_reason: "subscription_cycle", ...extra });

  it("sans numéro d'essai, sans montant ni devise, sans prochaine date : la première tentative, un montant à 0 et « aucun nouvel essai »", async () => {
    const manager = await createManager({ stripeSubscriptionId: "sub_stripe_echec" });

    const res = await livrer(echec({}));

    expect(res.status).toBe(200);
    const [ligne] = (await journal(manager.id)).filter((l: { action: string }) => l.action === "abonnement.prelevement_echoue");
    expect(ligne.details).toContain("essai 1");
    expect(ligne.details).toContain("Aucun nouvel essai automatique");
    expect(courriel).toHaveBeenCalledTimes(1);
  });

  it("une date de prochain essai qui n'est pas un nombre est ignorée : « aucun nouvel essai »", async () => {
    const manager = await createManager({ stripeSubscriptionId: "sub_stripe_echec" });

    await livrer(echec({ next_payment_attempt: "bientôt", attempt_count: 2 }));

    const [ligne] = (await journal(manager.id)).filter((l: { action: string }) => l.action === "abonnement.prelevement_echoue");
    expect(ligne.details).toContain("essai 2");
    expect(ligne.details).toContain("Aucun nouvel essai automatique");
  });

  it("un prélèvement raté sans identifiant de facture, sans abonnement, ou qui n'est pas un cycle de renouvellement, n'avertit personne et n'est même pas transmis", async () => {
    await createManager({ stripeSubscriptionId: "sub_stripe_echec" });
    const signaler = vi.spyOn(echecPrelevement, "signalerEchecPrelevement");

    expect((await livrer(evenement("invoice.payment_failed", { subscription: "sub_stripe_echec", billing_reason: "subscription_cycle" }))).status).toBe(200);
    expect((await livrer(evenement("invoice.payment_failed", { id: "in_x", billing_reason: "subscription_cycle" }))).status).toBe(200);
    expect((await livrer(evenement("invoice.payment_failed", { id: "in_y", subscription: "sub_stripe_echec" }))).status).toBe(200);
    expect((await livrer(evenement("invoice.payment_failed", { id: "in_z", subscription: "sub_stripe_echec", billing_reason: "subscription_create" }))).status).toBe(200);

    expect(signaler).not.toHaveBeenCalled();
    expect(courriel).not.toHaveBeenCalled();
  });

  it("un renouvellement payé sans montant, sans identifiant, ou qui n'est pas un cycle est ignoré, sans toucher à l'abonnement", async () => {
    const fin = new Date(2026, 9, 1);
    const manager = await createManager({ stripeSubscriptionId: "sub_stripe_renouv", subscriptionStatus: "ACTIVE", subscriptionEndsAt: fin });
    const avertissement = vi.spyOn(console, "warn").mockImplementation(() => {});
    const renouveler = vi.spyOn(subscriptionActivation, "renewSubscriptionFromStripeInvoice");

    const sansMontant = await livrer(evenement("invoice.paid", { id: "in_1", subscription: "sub_stripe_renouv", billing_reason: "subscription_cycle", currency: "eur" }));
    const sansId = await livrer(evenement("invoice.paid", { subscription: "sub_stripe_renouv", billing_reason: "subscription_cycle", amount_paid: 2900, currency: "eur" }));
    const sansMotif = await livrer(evenement("invoice.paid", { id: "in_2", subscription: "sub_stripe_renouv", amount_paid: 2900, currency: "eur" }));
    const premiere = await livrer(evenement("invoice.paid", { id: "in_3", subscription: "sub_stripe_renouv", billing_reason: "subscription_create", amount_paid: 2900, currency: "eur" }));

    expect([sansMontant.status, sansId.status, sansMotif.status, premiere.status]).toEqual([200, 200, 200, 200]);
    expect(renouveler).not.toHaveBeenCalled(); // aucun de ces événements n'atteint la prolongation
    expect(avertissement.mock.calls.some((c) => String(c[0]).includes("sans montant exploitable"))).toBe(true);
    const [compte] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(compte.subscriptionEndsAt?.getTime()).toBe(fin.getTime());
  });
});
