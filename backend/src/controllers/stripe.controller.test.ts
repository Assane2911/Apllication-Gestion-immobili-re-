import crypto from "crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { activityLogs, invoices, platformSubscriptions, users } from "../db/schema";
import * as Sentry from "@sentry/node";
import * as emailService from "../services/email.service";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

// Doit correspondre exactement à STRIPE_WEBHOOK_SECRET forcé dans setupTestDb.ts.
const SECRET_TEST = "whsec_test_do_not_use_in_production";

/** Reproduit la signature que Stripe calcule : HMAC-SHA256 de « t.corps ». */
function signer(corps: string, horodatage = Math.floor(Date.now() / 1000), secret = SECRET_TEST) {
  const signature = crypto.createHmac("sha256", secret).update(`${horodatage}.${corps}`).digest("hex");
  return `t=${horodatage},v1=${signature}`;
}

function evenementSession(overrides: {
  type?: string;
  id?: string;
  reference?: string;
  paymentStatus?: string;
  amountTotal?: number;
  currency?: string;
  customer?: string;
  subscription?: string;
}) {
  return JSON.stringify({
    type: overrides.type ?? "checkout.session.completed",
    data: {
      object: {
        id: overrides.id ?? "cs_test_default",
        payment_status: overrides.paymentStatus ?? "paid",
        amount_total: overrides.amountTotal,
        currency: overrides.currency ?? "eur",
        client_reference_id: overrides.reference ?? "",
        customer: overrides.customer,
        subscription: overrides.subscription,
      },
    },
  });
}

/** Facture Stripe (webhook `invoice.paid`) — un cycle de renouvellement automatique. */
function evenementFacture(overrides: {
  id?: string;
  subscription?: string;
  amountPaid?: number;
  currency?: string;
  billingReason?: string;
}) {
  return JSON.stringify({
    type: "invoice.paid",
    data: {
      object: {
        id: overrides.id ?? "in_test_default",
        subscription: overrides.subscription,
        amount_paid: overrides.amountPaid,
        currency: overrides.currency ?? "eur",
        billing_reason: overrides.billingReason ?? "subscription_cycle",
      },
    },
  });
}

/** Objet "subscription" Stripe supprimé (webhook `customer.subscription.deleted`). */
function evenementAbonnementSupprime(subscriptionId: string) {
  return JSON.stringify({
    type: "customer.subscription.deleted",
    data: { object: { id: subscriptionId } },
  });
}

function envoyer(corps: string, signature: string | null) {
  const requete = request(app)
    .post("/api/payments/stripe/webhook")
    .set("Content-Type", "application/json");
  if (signature) requete.set("stripe-signature", signature);
  return requete.send(corps);
}

describe("POST /api/payments/stripe/webhook", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("n'émet qu'une seule quittance pour une même facture, même sur deux livraisons du même événement", async () => {
    // Stripe rejoue ses webhooks par conception (doute réseau, redémarrage).
    // Ce test verrouille le résultat attendu — une facture réglée, une seule
    // quittance — sur deux livraisons simultanées.
    //
    // Il ne reproduit PAS la course elle-même : la base de test (PGlite,
    // connexion unique) sérialise les deux requêtes, si bien que la seconde
    // voit déjà PAID et s'arrête sur le garde de statut. La vraie protection
    // contre l'entrelacement est la condition de statut portée par le WHERE
    // de l'UPDATE, comme partout ailleurs dans le projet
    // (invoice.controller.ts) — en production, deux instances peuvent lire
    // PENDING toutes les deux avant que l'une n'écrive.
    const envoiEmail = vi.spyOn(emailService, "sendEmail").mockResolvedValue(undefined as never);

    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, {
      status: "PENDING",
      paymentMethod: "STRIPE",
      paymentRef: "cs_test_course",
      amount: 500,
    });

    const corps = evenementSession({ id: "cs_test_course", reference: invoice.id, amountTotal: 50000 });
    const [a, b] = await Promise.all([envoyer(corps, signer(corps)), envoyer(corps, signer(corps))]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(apres.status).toBe("PAID");
    expect(envoiEmail).toHaveBeenCalledTimes(1);
  });

  it("ne solde pas une facture déclarée en virement qui porterait la référence d'une session Stripe", async () => {
    // paymentRef sert à la fois de référence de virement SAISIE PAR LE
    // LOCATAIRE (payInvoice accepte un bankReference libre) et de clé de
    // rapprochement des webhooks, sans contrainte d'unicité. Un locataire
    // pouvait donc déclarer un virement portant l'identifiant de la session
    // Stripe d'une autre de ses factures : la confirmation soldait alors la
    // mauvaise facture — quittance légale émise pour un loyer non réglé,
    // pendant que celle réellement payée restait due.
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    const factureVirement = await createInvoice(contract.id, {
      periodMonth: 5,
      status: "PENDING",
      paymentMethod: "BANK_TRANSFER",
      paymentRef: "cs_test_collision",
      amount: 500,
    });
    const factureStripe = await createInvoice(contract.id, {
      periodMonth: 6,
      status: "PENDING",
      paymentMethod: "STRIPE",
      paymentRef: "cs_test_collision",
      amount: 500,
    });

    const corps = evenementSession({ id: "cs_test_collision", reference: factureStripe.id, amountTotal: 50000 });
    const res = await envoyer(corps, signer(corps));
    expect(res.status).toBe(200);

    const [stripeApres] = await testDb.select().from(invoices).where(eq(invoices.id, factureStripe.id));
    const [virementApres] = await testDb.select().from(invoices).where(eq(invoices.id, factureVirement.id));
    expect(stripeApres.status).toBe("PAID");
    expect(virementApres.status).toBe("PENDING");
  });

  it("confirme une facture réglée et déclenche la quittance", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, {
      status: "PENDING",
      paymentMethod: "STRIPE",
      paymentRef: "cs_test_facture",
      amount: 500,
    });

    // 500 EUR confirmés par Stripe arrivent en centimes : 50000.
    const corps = evenementSession({ id: "cs_test_facture", reference: invoice.id, amountTotal: 50000 });
    const res = await envoyer(corps, signer(corps));

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(apres.status).toBe("PAID");
    expect(apres.paidAt).not.toBeNull();
  });

  it("rejette (401) une signature invalide, et ne touche à rien", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, {
      status: "PENDING",
      paymentMethod: "STRIPE",
      paymentRef: "cs_test_faux",
      amount: 500,
    });

    const corps = evenementSession({ id: "cs_test_faux", reference: invoice.id, amountTotal: 50000 });
    // Signature calculée avec un autre secret : c'est exactement ce que
    // produirait quelqu'un qui appellerait l'URL sans connaître le nôtre.
    const res = await envoyer(corps, signer(corps, Math.floor(Date.now() / 1000), "whsec_mauvais_secret"));

    expect(res.status).toBe(401);
    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(apres.status).toBe("PENDING");
  });

  it("rejette (401) un événement authentique mais trop ancien (rejeu)", async () => {
    // Sans fenêtre temporelle, une requête authentique interceptée pourrait
    // être renvoyée des mois plus tard pour solder une facture à nouveau.
    const corps = evenementSession({ id: "cs_test_vieux", reference: "peu-importe", amountTotal: 100 });
    const horodatageAncien = Math.floor(Date.now() / 1000) - 3600;

    const res = await envoyer(corps, signer(corps, horodatageAncien));

    expect(res.status).toBe(401);
  });

  it("rejette (401) une requête sans en-tête de signature", async () => {
    const corps = evenementSession({ id: "cs_test_sans_signature" });
    const res = await envoyer(corps, null);
    expect(res.status).toBe(401);
  });

  it("ne solde pas une facture si le montant confirmé diffère du montant attendu", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, {
      status: "PENDING",
      paymentMethod: "STRIPE",
      paymentRef: "cs_test_montant",
      amount: 500,
    });

    // 5 EUR réglés pour une facture de 500 EUR.
    const corps = evenementSession({ id: "cs_test_montant", reference: invoice.id, amountTotal: 500 });
    const res = await envoyer(corps, signer(corps));

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(apres.status).toBe("PENDING");
  });

  it("ignore une session complétée mais non réglée", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, {
      status: "PENDING",
      paymentMethod: "STRIPE",
      paymentRef: "cs_test_impaye",
      amount: 500,
    });

    const corps = evenementSession({
      id: "cs_test_impaye",
      reference: invoice.id,
      amountTotal: 50000,
      paymentStatus: "unpaid",
    });
    const res = await envoyer(corps, signer(corps));

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(apres.status).toBe("PENDING");
  });

  it("répond 200 sans rien faire aux types d'événements qui ne nous concernent pas", async () => {
    // Stripe rejouerait indéfiniment tout événement non acquitté.
    const corps = evenementSession({ type: "payment_intent.created", id: "cs_test_autre" });
    const res = await envoyer(corps, signer(corps));
    expect(res.status).toBe(200);
  });

  it("active réellement l'abonnement du gestionnaire, et pas seulement l'historique", async () => {
    const manager = await createManager({ subscriptionStatus: "EXPIRED" });
    const [abonnement] = await testDb
      .insert(platformSubscriptions)
      .values({
        userId: manager.id,
        plan: "PRO",
        amount: 29,
        currency: "EUR",
        status: "PENDING",
        paymentMethod: "STRIPE",
        paymentRef: "cs_test_abo",
        startDate: new Date(2026, 8, 1),
        endDate: new Date(2026, 9, 1),
      })
      .returning();

    const corps = evenementSession({
      id: "cs_test_abo",
      reference: `sub_${manager.id}_123`,
      amountTotal: 2900,
    });
    const res = await envoyer(corps, signer(corps));

    expect(res.status).toBe(200);
    const [apres] = await testDb
      .select()
      .from(platformSubscriptions)
      .where(eq(platformSubscriptions.id, abonnement.id));
    expect(apres.status).toBe("PAID");

    const [compte] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(compte.subscriptionStatus).toBe("ACTIVE");
  });

  it("signale à Sentry un paiement d'abonnement encaissé qu'on ne peut pas appliquer, sans activer l'accès", async () => {
    const signal = vi.spyOn(Sentry, "captureMessage");
    const manager = await createManager({ subscriptionStatus: "EXPIRED" });
    const [abonnement] = await testDb
      .insert(platformSubscriptions)
      .values({
        userId: manager.id,
        plan: "PRO",
        amount: 29,
        currency: "EUR",
        status: "PENDING",
        paymentMethod: "STRIPE",
        paymentRef: "cs_test_abo_montant",
        startDate: new Date(2026, 8, 1),
        endDate: new Date(2026, 9, 1),
      })
      .returning();

    // 5 EUR encaissés pour un abonnement à 29 EUR.
    const corps = evenementSession({ id: "cs_test_abo_montant", reference: `sub_${manager.id}_123`, amountTotal: 500 });
    const res = await envoyer(corps, signer(corps));

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(platformSubscriptions).where(eq(platformSubscriptions.id, abonnement.id));
    expect(apres.status).toBe("PENDING");
    expect(signal).toHaveBeenCalledTimes(1);
    expect(signal.mock.calls[0][0]).toContain("abonnement");
    expect(signal.mock.calls[0][1]).toMatchObject({ extra: { referencePrestataire: "cs_test_abo_montant" } });
  });

  it("est idempotent : un même événement rejoué ne change rien la seconde fois", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, {
      status: "PENDING",
      paymentMethod: "STRIPE",
      paymentRef: "cs_test_idem",
      amount: 500,
    });

    const corps = evenementSession({ id: "cs_test_idem", reference: invoice.id, amountTotal: 50000 });
    await envoyer(corps, signer(corps));
    const [premier] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));

    await envoyer(corps, signer(corps));
    const [second] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));

    expect(second.status).toBe("PAID");
    expect(second.paidAt?.getTime()).toBe(premier.paidAt?.getTime());
  });

  /**
   * Régression : seul le cas PAID était traité en no-op ci-dessus — une
   * facture CANCELLED tombait dans le `else` suivant et repassait PAID sur
   * une confirmation de paiement arrivée en retard (contrat résilié pendant
   * qu'un paiement Stripe était en cours) ou un simple rejeu du webhook.
   */
  it("ne ressuscite pas une facture annulée sur une confirmation de paiement tardive", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, {
      status: "CANCELLED",
      paymentMethod: "STRIPE",
      paymentRef: "cs_test_annulee",
      amount: 500,
    });

    const corps = evenementSession({ id: "cs_test_annulee", reference: invoice.id, amountTotal: 50000 });
    const res = await envoyer(corps, signer(corps));

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(apres.status).toBe("CANCELLED");
    expect(apres.paidAt).toBeNull();
  });

  /**
   * Un paiement par carte que Stripe a bien encaissé mais que la facture ne peut plus recevoir (réglée en partie
   * ou en entier entre-temps par le gestionnaire, annulée, ou session remplacée) ne doit jamais disparaître en
   * silence : la facture reste intacte, et le gestionnaire est prévenu pour rembourser ou régulariser.
   */
  describe("paiement encaissé mais non rapprochable", () => {
    async function factureStripe(overrides: Partial<typeof invoices.$inferInsert> = {}) {
      const manager = await createManager();
      const property = await createProperty(manager.id);
      const tenant = await createTenant(manager.id);
      const contract = await createContract(property.id, tenant.id);
      const invoice = await createInvoice(contract.id, {
        status: "PENDING",
        paymentMethod: "STRIPE",
        paymentRef: "cs_test_orphelin",
        amount: 500,
        ...overrides,
      });
      return { manager, invoice };
    }
    const journal = (managerId: string) =>
      testDb.select().from(activityLogs).where(eq(activityLogs.managerId, managerId));

    it("prévient le gestionnaire quand le reste dû a baissé pendant que le locataire payait", async () => {
      const envoiEmail = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false } as never);
      // 200 déjà encaissés par le gestionnaire : le reste dû n'est plus 500 mais 300, et le locataire vient de payer 500.
      const { manager, invoice } = await factureStripe({ amountPaid: 200 });

      const corps = evenementSession({ id: "cs_test_orphelin", reference: invoice.id, amountTotal: 50000 });
      const res = await envoyer(corps, signer(corps));

      expect(res.status).toBe(200);
      const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
      expect(apres.status).toBe("PENDING");
      expect(apres.amountPaid).toBe(200);
      expect(envoiEmail).toHaveBeenCalledTimes(1);
      expect(envoiEmail.mock.calls[0][0]).toBe(manager.email);
      expect(envoiEmail.mock.calls[0][2]).toContain("cs_test_orphelin");
      const entrees = await journal(manager.id);
      expect(entrees.map((e: { action: string }) => e.action)).toContain("paiement_en_ligne.non_rapproche");
    });

    it("prévient aussi pour une facture annulée, et pour une session qui n'est plus celle de la facture", async () => {
      const envoiEmail = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false } as never);
      const annulee = await factureStripe({ status: "CANCELLED" });
      const corpsAnnulee = evenementSession({ id: "cs_test_orphelin", reference: annulee.invoice.id, amountTotal: 50000 });
      await envoyer(corpsAnnulee, signer(corpsAnnulee));

      // Facture réglée à la main entre-temps : sa référence de paiement n'est plus la session Stripe.
      const reglee = await factureStripe({ status: "PAID", paymentMethod: "CASH", paymentRef: "manuel_1", amountPaid: 500 });
      const corpsReglee = evenementSession({ id: "cs_test_double", reference: reglee.invoice.id, amountTotal: 50000 });
      await envoyer(corpsReglee, signer(corpsReglee));

      expect(envoiEmail).toHaveBeenCalledTimes(2);
      expect(envoiEmail.mock.calls.map((c) => c[0])).toEqual([annulee.manager.email, reglee.manager.email]);
    });

    it("ne prévient pas deux fois pour le même paiement rejoué, et jamais pour un rejeu d'un paiement bien rapproché", async () => {
      const envoiEmail = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false } as never);
      const orphelin = await factureStripe({ amountPaid: 200 });
      const corps = evenementSession({ id: "cs_test_orphelin", reference: orphelin.invoice.id, amountTotal: 50000 });
      await envoyer(corps, signer(corps));
      await envoyer(corps, signer(corps));
      expect(envoiEmail).toHaveBeenCalledTimes(1);

      // Paiement normal, rejoué : la facture est déjà soldée par cette session, rien à signaler.
      envoiEmail.mockClear();
      const normale = await factureStripe({ paymentRef: "cs_test_normal" });
      const corpsNormal = evenementSession({ id: "cs_test_normal", reference: normale.invoice.id, amountTotal: 50000 });
      await envoyer(corpsNormal, signer(corpsNormal));
      envoiEmail.mockClear();
      await envoyer(corpsNormal, signer(corpsNormal));
      expect(envoiEmail).not.toHaveBeenCalled();
      expect(await journal(normale.manager.id)).toHaveLength(0);
    });
  });

  /**
   * Échec de prélèvement d'un renouvellement par carte (`invoice.payment_failed`) : sans cela, le gestionnaire
   * ne l'apprenait qu'à l'expiration de son accès, sans rien avoir pu corriger.
   */
  describe("échec de prélèvement d'un renouvellement", () => {
    function evenementEchec(overrides: { id?: string; subscription?: string; attemptCount?: number; nextAttempt?: number | null; billingReason?: string }) {
      return JSON.stringify({
        type: "invoice.payment_failed",
        data: {
          object: {
            id: overrides.id ?? "in_echec_1",
            subscription: overrides.subscription ?? "sub_stripe_echec",
            billing_reason: overrides.billingReason ?? "subscription_cycle",
            attempt_count: overrides.attemptCount ?? 1,
            next_payment_attempt: overrides.nextAttempt === undefined ? Math.floor(Date.UTC(2026, 9, 23, 12) / 1000) : overrides.nextAttempt,
            amount_due: 2900,
            currency: "eur",
          },
        },
      });
    }
    const livrer = (corps: string) => envoyer(corps, signer(corps));

    it("prévient le gestionnaire par email : la date du nouvel essai et le lien pour renouveler", async () => {
      const envoiEmail = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false } as never);
      const manager = await createManager({ stripeSubscriptionId: "sub_stripe_echec", subscriptionStatus: "ACTIVE" });

      const res = await livrer(evenementEchec({}));

      expect(res.status).toBe(200);
      expect(envoiEmail).toHaveBeenCalledTimes(1);
      const [destinataire, sujet, html] = envoiEmail.mock.calls[0];
      expect(destinataire).toBe(manager.email);
      expect(sujet).toContain("prélèvement");
      expect(html).toContain("23 octobre 2026");
      expect(html).toContain("/subscription");
      expect(html).not.toMatch(/\btu\b|\bton\b|\bta\b/i);
      const entrees = await testDb.select().from(activityLogs).where(eq(activityLogs.managerId, manager.id));
      expect(entrees.map((e: { action: string }) => e.action)).toEqual(["abonnement.prelevement_echoue"]);
      // L'accès n'est pas touché : Stripe réessaie, et la fin d'accès reste déterminée par subscriptionEndsAt.
      const [compte] = await testDb.select().from(users).where(eq(users.id, manager.id));
      expect(compte.subscriptionStatus).toBe("ACTIVE");
    });

    it("dit qu'aucun nouvel essai n'aura lieu quand c'était le dernier", async () => {
      const envoiEmail = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false } as never);
      await createManager({ stripeSubscriptionId: "sub_stripe_echec" });

      await livrer(evenementEchec({ attemptCount: 4, nextAttempt: null }));

      expect(envoiEmail).toHaveBeenCalledTimes(1);
      expect(envoiEmail.mock.calls[0][2]).toContain("aucun nouvel essai");
    });

    it("ne prévient qu'une fois par tentative : un rejeu ne renvoie rien, une nouvelle tentative oui", async () => {
      const envoiEmail = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false } as never);
      await createManager({ stripeSubscriptionId: "sub_stripe_echec" });

      await livrer(evenementEchec({ attemptCount: 1 }));
      await livrer(evenementEchec({ attemptCount: 1 }));
      expect(envoiEmail).toHaveBeenCalledTimes(1);

      await livrer(evenementEchec({ attemptCount: 2 }));
      expect(envoiEmail).toHaveBeenCalledTimes(2);
    });

    it("ignore une facture qui n'est pas un renouvellement, et un abonnement inconnu", async () => {
      const envoiEmail = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false } as never);
      await createManager({ stripeSubscriptionId: "sub_stripe_echec" });

      const premiere = await livrer(evenementEchec({ billingReason: "subscription_create" }));
      const inconnu = await livrer(evenementEchec({ subscription: "sub_inconnu" }));

      expect(premiere.status).toBe(200);
      expect(inconnu.status).toBe(200);
      expect(envoiEmail).not.toHaveBeenCalled();
    });
  });

  /**
   * Renouvellement automatique réel (Stripe Subscriptions) : la session créée
   * en mode "subscription" (autoRenew, voir payment.service.ts) renvoie un
   * Customer et une Subscription Stripe, rattachés au compte à l'activation.
   */
  it("rattache le Customer et la Subscription Stripe au compte lors de l'activation initiale", async () => {
    const manager = await createManager({ subscriptionStatus: "EXPIRED" });
    await testDb.insert(platformSubscriptions).values({
      userId: manager.id,
      plan: "PRO",
      amount: 29,
      currency: "EUR",
      status: "PENDING",
      paymentMethod: "STRIPE",
      paymentRef: "cs_test_abo_recurrent",
      startDate: new Date(2026, 8, 1),
      endDate: new Date(2026, 9, 1),
    });

    const corps = evenementSession({
      id: "cs_test_abo_recurrent",
      reference: `sub_${manager.id}_123`,
      amountTotal: 2900,
      customer: "cus_test_123",
      subscription: "sub_stripe_test_123",
    });
    const res = await envoyer(corps, signer(corps));

    expect(res.status).toBe(200);
    const [compte] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(compte.subscriptionStatus).toBe("ACTIVE");
    expect(compte.stripeCustomerId).toBe("cus_test_123");
    expect(compte.stripeSubscriptionId).toBe("sub_stripe_test_123");
  });

  describe("invoice.paid — renouvellement automatique d'un cycle suivant", () => {
    beforeEach(() => {
      // calculerPeriode (subscriptionPeriod.service.ts) démarre la nouvelle période
      // sur `finActuelle` UNIQUEMENT si elle est encore dans le futur par rapport à
      // `new Date()` réel ; ces fixtures fixent `subscriptionEndsAt` au 1er septembre
      // 2026 en supposant que "maintenant" le précède encore. Sans horloge figée, le
      // test casse dès que la date réelle d'exécution dépasse le 1er septembre 2026.
      vi.setSystemTime(new Date(2026, 7, 15));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("prolonge l'abonnement et enregistre une nouvelle ligne payée", async () => {
      const manager = await createManager({
        subscriptionStatus: "ACTIVE",
        subscriptionPlan: "PRO",
        subscriptionEndsAt: new Date(2026, 8, 1),
        stripeSubscriptionId: "sub_stripe_renouv",
      });
      await testDb.insert(platformSubscriptions).values({
        userId: manager.id,
        plan: "PRO",
        amount: 29,
        currency: "EUR",
        status: "PAID",
        paymentMethod: "STRIPE",
        paymentRef: "cs_test_premier_cycle",
        startDate: new Date(2026, 7, 1),
        endDate: new Date(2026, 8, 1),
      });

      const corps = evenementFacture({
        id: "in_test_renouv",
        subscription: "sub_stripe_renouv",
        amountPaid: 2900,
      });
      const res = await envoyer(corps, signer(corps));

      expect(res.status).toBe(200);
      const [compte] = await testDb.select().from(users).where(eq(users.id, manager.id));
      expect(compte.subscriptionStatus).toBe("ACTIVE");
      // Prolongé d'un mois au-delà de la fin déjà payée (1er septembre → 1er octobre 2026).
      expect(compte.subscriptionEndsAt?.getFullYear()).toBe(2026);
      expect(compte.subscriptionEndsAt?.getMonth()).toBe(9);

      const nouvellesLignes = await testDb
        .select()
        .from(platformSubscriptions)
        .where(eq(platformSubscriptions.paymentRef, "in_test_renouv"));
      expect(nouvellesLignes).toHaveLength(1);
      expect(nouvellesLignes[0].status).toBe("PAID");
    });

    it("est idempotent : la même facture rejouée ne prolonge pas deux fois", async () => {
      const manager = await createManager({
        subscriptionStatus: "ACTIVE",
        subscriptionPlan: "PRO",
        subscriptionEndsAt: new Date(2026, 8, 1),
        stripeSubscriptionId: "sub_stripe_idem",
      });
      await testDb.insert(platformSubscriptions).values({
        userId: manager.id,
        plan: "PRO",
        amount: 29,
        currency: "EUR",
        status: "PAID",
        paymentMethod: "STRIPE",
        paymentRef: "cs_test_premier_cycle_idem",
        startDate: new Date(2026, 7, 1),
        endDate: new Date(2026, 8, 1),
      });

      const corps = evenementFacture({ id: "in_test_idem", subscription: "sub_stripe_idem", amountPaid: 2900 });
      await envoyer(corps, signer(corps));
      const [premier] = await testDb.select().from(users).where(eq(users.id, manager.id));

      await envoyer(corps, signer(corps));
      const [second] = await testDb.select().from(users).where(eq(users.id, manager.id));

      expect(second.subscriptionEndsAt?.getTime()).toBe(premier.subscriptionEndsAt?.getTime());
      const lignes = await testDb
        .select()
        .from(platformSubscriptions)
        .where(eq(platformSubscriptions.paymentRef, "in_test_idem"));
      expect(lignes).toHaveLength(1);
    });

    it("ne prolonge pas l'abonnement si le montant confirmé diffère du montant habituellement payé", async () => {
      const manager = await createManager({
        subscriptionStatus: "ACTIVE",
        subscriptionPlan: "PRO",
        subscriptionEndsAt: new Date(2026, 8, 1),
        stripeSubscriptionId: "sub_stripe_montant_faux",
      });
      await testDb.insert(platformSubscriptions).values({
        userId: manager.id,
        plan: "PRO",
        amount: 29,
        currency: "EUR",
        status: "PAID",
        paymentMethod: "STRIPE",
        paymentRef: "cs_test_premier_cycle_montant",
        startDate: new Date(2026, 7, 1),
        endDate: new Date(2026, 8, 1),
      });

      // 5 EUR confirmés au lieu des 29 EUR habituels.
      const corps = evenementFacture({ id: "in_test_montant_faux", subscription: "sub_stripe_montant_faux", amountPaid: 500 });
      const res = await envoyer(corps, signer(corps));

      expect(res.status).toBe(200);
      const [compte] = await testDb.select().from(users).where(eq(users.id, manager.id));
      expect(compte.subscriptionEndsAt?.getTime()).toBe(new Date(2026, 8, 1).getTime());
    });

    it("ignore la toute première facture d'un abonnement (déjà activée via checkout.session.completed)", async () => {
      const manager = await createManager({
        subscriptionStatus: "ACTIVE",
        subscriptionEndsAt: new Date(2026, 8, 1),
        stripeSubscriptionId: "sub_stripe_premiere",
      });

      const corps = evenementFacture({
        id: "in_test_premiere",
        subscription: "sub_stripe_premiere",
        amountPaid: 2900,
        billingReason: "subscription_create",
      });
      const res = await envoyer(corps, signer(corps));

      expect(res.status).toBe(200);
      const lignes = await testDb
        .select()
        .from(platformSubscriptions)
        .where(eq(platformSubscriptions.paymentRef, "in_test_premiere"));
      expect(lignes).toHaveLength(0);
    });
  });

  describe("customer.subscription.deleted", () => {
    it("efface la référence à l'abonnement Stripe, sans toucher au statut d'accès", async () => {
      const finPayee = new Date(2026, 8, 1);
      const manager = await createManager({
        subscriptionStatus: "CANCELLED",
        subscriptionEndsAt: finPayee,
        stripeCustomerId: "cus_test_conserve",
        stripeSubscriptionId: "sub_stripe_a_effacer",
      });

      const res = await envoyer(
        evenementAbonnementSupprime("sub_stripe_a_effacer"),
        signer(evenementAbonnementSupprime("sub_stripe_a_effacer"))
      );

      expect(res.status).toBe(200);
      const [compte] = await testDb.select().from(users).where(eq(users.id, manager.id));
      expect(compte.stripeSubscriptionId).toBeNull();
      // Le Customer Stripe reste réutilisable pour un futur réabonnement.
      expect(compte.stripeCustomerId).toBe("cus_test_conserve");
      // subscriptionStatus/subscriptionEndsAt ne sont jamais touchés par cet
      // événement : c'est déjà subscriptionEndsAt qui détermine l'accès.
      expect(compte.subscriptionStatus).toBe("CANCELLED");
      expect(compte.subscriptionEndsAt?.getTime()).toBe(finPayee.getTime());
    });
  });
});
