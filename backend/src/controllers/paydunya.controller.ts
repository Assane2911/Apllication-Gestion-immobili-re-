import crypto from "crypto";
import { Request, Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { invoices, platformSubscriptions } from "../db/schema";
import { ETATS_MODIFIABLES } from "./invoice.controller";
import { env } from "../config/env";
import { asyncHandler } from "../utils/asyncHandler";
import { sendPaymentReceiptEmail } from "../services/receipt.service";
import { activateSubscriptionRecord } from "../services/subscriptionActivation.service";

interface PaydunyaIpnPayload {
  status?: string;
  hash?: string;
  invoice?: { token?: string; total_amount?: string | number };
  custom_data?: { reference?: string };
}

interface PaydunyaConfirmResponse {
  response_code?: string;
  status?: string;
  invoice?: { total_amount?: string | number };
  custom_data?: { reference?: string };
}

/**
 * Confirmation serveur-à-serveur : le hash de l'IPN (voir isAuthentic)
 * prouve seulement la connaissance de la master key, jamais que CE montant
 * ni CE statut viennent réellement de PayDunya — c'est le corps POSTé, que
 * n'importe qui connaissant le hash pourrait fabriquer de toutes pièces,
 * avec n'importe quel montant ou statut (voir
 * https://developers.paydunya.com/doc/EN/http_json, "Confirm an invoice").
 * On revérifie donc directement auprès de PayDunya, avec nos propres clés,
 * le statut et le montant de CE token précis avant de faire confiance à
 * quoi que ce soit du corps de l'IPN pour créditer une facture ou un
 * abonnement. `null` signifie que PayDunya n'a pas pu être contacté ou a
 * répondu de façon inexploitable — dans ce cas l'appelant ne doit RIEN
 * créditer (il vaut mieux laisser PayDunya rejouer l'IPN plus tard que de
 * retomber sur le corps POSTé, non fiable à lui seul).
 */
async function confirmerAupresDePaydunya(
  token: string
): Promise<{ status: string; totalAmount: number; reference?: string } | null> {
  const { masterKey, privateKey, token: apiToken, mode } = env.payments.paydunya;
  const baseUrl = mode === "live" ? "https://app.paydunya.com/api/v1" : "https://app.paydunya.com/sandbox-api/v1";

  let response: globalThis.Response;
  try {
    response = await fetch(`${baseUrl}/checkout-invoice/confirm/${encodeURIComponent(token)}`, {
      headers: {
        "PAYDUNYA-MASTER-KEY": masterKey,
        "PAYDUNYA-PRIVATE-KEY": privateKey,
        "PAYDUNYA-TOKEN": apiToken,
      },
    });
  } catch (err) {
    console.error(`[paydunya] Échec réseau lors de la confirmation du token ${token}:`, err);
    return null;
  }

  let data: PaydunyaConfirmResponse;
  try {
    data = (await response.json()) as PaydunyaConfirmResponse;
  } catch (err) {
    console.error(`[paydunya] Réponse de confirmation illisible pour le token ${token}:`, err);
    return null;
  }

  if (!response.ok || data.response_code !== "00" || !data.status) {
    console.error(`[paydunya] Confirmation refusée par PayDunya pour le token ${token}:`, data);
    return null;
  }

  return {
    status: data.status,
    totalAmount: data.invoice?.total_amount !== undefined ? Number(data.invoice.total_amount) : NaN,
    reference: data.custom_data?.reference,
  };
}

/**
 * Notification IPN envoyée par PayDunya une fois le paiement traité (voir
 * https://developers.paydunya.com/doc/EN/http_json). Route volontairement
 * publique (pas de JWT) : PayDunya ne peut pas s'authentifier avec notre
 * système de connexion habituel. La sécurité repose entièrement sur la
 * vérification du hash SHA-512 de la master key ci-dessous — sans elle,
 * n'importe qui pourrait appeler cette route pour marquer une facture payée
 * sans avoir réellement payé.
 *
 * PayDunya poste le contenu en `application/x-www-form-urlencoded` sous une
 * clé `data`, tantôt en JSON stringifié, tantôt déjà éclatée en champs
 * imbriqués par leur client HTTP — on gère les deux cas.
 */
export const handlePaydunyaIpn = asyncHandler(async (req: Request, res: Response) => {
  const raw = req.body?.data;
  const data: PaydunyaIpnPayload | undefined = typeof raw === "string" ? safeJsonParse(raw) : raw;

  if (!data) {
    console.warn("[paydunya] IPN reçue sans champ 'data' exploitable.");
    return res.status(400).json({ error: "Requête invalide" });
  }

  if (!isAuthentic(data.hash)) {
    console.warn("[paydunya] IPN rejetée : hash invalide (mauvaise master key ou tentative frauduleuse).");
    return res.status(401).json({ error: "Signature invalide" });
  }

  // custom_data.reference est NOTRE identifiant d'origine (facture ou
  // "sub_<userId>_<timestamp>"), utilisé uniquement pour savoir dans quelle
  // table chercher. invoice.token est le token PayDunya, celui qu'on a
  // effectivement enregistré comme `paymentRef` lors de l'initiation.
  const ourReference = data.custom_data?.reference;
  const paydunyaToken = data.invoice?.token;

  if (!ourReference || !paydunyaToken) {
    console.warn("[paydunya] IPN authentique mais incomplète (référence ou token manquant).");
    return res.json({ success: true });
  }

  // Le hash prouve seulement la connaissance de la master key, jamais que CE
  // statut ni CE montant viennent réellement de PayDunya — data.status et
  // data.invoice.total_amount sont le corps POSTÉ, que n'importe qui
  // connaissant le hash pourrait fabriquer avec n'importe quelle valeur (voir
  // confirmerAupresDePaydunya ci-dessus). On revérifie donc directement
  // auprès de PayDunya, avec nos propres clés, avant de faire confiance à
  // quoi que ce soit du corps pour créditer une facture ou un abonnement.
  const confirmation = await confirmerAupresDePaydunya(paydunyaToken);
  if (!confirmation) {
    // Impossible de confirmer : ne rien créditer sur la seule foi du corps
    // POSTé. 502 fait rejouer l'IPN plus tard par PayDunya, comme pour tout
    // problème réseau ordinaire.
    return res.status(502).json({ error: "Confirmation indisponible" });
  }

  if (confirmation.reference && confirmation.reference !== ourReference) {
    console.warn(
      `[paydunya] Confirmation pour ${paydunyaToken} : référence PayDunya '${confirmation.reference}' ≠ référence reçue '${ourReference}' — IPN ignorée.`
    );
    return res.json({ success: true });
  }

  if (confirmation.status !== "completed") {
    console.log(`[paydunya] Confirmation pour ${paydunyaToken} : statut '${confirmation.status}', aucune mise à jour nécessaire.`);
    return res.json({ success: true });
  }

  // Montant réellement confirmé par PayDunya (jamais celui du corps POSTÉ,
  // voir plus haut) comparé au montant attendu en base avant toute mise à
  // jour de statut — une confirmation authentique mais liée à un paiement
  // partiel/incorrect ne doit pas solder l'intégralité de la facture.
  const paidAmount = confirmation.totalAmount;

  if (ourReference.startsWith("sub_")) {
    const [subscriptionRow] = await db
      .select()
      .from(platformSubscriptions)
      .where(eq(platformSubscriptions.paymentRef, paydunyaToken));

    if (!subscriptionRow) {
      console.warn(`[paydunya] Abonnement introuvable pour le token ${paydunyaToken}`);
    } else if (!amountMatches(paidAmount, subscriptionRow.amount)) {
      console.warn(
        `[paydunya] IPN rejetée pour l'abonnement ${subscriptionRow.id} : montant confirmé (${paidAmount}) ≠ montant attendu (${subscriptionRow.amount}).`
      );
    } else {
      // Marque l'historique de paiement PAID ET active réellement l'accès du
      // compte (subscriptionStatus/plan/endsAt) — voir subscriptionActivation.service.ts.
      // Avant ce correctif, seul l'historique était mis à jour : un paiement
      // PayDunya confirmé ne débloquait jamais vraiment l'abonnement du
      // gestionnaire, qui restait bloqué sur son statut précédent (essai
      // expiré, etc.) malgré un paiement réellement reçu.
      await activateSubscriptionRecord(subscriptionRow.id);
    }
  } else {
    // Rapprochement restreint aux factures réglées PAR PAYDUNYA, même raison
    // que côté Stripe : paymentRef sert aussi de référence de virement saisie
    // librement par le locataire (payInvoice) et n'a aucune contrainte
    // d'unicité — sans ce filtre, une IPN authentique pouvait solder une
    // facture déclarée en virement portant le même texte.
    const [invoiceRow] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.paymentRef, paydunyaToken), eq(invoices.paymentMethod, "PAYDUNYA")));

    if (!invoiceRow) {
      console.warn(`[paydunya] Facture introuvable pour le token ${paydunyaToken}`);
    } else if (!amountMatches(paidAmount, invoiceRow.amount)) {
      console.warn(
        `[paydunya] IPN rejetée pour la facture ${invoiceRow.id} : montant confirmé (${paidAmount}) ≠ montant attendu (${invoiceRow.amount}).`
      );
    } else if (!ETATS_MODIFIABLES.includes(invoiceRow.status as (typeof ETATS_MODIFIABLES)[number])) {
      // Régression corrigée : contrairement à markInvoicePaid/cancelInvoice
      // (invoice.controller.ts), cette IPN n'inspectait jamais le statut
      // courant avant d'écrire — une facture déjà PAID (réglée autrement, ou
      // IPN rejouée par PayDunya) voyait son paidAt et sa quittance
      // régénérés à chaque rejeu, et une facture CANCELLED pouvait être
      // ressuscitée en PAID par une confirmation arrivée après l'annulation.
      console.warn(
        `[paydunya] Facture ${invoiceRow.id} dans un état non modifiable (${invoiceRow.status}) : IPN ignorée.`
      );
    } else {
      // Condition de statut dans le WHERE (et pas seulement dans le garde
      // lu plus haut) : entre le SELECT et cet UPDATE, la facture a pu être
      // annulée ou déjà soldée par une autre livraison de la même IPN. Voir
      // le commentaire équivalent dans stripe.controller.ts.
      const [updated] = await db
        .update(invoices)
        .set({ status: "PAID", paidAt: new Date() })
        .where(and(eq(invoices.id, invoiceRow.id), inArray(invoices.status, [...ETATS_MODIFIABLES])))
        .returning();
      if (updated) {
        await sendPaymentReceiptEmail(updated.id).catch((err) =>
          console.error("[paydunya] Échec de l'envoi de la quittance après confirmation IPN:", err)
        );
      }
    }
  }

  res.json({ success: true });
});

/** Tolère un léger écart d'arrondi (montants en `doublePrecision`). */
function amountMatches(paidAmount: number, expectedAmount: number): boolean {
  return Number.isFinite(paidAmount) && Math.abs(paidAmount - expectedAmount) < 0.01;
}

function isAuthentic(receivedHash: unknown): boolean {
  if (typeof receivedHash !== "string" || !receivedHash) return false;
  if (!env.payments.paydunya.masterKey) return false;

  const expected = crypto.createHash("sha512").update(env.payments.paydunya.masterKey).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(receivedHash, "utf8");
  return expectedBuf.length === receivedBuf.length && crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

function safeJsonParse(raw: string): PaydunyaIpnPayload | undefined {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
