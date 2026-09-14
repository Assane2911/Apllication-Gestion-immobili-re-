import crypto from "crypto";
import { eq } from "drizzle-orm";
import { Request, Response } from "express";
import { env } from "../config/env";
import { db } from "../db/client";
import { invoices, platformSubscriptions } from "../db/schema";
import { ETATS_MODIFIABLES } from "./invoice.controller";
import { sendPaymentReceiptEmail } from "../services/receipt.service";
import { depuisPlusPetiteUnite } from "../services/payment.service";
import { activateSubscriptionRecord } from "../services/subscriptionActivation.service";
import { asyncHandler } from "../utils/asyncHandler";

/** Tolérance d'horloge acceptée entre l'émission de l'événement et sa réception. */
const FENETRE_SECONDES = 5 * 60;

interface SessionCheckout {
  id?: string;
  payment_status?: string;
  amount_total?: number;
  currency?: string;
  client_reference_id?: string | null;
  metadata?: { reference?: string };
}

/**
 * Webhook Stripe : confirmation asynchrone d'un paiement par carte.
 *
 * Route volontairement publique (pas de JWT) — Stripe ne peut pas s'authentifier
 * avec notre système de connexion. La sécurité repose entièrement sur la
 * vérification de l'en-tête `Stripe-Signature` ci-dessous : sans elle,
 * n'importe qui pourrait appeler cette URL pour marquer une facture payée sans
 * avoir rien réglé. Même raisonnement que le hash de l'IPN PayDunya.
 *
 * Le corps doit arriver BRUT (voir le montage express.raw dans app.ts) : la
 * signature porte sur les octets exacts envoyés par Stripe. Un corps
 * re-sérialisé après analyse JSON ne redonne pas la même empreinte.
 */
export const handleStripeWebhook = asyncHandler(async (req: Request, res: Response) => {
  const corpsBrut = Buffer.isBuffer(req.body) ? (req.body as Buffer) : null;

  if (!corpsBrut) {
    console.warn("[stripe] Webhook reçu sans corps brut — vérifier le montage express.raw.");
    return res.status(400).json({ error: "Requête invalide" });
  }

  if (!signatureValide(corpsBrut, req.header("stripe-signature"))) {
    console.warn("[stripe] Webhook rejeté : signature invalide ou expirée.");
    return res.status(401).json({ error: "Signature invalide" });
  }

  const evenement = analyser(corpsBrut);
  if (!evenement) {
    console.warn("[stripe] Webhook authentique mais corps illisible.");
    return res.status(400).json({ error: "Requête invalide" });
  }

  // Stripe envoie des dizaines de types d'événements ; un seul nous intéresse.
  // On répond 200 aux autres, sinon Stripe les rejouerait indéfiniment.
  if (evenement.type !== "checkout.session.completed") {
    return res.json({ received: true });
  }

  const session = (evenement.data?.object ?? {}) as SessionCheckout;
  const sessionId = session.id;
  const notreReference = session.client_reference_id || session.metadata?.reference;

  if (!sessionId || !notreReference) {
    console.warn("[stripe] Événement authentique mais incomplet (session ou référence manquante).");
    return res.json({ received: true });
  }

  // Une session peut être « completed » sans être réglée (paiement différé,
  // échec au dernier moment). Seul payment_status fait foi.
  if (session.payment_status !== "paid") {
    console.log(`[stripe] Session ${sessionId} : payment_status '${session.payment_status}', aucune mise à jour.`);
    return res.json({ received: true });
  }

  // La signature prouve que l'appel vient de Stripe, jamais que le montant
  // réglé correspond à ce qui était dû. On compare donc toujours — même
  // précaution que pour l'IPN PayDunya.
  const devise = (session.currency ?? "").toUpperCase();
  const montantPaye =
    typeof session.amount_total === "number" ? depuisPlusPetiteUnite(session.amount_total, devise) : NaN;

  if (notreReference.startsWith("sub_")) {
    const [abonnement] = await db
      .select()
      .from(platformSubscriptions)
      .where(eq(platformSubscriptions.paymentRef, sessionId));

    if (!abonnement) {
      console.warn(`[stripe] Abonnement introuvable pour la session ${sessionId}`);
    } else if (!montantCorrespond(montantPaye, abonnement.amount)) {
      console.warn(
        `[stripe] Webhook rejeté pour l'abonnement ${abonnement.id} : montant confirmé (${montantPaye}) ≠ montant attendu (${abonnement.amount}).`
      );
    } else {
      // Idempotent : un abonnement déjà PAID est renvoyé tel quel. Stripe
      // rejoue ses webhooks en cas de doute, et un double clic ne doit pas
      // prolonger l'abonnement deux fois.
      await activateSubscriptionRecord(abonnement.id);
    }
  } else {
    const [facture] = await db.select().from(invoices).where(eq(invoices.paymentRef, sessionId));

    if (!facture) {
      console.warn(`[stripe] Facture introuvable pour la session ${sessionId}`);
    } else if (!montantCorrespond(montantPaye, facture.amount)) {
      console.warn(
        `[stripe] Webhook rejeté pour la facture ${facture.id} : montant confirmé (${montantPaye}) ≠ montant attendu (${facture.amount}).`
      );
    } else if (facture.status === "PAID") {
      console.log(`[stripe] Facture ${facture.id} déjà réglée, rien à faire.`);
    } else if (!ETATS_MODIFIABLES.includes(facture.status as (typeof ETATS_MODIFIABLES)[number])) {
      // Régression corrigée : seul le cas PAID était un no-op ci-dessus ; une
      // facture CANCELLED tombait dans le `else` suivant et repassait PAID.
      // Stripe rejoue ses webhooks (doute réseau, redémarrage) — un paiement
      // confirmé APRÈS l'annulation d'une facture (contrat résilié pendant
      // qu'un paiement était en cours, ou simple rejeu tardif) ne doit jamais
      // ressusciter une facture que le gestionnaire a explicitement annulée.
      console.warn(
        `[stripe] Facture ${facture.id} dans un état non modifiable (${facture.status}) : confirmation de paiement ignorée.`
      );
    } else {
      const [misAJour] = await db
        .update(invoices)
        .set({ status: "PAID", paidAt: new Date() })
        .where(eq(invoices.id, facture.id))
        .returning();
      if (misAJour) {
        await sendPaymentReceiptEmail(misAJour.id).catch((err) =>
          console.error("[stripe] Échec de l'envoi de la quittance après confirmation:", err)
        );
      }
    }
  }

  res.json({ received: true });
});

/** Tolère un léger écart d'arrondi (montants en `doublePrecision`). */
function montantCorrespond(montantPaye: number, montantAttendu: number): boolean {
  return Number.isFinite(montantPaye) && Math.abs(montantPaye - montantAttendu) < 0.01;
}

/**
 * Vérifie l'en-tête `Stripe-Signature`, de la forme :
 *     t=1492774577,v1=5257a869e7ec...,v1=...
 *
 * La signature attendue est un HMAC-SHA256 de « <t>.<corps brut> » avec le
 * secret du webhook. Trois précautions, chacune nécessaire :
 *
 *  - l'horodatage est comparé à l'heure courante : sans cette fenêtre, une
 *    requête authentique interceptée pourrait être rejouée des mois plus tard ;
 *  - la comparaison est à temps constant (timingSafeEqual), pour ne pas laisser
 *    deviner la signature octet par octet ;
 *  - plusieurs `v1` peuvent coexister pendant une rotation de secret, donc on
 *    accepte si l'un d'eux correspond.
 */
function signatureValide(corpsBrut: Buffer, entete: string | undefined): boolean {
  const secret = env.payments.stripeWebhookSecret;
  if (!secret || !entete) return false;

  let horodatage: string | null = null;
  const signatures: string[] = [];

  for (const partie of entete.split(",")) {
    const [cle, valeur] = partie.split("=", 2);
    if (cle === "t") horodatage = valeur;
    else if (cle === "v1" && valeur) signatures.push(valeur);
  }

  if (!horodatage || signatures.length === 0) return false;

  const emisA = Number(horodatage);
  if (!Number.isFinite(emisA)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - emisA) > FENETRE_SECONDES) return false;

  const attendue = crypto
    .createHmac("sha256", secret)
    .update(`${horodatage}.${corpsBrut.toString("utf8")}`)
    .digest("hex");
  const attendueBuf = Buffer.from(attendue, "utf8");

  return signatures.some((recue) => {
    const recueBuf = Buffer.from(recue, "utf8");
    return recueBuf.length === attendueBuf.length && crypto.timingSafeEqual(recueBuf, attendueBuf);
  });
}

function analyser(corpsBrut: Buffer): { type?: string; data?: { object?: unknown } } | null {
  try {
    return JSON.parse(corpsBrut.toString("utf8"));
  } catch {
    return null;
  }
}
