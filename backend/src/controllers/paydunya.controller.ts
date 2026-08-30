import crypto from "crypto";
import { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { invoices, platformSubscriptions } from "../db/schema";
import { env } from "../config/env";
import { asyncHandler } from "../utils/asyncHandler";
import { sendPaymentReceiptEmail } from "../services/receipt.service";

interface PaydunyaIpnPayload {
  status?: string;
  hash?: string;
  invoice?: { token?: string };
  custom_data?: { reference?: string };
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

  if (data.status !== "completed") {
    console.log(`[paydunya] IPN pour ${paydunyaToken} : statut '${data.status}', aucune mise à jour nécessaire.`);
    return res.json({ success: true });
  }

  if (ourReference.startsWith("sub_")) {
    const [record] = await db
      .update(platformSubscriptions)
      .set({ status: "PAID" })
      .where(eq(platformSubscriptions.paymentRef, paydunyaToken))
      .returning();
    if (!record) {
      console.warn(`[paydunya] Abonnement introuvable pour le token ${paydunyaToken}`);
    }
  } else {
    const [updated] = await db
      .update(invoices)
      .set({ status: "PAID", paidAt: new Date() })
      .where(eq(invoices.paymentRef, paydunyaToken))
      .returning();
    if (updated) {
      sendPaymentReceiptEmail(updated.id).catch((err) =>
        console.error("[paydunya] Échec de l'envoi de la quittance après confirmation IPN:", err)
      );
    } else {
      console.warn(`[paydunya] Facture introuvable pour le token ${paydunyaToken}`);
    }
  }

  res.json({ success: true });
});

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
