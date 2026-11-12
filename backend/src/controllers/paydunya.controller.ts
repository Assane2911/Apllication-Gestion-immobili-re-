import crypto from "crypto";
import { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { contracts, invoices, platformSubscriptions, properties } from "../db/schema";
import { lireIdentifiantsAgence } from "../services/comptePaiementAgence.service";
import { ETATS_MODIFIABLES } from "./invoice.controller";
import { env } from "../config/env";
import { asyncHandler } from "../utils/asyncHandler";
import { solderEnLigne } from "../services/paiementEnLigne.service";
import { signalerAbonnementNonRapproche, signalerPaiementNonRapproche } from "../services/paiementNonRapproche.service";
import { sendPaymentReceiptEmail } from "../services/receipt.service";
import { resteDu } from "../utils/montants";
import { activateSubscriptionRecord } from "../services/subscriptionActivation.service";
import { fetchAvecDelai } from "../utils/fetchAvecDelai";

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
  token: string,
  identifiants: { masterKey: string; privateKey: string; token: string; mode: "test" | "live" }
): Promise<{ status: string; totalAmount: number; reference?: string } | null> {
  const { masterKey, privateKey, token: apiToken, mode } = identifiants;
  const baseUrl = mode === "live" ? "https://app.paydunya.com/api/v1" : "https://app.paydunya.com/sandbox-api/v1";

  let response: globalThis.Response;
  try {
    response = await fetchAvecDelai(`${baseUrl}/checkout-invoice/confirm/${encodeURIComponent(token)}`, {
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
  await traiterIpnPaydunya(req, res, { identifiants: env.payments.paydunya, managerId: null });
});

/**
 * Notification d'un loyer payé sur le compte PayDunya d'une AGENCE (voir comptePaiementAgence.service.ts). Même
 * traitement que ci-dessus, mais avec les clés de cette agence pour vérifier le hash et confirmer le paiement, et
 * limité à SES factures : une agence ne peut ni solder la facture d'une autre, ni toucher à un abonnement.
 */
export const handlePaydunyaIpnAgence = asyncHandler(async (req: Request, res: Response) => {
  const managerId = req.params.managerId;
  const identifiants = await lireIdentifiantsAgence(managerId);
  if (!identifiants) {
    console.warn(`[paydunya] IPN reçue pour l'agence ${managerId}, qui n'a pas de compte de paiement actif.`);
    return res.status(404).json({ error: "Compte introuvable" });
  }
  await traiterIpnPaydunya(req, res, { identifiants, managerId });
});

interface PorteeIpn {
  identifiants: { masterKey: string; privateKey: string; token: string; mode: "test" | "live" };
  /** Agence dont les clés servent ; `null` : le compte de la plateforme. */
  managerId: string | null;
}

async function traiterIpnPaydunya(req: Request, res: Response, portee: PorteeIpn) {
  const raw = req.body?.data;
  const data: PaydunyaIpnPayload | undefined = typeof raw === "string" ? safeJsonParse(raw) : raw;

  if (!data) {
    console.warn("[paydunya] IPN reçue sans champ 'data' exploitable.");
    return res.status(400).json({ error: "Requête invalide" });
  }

  if (!isAuthentic(data.hash, portee.identifiants.masterKey)) {
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
  // Le compte d'une agence ne sert qu'à ses loyers : jamais un abonnement de la plateforme.
  if (portee.managerId && ourReference.startsWith("sub_")) {
    console.warn(`[paydunya] IPN de l'agence ${portee.managerId} portant une référence d'abonnement : ignorée.`);
    return res.json({ success: true });
  }

  const confirmation = await confirmerAupresDePaydunya(paydunyaToken, portee.identifiants);
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
      signalerAbonnementNonRapproche({ prestataire: "PAYDUNYA", referencePrestataire: paydunyaToken, montant: paidAmount, raison: "abonnement introuvable pour ce jeton" });
    } else if (!amountMatches(paidAmount, subscriptionRow.amount)) {
      console.warn(
        `[paydunya] IPN rejetée pour l'abonnement ${subscriptionRow.id} : montant confirmé (${paidAmount}) ≠ montant attendu (${subscriptionRow.amount}).`
      );
      signalerAbonnementNonRapproche({ prestataire: "PAYDUNYA", referencePrestataire: paydunyaToken, montant: paidAmount, raison: "montant différent de l'abonnement attendu" });
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
    // Sur le compte d'une agence, la facture doit être l'une des SIENNES (bail d'un de ses biens) : un jeton rejoué ou
    // fabriqué ne peut pas solder la facture d'une autre agence.
    const [trouvee] = await db
      .select({ invoice: invoices })
      .from(invoices)
      .innerJoin(contracts, eq(invoices.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(
        and(
          eq(invoices.paymentRef, paydunyaToken),
          eq(invoices.paymentMethod, "PAYDUNYA"),
          portee.managerId ? eq(properties.managerId, portee.managerId) : undefined
        )
      );
    const invoiceRow = trouvee?.invoice;

    // Un paiement réellement encaissé par PayDunya que la facture ne peut plus recevoir ne doit pas disparaître en
    // silence : le gestionnaire est prévenu (voir paiementNonRapproche.service.ts) pour rembourser ou régulariser.
    const signaler = (raison: string) =>
      signalerPaiementNonRapproche({
        prestataire: "PAYDUNYA",
        referenceFacture: ourReference,
        referencePrestataire: paydunyaToken,
        montant: Number.isFinite(paidAmount) ? paidAmount : 0,
        devise: "",
        raison,
      });

    if (!invoiceRow) {
      console.warn(`[paydunya] Facture introuvable pour le token ${paydunyaToken}`);
      await signaler("la facture ne porte plus ce paiement : elle a été réglée autrement ou un autre paiement a été lancé depuis");
    } else if (invoiceRow.status === "PAID") {
      // Rejeu de l'IPN qui a soldé la facture (le jeton en est la référence) : rien à faire.
      console.log(`[paydunya] Facture ${invoiceRow.id} déjà réglée, IPN ignorée.`);
    } else if (!ETATS_MODIFIABLES.includes(invoiceRow.status as (typeof ETATS_MODIFIABLES)[number])) {
      // Une facture CANCELLED ne doit jamais être ressuscitée en PAID par une confirmation arrivée après l'annulation.
      console.warn(
        `[paydunya] Facture ${invoiceRow.id} dans un état non modifiable (${invoiceRow.status}) : IPN ignorée.`
      );
      await signaler("la facture a été annulée");
    } else if (!amountMatches(paidAmount, Math.round(resteDu(invoiceRow)))) {
      // PayDunya encaisse des francs entiers (`total_amount: Math.round(amount)` à la création de la facture de paiement) :
      // le reste dû d'un loyer au prorata (54 838,71) est attendu arrondi (54 839), comme il a été demandé.
      console.warn(
        `[paydunya] IPN rejetée pour la facture ${invoiceRow.id} : montant confirmé (${paidAmount}) ≠ montant attendu (${Math.round(resteDu(invoiceRow))}).`
      );
      await signaler("le montant payé ne correspond plus au reste dû, qui a changé depuis le début du paiement");
    } else {
      // Condition de statut dans le WHERE (et pas seulement dans le garde
      // lu plus haut) : entre le SELECT et cet UPDATE, la facture a pu être
      // annulée ou déjà soldée par une autre livraison de la même IPN. Voir
      // le commentaire équivalent dans stripe.controller.ts.
      // Le paiement couvre le RESTE DÛ (voir paiementEnLigne.service.ts).
      const updated = await solderEnLigne(invoiceRow.id, { methode: "PAYDUNYA" });
      if (updated) {
        await sendPaymentReceiptEmail(updated.id).catch((err) =>
          console.error("[paydunya] Échec de l'envoi de la quittance après confirmation IPN:", err)
        );
      }
    }
  }

  res.json({ success: true });
}

/** Tolère un léger écart d'arrondi (montants en `doublePrecision`). */
function amountMatches(paidAmount: number, expectedAmount: number): boolean {
  return Number.isFinite(paidAmount) && Math.abs(paidAmount - expectedAmount) < 0.01;
}

function isAuthentic(receivedHash: unknown, masterKey: string): boolean {
  if (typeof receivedHash !== "string" || !receivedHash) return false;
  if (!masterKey) return false;

  const expected = crypto.createHash("sha512").update(masterKey).digest("hex");
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
