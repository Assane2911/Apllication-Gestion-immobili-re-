import { env } from "../config/env";

export type PaymentMethodKey = "STRIPE" | "MOBILE_MONEY" | "BANK_TRANSFER" | "DEMO";

export interface PaymentIntentResult {
  method: PaymentMethodKey;
  status: "REQUIRES_ACTION" | "PENDING_VALIDATION" | "PAID";
  reference: string;
  redirectUrl?: string;
  message: string;
}

/**
 * Point d'entrée unique pour initier un paiement de loyer, quel que soit le
 * moyen choisi par le locataire. Chaque prestataire (Stripe, Mobile Money)
 * est isolé dans sa propre fonction afin de pouvoir être branché sur une
 * vraie API sans toucher au reste de l'application.
 *
 * Tant que les clés d'API réelles ne sont pas configurées (ou que
 * PAYMENTS_DEMO_MODE=true), chaque méthode retombe sur une simulation
 * fonctionnelle qui permet de tester tout le flux de bout en bout.
 */
export async function initiatePayment(params: {
  method: PaymentMethodKey;
  amount: number;
  invoiceId: string;
  payerEmail: string;
  bankReference?: string;
}): Promise<PaymentIntentResult> {
  const { method, amount, invoiceId, payerEmail, bankReference } = params;

  switch (method) {
    case "STRIPE":
      return initiateStripePayment(amount, invoiceId, payerEmail);
    case "MOBILE_MONEY":
      return initiateMobileMoneyPayment(amount, invoiceId, payerEmail);
    case "BANK_TRANSFER":
      return initiateBankTransferDeclaration(amount, invoiceId, bankReference);
    case "DEMO":
    default:
      return initiateDemoPayment(amount, invoiceId);
  }
}

async function initiateStripePayment(amount: number, invoiceId: string, payerEmail: string): Promise<PaymentIntentResult> {
  if (!env.payments.stripeSecretKey || env.payments.demoMode) {
    return simulatedResult("STRIPE", invoiceId, "Stripe non configuré — paiement simulé (mode démo).");
  }
  // Intégration réelle: utiliser le SDK `stripe` avec env.payments.stripeSecretKey
  // pour créer une Checkout Session, puis retourner son URL.
  // const stripe = new Stripe(env.payments.stripeSecretKey);
  // const session = await stripe.checkout.sessions.create({ ... amount, customer_email: payerEmail ... });
  return {
    method: "STRIPE",
    status: "REQUIRES_ACTION",
    reference: `stripe_${invoiceId}`,
    redirectUrl: "#stripe-checkout-a-brancher",
    message: `Redirection vers Stripe Checkout pour ${amount} (${payerEmail}).`,
  };
}

async function initiateMobileMoneyPayment(amount: number, invoiceId: string, payerEmail: string): Promise<PaymentIntentResult> {
  if (!env.payments.mobileMoney.apiKey || env.payments.demoMode) {
    return simulatedResult("MOBILE_MONEY", invoiceId, "Mobile Money non configuré — paiement simulé (mode démo).");
  }
  // Intégration réelle: appeler l'API Orange Money / MTN MoMo avec
  // env.payments.mobileMoney.baseUrl / apiKey / apiSecret pour déclencher
  // une demande de paiement (push USSD) vers le numéro du locataire.
  return {
    method: "MOBILE_MONEY",
    status: "PENDING_VALIDATION",
    reference: `momo_${invoiceId}`,
    message: `Demande de paiement Mobile Money envoyée pour ${amount} à ${payerEmail}.`,
  };
}

async function initiateBankTransferDeclaration(
  amount: number,
  invoiceId: string,
  bankReference?: string
): Promise<PaymentIntentResult> {
  return {
    method: "BANK_TRANSFER",
    status: "PENDING_VALIDATION",
    reference: bankReference || `virement_${invoiceId}`,
    message: `Virement de ${amount} déclaré, en attente de validation par le gestionnaire.`,
  };
}

async function initiateDemoPayment(amount: number, invoiceId: string): Promise<PaymentIntentResult> {
  return simulatedResult("DEMO", invoiceId, `Paiement démo de ${amount} confirmé instantanément.`);
}

function simulatedResult(method: PaymentMethodKey, invoiceId: string, message: string): PaymentIntentResult {
  return {
    method,
    status: "PAID",
    reference: `demo_${method.toLowerCase()}_${invoiceId}_${Date.now()}`,
    message,
  };
}
