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
  /**
   * Devise du montant, en code ISO ("EUR", "XOF"). Obligatoire, et non
   * optionnelle avec une valeur par défaut : un montant sans devise n'a aucun
   * sens dès lors qu'un prestataire encaisse dans la sienne, et un défaut
   * silencieux reproduirait exactement le défaut que ce paramètre corrige.
   * La rendre obligatoire force chaque appelant à dire ce qu'il facture.
   */
  currency: string;
  invoiceId: string;
  payerEmail: string;
  bankReference?: string;
  /** Chemin du frontend vers lequel rediriger une fois le paiement terminé (ex: "/portail/paiements"). */
  returnPath?: string;
}): Promise<PaymentIntentResult> {
  const { method, amount, currency, invoiceId: reference, payerEmail, bankReference, returnPath } = params;

  // Porte unique : le refus est décidé AVANT tout appel réseau, par la même
  // règle que celle consultée par l'interface.
  const refus = indisponibilite(method, currency);
  if (refus) {
    console.error(`[paiement] ${method} refusé : ${refus.cause}.`);
    throw new ApiError(refus.status, refus.message);
  }

  switch (method) {
    case "STRIPE":
      return initiateStripePayment(amount, currency, reference, payerEmail, returnPath);
    case "PAYDUNYA":
      return initiatePaydunyaPayment(amount, currency, reference, payerEmail, returnPath);
    case "BANK_TRANSFER":
      return initiateBankTransferDeclaration(amount, currency, reference, bankReference);
    case "DEMO":
    default:
      return initiateDemoPayment(amount, currency, reference);
  }
}

/**
 * Devises dont l'unité n'a pas de sous-division : un "franc CFA" ne se divise
 * pas en centimes. Stripe attend TOUJOURS un entier dans la plus petite unité
 * de la devise — 2900 pour 29,00 EUR, mais 15000 pour 15 000 XOF. Multiplier
 * par 100 sans distinction facturerait cent fois le prix sur ces devises-là,
 * exactement l'erreur d'un facteur 100 déjà rencontrée dans l'autre sens avec
 * PayDunya.
 *
 * Liste des devises sans décimale prises en charge par Stripe.
 */
const DEVISES_SANS_DECIMALE = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA",
  "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

/** Convertit un montant lisible (29, 15000) vers la plus petite unité Stripe. */
export function versPlusPetiteUnite(amount: number, currency: string): number {
  if (DEVISES_SANS_DECIMALE.has(currency.toUpperCase())) return Math.round(amount);
  return Math.round(amount * 100);
}

/** Opération inverse, pour relire un montant confirmé par Stripe. */
export function depuisPlusPetiteUnite(amount: number, currency: string): number {
  if (DEVISES_SANS_DECIMALE.has(currency.toUpperCase())) return amount;
  return amount / 100;
}

const MESSAGE_NEUTRE =
  "Ce moyen de paiement est momentanément indisponible. Merci d'en choisir un autre ou de réessayer plus tard.";

export interface Indisponibilite {
  /** Code HTTP à renvoyer si quelqu'un tente quand même ce moyen de paiement. */
  status: number;
  /** Message destiné au payeur — jamais la cause technique. */
  message: string;
  /** Cause exacte, pour les journaux serveur et Sentry. */
  cause: string;
}

/**
 * Ce moyen de paiement est-il réellement utilisable pour un montant libellé
 * dans cette devise ? Renvoie `null` si oui, sinon la raison du refus.
 *
 * Une seule règle, deux usages : `initiatePayment` s'en sert pour refuser, et
 * `moyensDePaiementDisponibles` pour dire à l'interface ce qu'elle peut
 * proposer. C'est délibérément la MÊME fonction. Dupliquer la logique
 * — une liste de moyens d'un côté, des conditions de refus de l'autre —
 * garantit qu'elles divergeront : l'interface finirait par afficher un bouton
 * que le serveur refuse, ce qui est exactement le symptôme observé en
 * production (« Ce moyen de paiement est momentanément indisponible » sur le
 * seul moyen proposé).
 *
 * Rappel du contexte : hors mode démo, une configuration incomplète est une
 * panne, pas un paiement. Un paiement simulé renvoie PAID sans qu'aucun
 * argent n'ait changé de main — l'abonnement s'active, le loyer passe en
 * réglé, la quittance s'émet. Le code 503 est délibéré : il est ≥ 500, donc
 * remonté à Sentry (voir shouldReportToSentry dans instrument.ts), ce qui
 * transforme un silence en alerte.
 */
export function indisponibilite(method: PaymentMethodKey, currency: string): Indisponibilite | null {
  // Le virement bancaire est une DÉCLARATION, pas un encaissement : il ne
  // dépend d'aucun prestataire et reste toujours proposable. C'est d'ailleurs
  // le seul recours quand tout le reste est indisponible.
  if (method === "BANK_TRANSFER") return null;

  if (method === "DEMO") {
    if (env.payments.demoMode) return null;
    // "DEMO" confirme un paiement instantanément, sans contrepartie. Le masquer
    // dans l'interface ne suffit pas — l'API reste appelable directement.
    return {
      status: 400,
      message: "Le mode démo n'est pas disponible sur cette plateforme.",
      cause: "mode démo désactivé",
    };
  }

  // En mode démo assumé, tout est simulé : les prestataires « fonctionnent »
  // sans clé ni devise compatible. C'est ce qui permet de dérouler le parcours
  // complet en développement.
  if (env.payments.demoMode) return null;

  if (method === "STRIPE") {
    if (!env.payments.stripeSecretKey) {
      return { status: 503, message: MESSAGE_NEUTRE, cause: "STRIPE_SECRET_KEY absente" };
    }

    // Sans secret de webhook, une session de paiement peut être créée et
    // réglée, mais AUCUNE confirmation ne pourrait être authentifiée : le
    // client paierait sans que sa facture ou son abonnement ne soit jamais
    // validé. Refuser vaut mieux qu'encaisser sans rien débloquer.
    if (!env.payments.stripeWebhookSecret) {
      return { status: 503, message: MESSAGE_NEUTRE, cause: "STRIPE_WEBHOOK_SECRET absente" };
    }

    if (!env.payments.stripeCurrencies.includes(currency.toUpperCase())) {
      return {
        status: 503,
        message: `Ce moyen de paiement n'accepte pas les règlements en ${currency}. Merci d'en choisir un autre.`,
        cause: `devise ${currency} absente de STRIPE_CURRENCIES (${env.payments.stripeCurrencies.join(", ")})`,
      };
    }

    return null;
  }

  const { masterKey, privateKey, token, currency: deviseDuCompte } = env.payments.paydunya;

  if (!masterKey || !privateKey || !token) {
    return { status: 503, message: MESSAGE_NEUTRE, cause: "clés API incomplètes (master, privée ou token)" };
  }

  // L'API PayDunya ne transporte pas de devise (voir config/env.ts) : le
  // montant est interprété dans celle du compte. Un prix de 29 EUR envoyé tel
  // quel sur un compte en XOF serait facturé 29 FCFA — un centième du prix.
  // Aucune conversion n'est tentée : convertir sans taux de référence fiable
  // produirait des montants faux mais crédibles, plus difficiles à repérer
  // qu'un refus.
  if (currency !== deviseDuCompte) {
    return {
      status: 503,
      message: `Ce moyen de paiement n'accepte pas les règlements en ${currency}. Merci d'en choisir un autre.`,
      cause: `montant libellé en ${currency} alors que le compte encaisse en ${deviseDuCompte}`,
    };
  }

  return null;
}

/** Tous les moyens connus, dans l'ordre où l'interface les présente. */
export const MOYENS_DE_PAIEMENT: PaymentMethodKey[] = ["PAYDUNYA", "STRIPE", "BANK_TRANSFER", "DEMO"];

/**
 * Les moyens réellement utilisables pour un montant dans cette devise.
 * L'interface n'a ainsi plus à deviner, ni à masquer un moyen « en dur ».
 */
export function moyensDePaiementDisponibles(currency: string): PaymentMethodKey[] {
  return MOYENS_DE_PAIEMENT.filter((method) => indisponibilite(method, currency) === null);
}

/**
 * Stripe Checkout en mode paiement ponctuel.
 *
 * On crée une session hébergée par Stripe et on renvoie son URL : le parcours
 * est donc identique à celui de PayDunya (statut REQUIRES_ACTION, redirection,
 * confirmation asynchrone par webhook), ce qui évite d'avoir deux logiques de
 * paiement différentes dans l'application.
 *
 * Pourquoi un appel HTTP direct plutôt que le SDK `stripe` : l'API Checkout
 * tient en une requête form-encodée, le webhook se vérifie avec le module
 * `crypto` de Node, et le reste du projet appelle déjà PayDunya de cette
 * manière. Cela évite surtout d'ajouter une dépendance — et le
 * `node_modules` de ce projet est installé sous Windows, donc pas
 * modifiable sans risque depuis l'environnement de développement distant.
 *
 * Le montant part en PLUS PETITE UNITÉ de la devise (voir
 * versPlusPetiteUnite) : c'est la convention de Stripe, et s'en écarter
 * facturerait cent fois trop ou cent fois trop peu.
 */
async function initiateStripePayment(
  amount: number,
  currency: string,
  reference: string,
  payerEmail: string,
  returnPath?: string
): Promise<PaymentIntentResult> {
  if (env.payments.demoMode) {
    return simulatedResult("STRIPE", reference, "Mode démo — paiement Stripe simulé.");
  }

  const redirectBase = `${env.frontendUrl}${returnPath ?? "/"}`;

  const corps = new URLSearchParams({
    mode: "payment",
    customer_email: payerEmail,
    // client_reference_id nous revient tel quel dans le webhook : c'est notre
    // identifiant d'origine (id de facture, ou "sub_<userId>_<timestamp>").
    client_reference_id: reference,
    "metadata[reference]": reference,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(versPlusPetiteUnite(amount, currency)),
    "line_items[0][price_data][product_data][name]": env.payments.storeName,
    "line_items[0][price_data][product_data][description]": `Paiement ${reference}`,
    success_url: `${redirectBase}?stripe=succes`,
    cancel_url: `${redirectBase}?stripe=annule`,
  });

  let response: Response;
  try {
    response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.payments.stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // Deux clics sur « Payer » pour la même facture renvoient la même
        // session au lieu d'en créer deux. La référence suffit comme clé :
        // elle identifie précisément ce qui est réglé.
        "Idempotency-Key": `checkout_${reference}`,
      },
      body: corps.toString(),
    });
  } catch (err) {
    console.error("[stripe] Échec réseau lors de la création de la session:", err);
    throw new ApiError(502, "Impossible de contacter Stripe pour le moment. Réessayez plus tard.");
  }

  const data = (await response.json()) as {
    id?: string;
    url?: string;
    error?: { message?: string };
  };

  if (!response.ok || !data.id || !data.url) {
    console.error("[stripe] Réponse inattendue lors de la création de la session:", data);
    throw new ApiError(502, data.error?.message || "Échec de l'initialisation du paiement par carte.");
  }

  return {
    method: "STRIPE",
    status: "REQUIRES_ACTION",
    // L'identifiant de session est enregistré comme paymentRef : c'est par lui
    // que le webhook retrouvera la facture ou l'abonnement concerné.
    reference: data.id,
    redirectUrl: data.url,
    message: "Redirection vers Stripe pour finaliser le paiement.",
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
  currency: string,
  reference: string,
  payerEmail: string,
  returnPath?: string
): Promise<PaymentIntentResult> {
  const { masterKey, privateKey, token, mode } = env.payments.paydunya;
  const { storeName } = env.payments;

  // indisponibilite() garantit ici la présence des trois clés et la
  // correspondance de la devise ; il ne reste que le cas du mode démo.
  if (env.payments.demoMode) {
    return simulatedResult("PAYDUNYA", reference, "Mode démo — paiement PayDunya simulé.");
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
  currency: string,
  reference: string,
  bankReference?: string
): Promise<PaymentIntentResult> {
  return {
    method: "BANK_TRANSFER",
    status: "PENDING_VALIDATION",
    reference: bankReference || `virement_${reference}`,
    message: `Virement de ${amount} ${currency} déclaré, en attente de validation par le gestionnaire.`,
  };
}

async function initiateDemoPayment(amount: number, currency: string, reference: string): Promise<PaymentIntentResult> {
  return simulatedResult("DEMO", reference, `Paiement démo de ${amount} ${currency} confirmé instantanément.`);
}

function simulatedResult(method: PaymentMethodKey, reference: string, message: string): PaymentIntentResult {
  return {
    method,
    status: "PAID",
    reference: `demo_${method.toLowerCase()}_${reference}_${Date.now()}`,
    message,
  };
}
