import { env } from "../config/env";
import { ApiError } from "../utils/asyncHandler";

export type PaymentMethodKey = "STRIPE" | "PAYDUNYA" | "BANK_TRANSFER" | "DEMO";

export interface PaymentIntentResult {
  method: PaymentMethodKey;
  status: "REQUIRES_ACTION" | "PENDING_VALIDATION" | "PAID";
  reference: string;
  redirectUrl?: string;
  message: string;
}

/**
 * Point d'entrée unique pour initier un paiement (loyer OU abonnement SaaS),
 * quel que soit le moyen choisi. Chaque prestataire (Stripe, PayDunya) est
 * isolé dans sa propre fonction afin de pouvoir être branché sur une vraie
 * API sans toucher au reste de l'application.
 *
 * Tant que les clés d'API réelles ne sont pas configurées (ou que
 * PAYMENTS_DEMO_MODE=true), chaque méthode retombe sur une simulation
 * fonctionnelle qui permet de tester tout le flux de bout en bout.
 *
 * `reference` sert à la fois de libellé (loyer: l'id de la facture,
 * abonnement: `sub_<userId>_<timestamp>`, voir subscription.controller.ts)
 * et de clé de routage pour le webhook IPN de PayDunya (paydunya.controller.ts
 * distingue facture / abonnement selon le préfixe `sub_`).
 */
export async function initiatePayment(params: {
  method: PaymentMethodKey;
  amount: number;
  invoiceId: string;
  payerEmail: string;
  bankReference?: string;
  /** Chemin du frontend vers lequel rediriger une fois le paiement terminé (ex: "/portail/paiements"). */
  returnPath?: string;
}): Promise<PaymentIntentResult> {
  const { method, amount, invoiceId: reference, payerEmail, bankReference, returnPath } = params;

  switch (method) {
    case "STRIPE":
      return initiateStripePayment(amount, reference, payerEmail);
    case "PAYDUNYA":
      return initiatePaydunyaPayment(amount, reference, payerEmail, returnPath);
    case "BANK_TRANSFER":
      return initiateBankTransferDeclaration(amount, reference, bankReference);
    case "DEMO":
    default:
      return initiateDemoPayment(amount, reference);
  }
}

async function initiateStripePayment(amount: number, reference: string, payerEmail: string): Promise<PaymentIntentResult> {
  if (!env.payments.stripeSecretKey || env.payments.demoMode) {
    return simulatedResult("STRIPE", reference, "Stripe non configuré — paiement simulé (mode démo).");
  }
  // Intégration réelle: utiliser le SDK `stripe` avec env.payments.stripeSecretKey
  // pour créer une Checkout Session, puis retourner son URL.
  // const stripe = new Stripe(env.payments.stripeSecretKey);
  // const session = await stripe.checkout.sessions.create({ ... amount, customer_email: payerEmail ... });
  return {
    method: "STRIPE",
    status: "REQUIRES_ACTION",
    reference: `stripe_${reference}`,
    redirectUrl: "#stripe-checkout-a-brancher",
    message: `Redirection vers Stripe Checkout pour ${amount} (${payerEmail}).`,
  };
}

/**
 * PayDunya (https://paydunya.com) : agrégateur ouest-africain qui donne accès
 * à Orange Money, Wave, Free Money, MTN Money et carte bancaire derrière une
 * seule page de paiement hébergée. Voir https://developers.paydunya.com/doc/EN/http_json.
 *
 * Flux réel (une fois les clés configurées) :
 *  1. On crée une "checkout invoice" via l'API PayDunya → elle renvoie une
 *     URL de paiement hébergée (`response_text`) et un `token`.
 *  2. On redirige le locataire/gestionnaire vers cette URL (status
 *     REQUIRES_ACTION) — la facture reste PENDING dans notre base.
 *  3. PayDunya confirme (ou non) le paiement de façon asynchrone en appelant
 *     notre webhook `POST /api/payments/paydunya/ipn` (voir
 *     controllers/paydunya.controller.ts), qui passe la facture à PAID.
 *
 * Tant qu'aucune clé n'est configurée (ou PAYMENTS_DEMO_MODE=true), on
 * retombe sur une simulation instantanée comme les autres moyens de
 * paiement, pour permettre de tester tout le flux sans compte PayDunya.
 */
async function initiatePaydunyaPayment(
  amount: number,
  reference: string,
  payerEmail: string,
  returnPath?: string
): Promise<PaymentIntentResult> {
  const { masterKey, privateKey, token, mode, storeName } = env.payments.paydunya;

  if (!masterKey || !privateKey || !token || env.payments.demoMode) {
    return simulatedResult("PAYDUNYA", reference, "PayDunya non configuré — paiement simulé (mode démo).");
  }

  const baseUrl =
    mode === "live" ? "https://app.paydunya.com/api/v1" : "https://app.paydunya.com/sandbox-api/v1";

  const callbackUrl = `${env.publicBackendUrl}/api/payments/paydunya/ipn`;
  const redirectBase = `${env.frontendUrl}${returnPath ?? "/"}`;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/checkout-invoice/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PAYDUNYA-MASTER-KEY": masterKey,
        "PAYDUNYA-PRIVATE-KEY": privateKey,
        "PAYDUNYA-TOKEN": token,
      },
      body: JSON.stringify({
        invoice: {
          total_amount: Math.round(amount),
          description: `Paiement ${reference} — ${storeName}`,
        },
        store: { name: storeName },
        customer: { email: payerEmail },
        custom_data: { reference },
        actions: {
          callback_url: callbackUrl,
          return_url: `${redirectBase}?paydunya=succes`,
          cancel_url: `${redirectBase}?paydunya=annule`,
        },
      }),
    });
  } catch (err) {
    console.error("[paydunya] Échec réseau lors de la création de la facture:", err);
    throw new ApiError(502, "Impossible de contacter PayDunya pour le moment. Réessayez plus tard.");
  }

  const data = (await response.json()) as {
    response_code?: string;
    response_text?: string;
    token?: string;
  };

  if (!response.ok || data.response_code !== "00" || !data.token || !data.response_text) {
    console.error("[paydunya] Réponse inattendue lors de la création de la facture:", data);
    throw new ApiError(502, data.response_text || "Échec de l'initialisation du paiement PayDunya.");
  }

  return {
    method: "PAYDUNYA",
    status: "REQUIRES_ACTION",
    reference: data.token,
    redirectUrl: data.response_text,
    message: "Redirection vers PayDunya pour finaliser le paiement.",
  };
}

async function initiateBankTransferDeclaration(
  amount: number,
  reference: string,
  bankReference?: string
): Promise<PaymentIntentResult> {
  return {
    method: "BANK_TRANSFER",
    status: "PENDING_VALIDATION",
    reference: bankReference || `virement_${reference}`,
    message: `Virement de ${amount} déclaré, en attente de validation par le gestionnaire.`,
  };
}

async function initiateDemoPayment(amount: number, reference: string): Promise<PaymentIntentResult> {
  return simulatedResult("DEMO", reference, `Paiement démo de ${amount} confirmé instantanément.`);
}

function simulatedResult(method: PaymentMethodKey, reference: string, message: string): PaymentIntentResult {
  return {
    method,
    status: "PAID",
    reference: `demo_${method.toLowerCase()}_${reference}_${Date.now()}`,
    message,
  };
}
