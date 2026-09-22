import crypto from "crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { invoices, platformSubscriptions, users } from "../db/schema";
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
      },
    },
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
});
