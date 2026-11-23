import crypto from "crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { invoices, platformSubscriptions, users } from "../db/schema";
import * as echecPrelevement from "../services/echecPrelevement.service";
import * as emailService from "../services/email.service";
import * as paiementNonRapproche from "../services/paiementNonRapproche.service";
import * as receipt from "../services/receipt.service";
import * as remboursement from "../services/remboursementPaiement.service";
import * as subscriptionActivation from "../services/subscriptionActivation.service";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Cas limites du webhook Stripe (stripe.controller.ts), trouvés en sabotant le contrôleur : chaque test ci-dessous échoue si la
 * ligne qu'il garde est modifiée, alors que les tests existants passaient tous.
 */
const SECRET = "whsec_test_do_not_use_in_production"; // celui que setupTestDb.ts force
const URL = "/api/payments/stripe/webhook";

const maintenant = () => Math.floor(Date.now() / 1000);
const hmac = (t: number | string, corps: string, secret = SECRET) => crypto.createHmac("sha256", secret).update(`${t}.${corps}`).digest("hex");
const signer = (corps: string, t = maintenant()) => `t=${t},v1=${hmac(t, corps)}`;
const livrer = (corps: string, entete?: string) => request(app).post(URL).set("Content-Type", "application/json").set("stripe-signature", entete ?? signer(corps)).send(corps);
const evenement = (type: string, objet?: unknown) => JSON.stringify(objet === undefined ? { type } : { type, data: { object: objet } });
const session = (objet: Record<string, unknown>, type = "checkout.session.completed") => evenement(type, { payment_status: "paid", currency: "eur", ...objet });

beforeEach(() => {
  vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false } as never);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function loyer(extra: Partial<typeof invoices.$inferInsert> = {}) {
  const manager = await createManager();
  const property = await createProperty(manager.id, { title: "Villa Ngor" });
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id);
  const invoice = await createInvoice(contract.id, { status: "PENDING", paymentMethod: "STRIPE", paymentRef: "cs_loyer", amount: 500, periodMonth: 3, periodYear: 2026, ...extra });
  return { manager, invoice };
}
const facture = async (id: string) => (await testDb.select().from(invoices).where(eq(invoices.id, id)))[0];

async function abonnement(extra: Partial<typeof platformSubscriptions.$inferInsert> = {}) {
  const manager = await createManager({ subscriptionStatus: "EXPIRED" });
  const [ligne] = await testDb
    .insert(platformSubscriptions)
    .values({ userId: manager.id, plan: "PRO", amount: 29, currency: "EUR", status: "PENDING", paymentMethod: "STRIPE", paymentRef: "cs_abo", startDate: new Date(2026, 8, 1), endDate: new Date(2026, 9, 1), ...extra })
    .returning();
  return { manager, ligne };
}
const abonnementDe = async (id: string) => (await testDb.select().from(platformSubscriptions).where(eq(platformSubscriptions.id, id)))[0];

describe("webhook Stripe — signature", () => {
  it("refuse un événement signé avec un secret vide quand le secret de la plateforme est vide", async () => {
    const corps = evenement("customer.created", { id: "cus_1" });
    const avant = env.payments.stripeWebhookSecret;
    env.payments.stripeWebhookSecret = "";
    try {
      const t = maintenant();
      const res = await livrer(corps, `t=${t},v1=${hmac(t, corps, "")}`);
      expect(res.status).toBe(401);
    } finally {
      env.payments.stripeWebhookSecret = avant;
    }
  });

  it("accepte un événement émis il y a exactement 5 minutes, ou dans 5 minutes, et refuse une seconde de plus", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T12:00:00Z"));
    const corps = evenement("customer.created", { id: "cus_1" });
    const t = maintenant();

    expect((await livrer(corps, `t=${t - 300},v1=${hmac(t - 300, corps)}`)).status).toBe(200);
    expect((await livrer(corps, `t=${t + 300},v1=${hmac(t + 300, corps)}`)).status).toBe(200);
    expect((await livrer(corps, `t=${t - 301},v1=${hmac(t - 301, corps)}`)).status).toBe(401);
    expect((await livrer(corps, `t=${t + 301},v1=${hmac(t + 301, corps)}`)).status).toBe(401);
  });

  it("accepte l'événement quand UNE signature valide précède une signature fausse (rotation du secret)", async () => {
    const corps = evenement("customer.created", { id: "cus_1" });
    const t = maintenant();
    const fausse = "0".repeat(64);

    const res = await livrer(corps, `t=${t},v1=${hmac(t, corps)},v1=${fausse}`);

    expect(res.status).toBe(200);
  });
});

describe("webhook Stripe — réponses et types d'événements", () => {
  it("un événement d'un autre type, même s'il ressemble à une session payée, ne solde aucune facture", async () => {
    const { invoice } = await loyer();
    const corps = session({ id: "cs_loyer", client_reference_id: invoice.id, amount_total: 50000 }, "payment_intent.succeeded");

    const res = await livrer(corps);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect((await facture(invoice.id)).status).toBe("PENDING");
  });

  it("répond {received: true} à une session non payée et à un loyer soldé", async () => {
    const { invoice } = await loyer();
    const nonPayee = session({ id: "cs_loyer", client_reference_id: invoice.id, amount_total: 50000, payment_status: "unpaid" });
    const payee = session({ id: "cs_loyer", client_reference_id: invoice.id, amount_total: 50000 });

    const a = await livrer(nonPayee);
    const b = await livrer(payee);

    expect(a.body).toEqual({ received: true });
    expect(b.body).toEqual({ received: true });
    expect((await facture(invoice.id)).status).toBe("PAID");
  });
});

describe("webhook Stripe — remboursements et litiges", () => {
  it("transmet le débit, le paiement, le montant et la devise d'un remboursement", async () => {
    const signaler = vi.spyOn(remboursement, "signalerRemboursementOuLitige").mockResolvedValue(undefined);

    await livrer(evenement("charge.refunded", { id: "ch_1", payment_intent: "pi_1", amount_refunded: 1500, currency: "eur" }));

    expect(signaler).toHaveBeenCalledWith({ nature: "REMBOURSEMENT", referenceStripe: "ch_1", paymentIntent: "pi_1", montantBrut: 1500, devise: "eur" });
  });

  it("transmet la contestation, le paiement, le montant, la devise, le motif et la date limite d'un litige", async () => {
    const signaler = vi.spyOn(remboursement, "signalerRemboursementOuLitige").mockResolvedValue(undefined);

    await livrer(
      evenement("charge.dispute.created", { id: "dp_1", payment_intent: "pi_2", amount: 2900, currency: "xof", reason: "fraudulent", evidence_details: { due_by: 1800000000 } })
    );

    expect(signaler).toHaveBeenCalledWith({
      nature: "LITIGE",
      referenceStripe: "dp_1",
      paymentIntent: "pi_2",
      montantBrut: 2900,
      devise: "xof",
      motif: "fraudulent",
      reponseAvant: new Date(1800000000 * 1000),
    });
  });
});

describe("webhook Stripe — loyer", () => {
  it("solde un loyer en francs CFA même quand Stripe écrit la devise en minuscules", async () => {
    const { invoice } = await loyer({ currency: "XOF", amount: 15000 });

    const res = await livrer(session({ id: "cs_loyer", client_reference_id: invoice.id, amount_total: 15000, currency: "xof" }));

    expect(res.status).toBe(200);
    expect((await facture(invoice.id)).status).toBe("PAID");
  });

  it("solde un loyer au prorata en francs CFA payé au franc entier (54 838,71 → 54 839)", async () => {
    const { invoice } = await loyer({ currency: "XOF", amount: 54838.71 });

    await livrer(session({ id: "cs_loyer", client_reference_id: invoice.id, amount_total: 54839, currency: "xof" }));

    expect((await facture(invoice.id)).status).toBe("PAID");
  });

  it.each([
    ["5 centimes", 50005],
    ["50 centimes", 50050],
  ])("ne solde pas un loyer payé avec %s d'écart", async (_nom, centimes) => {
    const { invoice } = await loyer();

    await livrer(session({ id: "cs_loyer", client_reference_id: invoice.id, amount_total: centimes }));

    expect((await facture(invoice.id)).status).toBe("PENDING");
  });

  it("un échec de l'envoi de la quittance ne défait pas le règlement", async () => {
    const { invoice } = await loyer();
    vi.spyOn(receipt, "sendPaymentReceiptEmail").mockRejectedValue(new Error("SMTP indisponible"));

    const res = await livrer(session({ id: "cs_loyer", client_reference_id: invoice.id, amount_total: 50000 }));

    expect(res.status).toBe(200);
    expect((await facture(invoice.id)).status).toBe("PAID");
  });

  it("signale un paiement non rapproché avec le prestataire, les références, le montant, la devise et la raison", async () => {
    const signaler = vi.spyOn(paiementNonRapproche, "signalerPaiementNonRapproche").mockResolvedValue(undefined as never);
    const { invoice } = await loyer();
    const annulee = await loyer({ status: "CANCELLED", paymentRef: "cs_annulee" });

    await livrer(session({ id: "cs_loyer", client_reference_id: invoice.id, amount_total: 12345 }));
    await livrer(session({ id: "cs_annulee", client_reference_id: annulee.invoice.id, amount_total: 50000 }));
    await livrer(session({ id: "cs_inconnue", client_reference_id: invoice.id, amount_total: 50000 }));

    expect(signaler).toHaveBeenNthCalledWith(1, {
      prestataire: "STRIPE",
      referenceFacture: invoice.id,
      referencePrestataire: "cs_loyer",
      montant: 123.45,
      devise: "EUR",
      raison: "le montant payé ne correspond plus au reste dû, qui a changé depuis le début du paiement",
    });
    expect(signaler).toHaveBeenNthCalledWith(2, {
      prestataire: "STRIPE",
      referenceFacture: annulee.invoice.id,
      referencePrestataire: "cs_annulee",
      montant: 500,
      devise: "EUR",
      raison: "la facture a été annulée",
    });
    expect(signaler).toHaveBeenNthCalledWith(3, expect.objectContaining({ prestataire: "STRIPE", referencePrestataire: "cs_inconnue", montant: 500, devise: "EUR" }));
  });
});

describe("webhook Stripe — abonnement de la plateforme", () => {
  it("n'active jamais un abonnement sur un paiement sans montant, même quand l'abonnement attendu est à 0", async () => {
    const { ligne } = await abonnement({ amount: 0 });

    await livrer(session({ id: "cs_abo", client_reference_id: `sub_${ligne.userId}_1` }));

    expect((await abonnementDe(ligne.id)).status).toBe("PENDING");
  });

  it.each([
    ["5 centimes", 2905],
    ["50 centimes", 2950],
  ])("n'active pas un abonnement payé avec %s d'écart", async (_nom, centimes) => {
    const { ligne } = await abonnement();

    await livrer(session({ id: "cs_abo", client_reference_id: `sub_${ligne.userId}_1`, amount_total: centimes }));

    expect((await abonnementDe(ligne.id)).status).toBe("PENDING");
  });

  it("ne rattache le Customer et la Subscription Stripe qu'avec les DEUX identifiants", async () => {
    const seulClient = await abonnement({ paymentRef: "cs_a" });
    const seulAbonnement = await abonnement({ paymentRef: "cs_b" });
    const lesDeux = await abonnement({ paymentRef: "cs_c" });

    await livrer(session({ id: "cs_a", client_reference_id: `sub_${seulClient.ligne.userId}_1`, amount_total: 2900, customer: "cus_1" }));
    await livrer(session({ id: "cs_b", client_reference_id: `sub_${seulAbonnement.ligne.userId}_1`, amount_total: 2900, subscription: "sub_1" }));
    await livrer(session({ id: "cs_c", client_reference_id: `sub_${lesDeux.ligne.userId}_1`, amount_total: 2900, customer: "cus_3", subscription: "sub_3" }));

    const compte = async (id: string | null) => (await testDb.select().from(users).where(eq(users.id, id as string)))[0];
    expect((await compte(seulClient.ligne.userId)).stripeCustomerId).toBeNull();
    expect((await compte(seulClient.ligne.userId)).stripeSubscriptionId).toBeNull();
    expect((await compte(seulAbonnement.ligne.userId)).stripeCustomerId).toBeNull();
    expect((await compte(seulAbonnement.ligne.userId)).stripeSubscriptionId).toBeNull();
    expect((await compte(lesDeux.ligne.userId)).stripeCustomerId).toBe("cus_3");
    expect((await compte(lesDeux.ligne.userId)).stripeSubscriptionId).toBe("sub_3");
  });

  it("signale avec son prestataire, sa référence, son montant et sa raison un paiement dont l'abonnement est introuvable", async () => {
    const signaler = vi.spyOn(paiementNonRapproche, "signalerAbonnementNonRapproche").mockImplementation(() => undefined);

    await livrer(session({ id: "cs_inconnue", client_reference_id: "sub_quelquun_1", amount_total: 2900 }));

    expect(signaler).toHaveBeenCalledWith({ prestataire: "STRIPE", referencePrestataire: "cs_inconnue", montant: 29, raison: "abonnement introuvable pour cette session" });
  });
});

describe("webhook Stripe — renouvellement et prélèvement raté", () => {
  const renouvellement = (extra: Record<string, unknown> = {}) =>
    evenement("invoice.paid", { id: "in_1", billing_reason: "subscription_cycle", currency: "eur", amount_paid: 2900, subscription: "sub_stripe_1", ...extra });

  it("une facture de renouvellement sans abonnement lisible n'appelle rien", async () => {
    const renouveler = vi.spyOn(subscriptionActivation, "renewSubscriptionFromStripeInvoice").mockResolvedValue(null);
    const signaler = vi.spyOn(paiementNonRapproche, "signalerAbonnementNonRapproche").mockImplementation(() => undefined);

    const res = await livrer(renouvellement({ subscription: undefined }));

    expect(res.status).toBe(200);
    expect(renouveler).not.toHaveBeenCalled();
    expect(signaler).not.toHaveBeenCalled();
  });

  it("transmet l'abonnement, la facture, le montant et la devise en majuscules, sans signaler quand le renouvellement est appliqué", async () => {
    const renouveler = vi.spyOn(subscriptionActivation, "renewSubscriptionFromStripeInvoice").mockResolvedValue({ id: "ligne" } as never);
    const signaler = vi.spyOn(paiementNonRapproche, "signalerAbonnementNonRapproche").mockImplementation(() => undefined);

    await livrer(renouvellement());

    expect(renouveler).toHaveBeenCalledWith({ stripeSubscriptionId: "sub_stripe_1", stripeInvoiceId: "in_1", montantPaye: 29, devise: "EUR" });
    expect(signaler).not.toHaveBeenCalled();
  });

  it("signale un renouvellement non appliqué, avec le prestataire, la facture, le montant et la raison", async () => {
    vi.spyOn(subscriptionActivation, "renewSubscriptionFromStripeInvoice").mockResolvedValue(null);
    const signaler = vi.spyOn(paiementNonRapproche, "signalerAbonnementNonRapproche").mockImplementation(() => undefined);

    await livrer(renouvellement());

    expect(signaler).toHaveBeenCalledWith({
      prestataire: "STRIPE",
      referencePrestataire: "in_1",
      montant: 29,
      raison: "renouvellement non appliqué (abonnement introuvable ou montant/devise incohérents)",
    });
  });

  it("transmet à l'agence prévenue du prélèvement raté l'abonnement, la facture, la tentative, le prochain essai, le montant et la devise", async () => {
    const echec = vi.spyOn(echecPrelevement, "signalerEchecPrelevement").mockResolvedValue(undefined as never);
    const objet = { id: "in_2", subscription: "sub_stripe_2", billing_reason: "subscription_cycle", currency: "xof", amount_due: 15000, attempt_count: 2, next_payment_attempt: 1800000000 };

    await livrer(evenement("invoice.payment_failed", objet));
    await livrer(evenement("invoice.payment_failed", { ...objet, id: "in_3", currency: "eur", amount_due: 2900, attempt_count: undefined, next_payment_attempt: null }));
    await livrer(evenement("invoice.payment_failed", { ...objet, id: "in_4", amount_due: undefined }));

    expect(echec).toHaveBeenNthCalledWith(1, {
      stripeSubscriptionId: "sub_stripe_2",
      stripeInvoiceId: "in_2",
      tentative: 2,
      prochainEssai: new Date(1800000000 * 1000),
      montant: 15000,
      devise: "XOF",
    });
    expect(echec).toHaveBeenNthCalledWith(2, { stripeSubscriptionId: "sub_stripe_2", stripeInvoiceId: "in_3", tentative: 1, prochainEssai: null, montant: 29, devise: "EUR" });
    expect(echec).toHaveBeenNthCalledWith(3, expect.objectContaining({ stripeInvoiceId: "in_4", montant: 0 }));
  });
});
