import * as Sentry from "@sentry/node";
import { and, eq, like } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db/client";
import { activityLogs, contracts, invoices, platformSubscriptions, properties, users } from "../db/schema";
import { ApiError } from "../utils/asyncHandler";
import { escapeHtml } from "../utils/html";
import { fetchAvecDelai } from "../utils/fetchAvecDelai";
import { formaterMontant } from "../utils/montant";
import { logActivity } from "./activity.service";
import { sendEmail } from "./email.service";
import { depuisPlusPetiteUnite } from "./payment.service";

export type NatureEvenement = "REMBOURSEMENT" | "LITIGE";

const ACTIONS: Record<NatureEvenement, string> = {
  REMBOURSEMENT: "paiement_en_ligne.rembourse",
  LITIGE: "paiement_en_ligne.litige",
};

/**
 * Identifiant de la session de paiement (Checkout) qui a produit un paiement Stripe — celle que la facture porte
 * comme référence. Stripe n'annonce un remboursement ou un litige que par le paiement (`payment_intent`) : il faut
 * le redemander à Stripe pour retrouver la facture. `null` quand ce paiement ne vient pas d'une session de la
 * plateforme (un autre produit du même compte Stripe).
 *
 * Lève quand Stripe est injoignable ou refuse : le webhook répond alors en erreur et Stripe rejoue l'événement,
 * plutôt que de perdre le signalement.
 */
export async function retrouverSessionDuPaiement(paymentIntent: string): Promise<string | null> {
  const reponse = await fetchAvecDelai(
    `https://api.stripe.com/v1/checkout/sessions?payment_intent=${encodeURIComponent(paymentIntent)}&limit=1`,
    { headers: { Authorization: `Bearer ${env.payments.stripeSecretKey}` } }
  );
  if (!reponse.ok) throw new ApiError(502, `Stripe a refusé de retrouver la session du paiement ${paymentIntent} (HTTP ${reponse.status}).`);
  const corps = (await reponse.json()) as { data?: Array<{ id?: string }> };
  return corps.data?.[0]?.id ?? null;
}

export interface EvenementPaiement {
  nature: NatureEvenement;
  /** Objet Stripe concerné : le débit (remboursement) ou la contestation (litige) — sert à ne signaler qu'une fois. */
  referenceStripe: string;
  paymentIntent: string;
  /** Montant remboursé ou contesté, en plus petite unité de la devise. */
  montantBrut: number;
  devise: string;
  /** Litige : motif donné par la banque du locataire. */
  motif?: string | null;
  /** Litige : date limite pour répondre depuis le tableau de bord Stripe. */
  reponseAvant?: Date | null;
}

/**
 * Prévient d'un remboursement ou d'un litige sur un paiement en ligne DÉJÀ encaissé. La facture reste « payée » avec
 * sa quittance alors que l'argent est reparti (ou va l'être) : sans cela, personne ne le savait.
 *
 * Rien n'est modifié — ni la facture, ni l'abonnement. C'est au gestionnaire de décider (annuler la quittance,
 * réclamer le loyer, répondre à la banque) : il reçoit un email et une ligne au journal d'activité. Pour l'abonnement à
 * la plateforme, aucun gestionnaire à prévenir : l'événement remonte à Sentry. Un même événement rejoué ne prévient
 * qu'une fois ; un remboursement supplémentaire (autre montant remboursé) prévient de nouveau.
 */
export async function signalerRemboursementOuLitige(evenement: EvenementPaiement): Promise<void> {
  const sessionId = await retrouverSessionDuPaiement(evenement.paymentIntent);
  if (!sessionId) return;

  const devise = evenement.devise.toUpperCase();
  const montant = depuisPlusPetiteUnite(evenement.montantBrut, devise);
  const natureTexte = evenement.nature === "REMBOURSEMENT" ? "remboursement" : "litige";
  const cle = `${evenement.nature}:${evenement.referenceStripe}:${evenement.montantBrut}`;

  try {
    const [abonnement] = await db.select().from(platformSubscriptions).where(eq(platformSubscriptions.paymentRef, sessionId));
    if (abonnement) {
      try {
        Sentry.captureMessage(`Abonnement à la plateforme : ${natureTexte} d'un paiement Stripe (à examiner)`, {
          level: "error",
          tags: { source: "abonnement.remboursement_ou_litige", nature: evenement.nature },
          extra: { session: sessionId, reference: evenement.referenceStripe, montant, devise },
        });
      } catch {
        // Un suivi d'erreurs indisponible ne doit jamais faire échouer le webhook.
      }
      return;
    }

    const [ligne] = await db
      .select({ invoice: invoices, property: properties })
      .from(invoices)
      .innerJoin(contracts, eq(invoices.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(and(eq(invoices.paymentRef, sessionId), eq(invoices.paymentMethod, "STRIPE")));
    if (!ligne) return;

    const managerId = ligne.property.managerId;
    const action = ACTIONS[evenement.nature];
    const [dejaSignale] = await db
      .select({ id: activityLogs.id })
      .from(activityLogs)
      .where(
        and(
          eq(activityLogs.managerId, managerId),
          eq(activityLogs.action, action),
          eq(activityLogs.entityId, ligne.invoice.id),
          like(activityLogs.details, `%[${cle}]%`)
        )
      );
    if (dejaSignale) return;

    const facture = ligne.invoice;
    const periode = `${String(facture.periodMonth).padStart(2, "0")}/${facture.periodYear}`;
    const somme = formaterMontant(montant, devise || facture.currency);
    const date = evenement.reponseAvant?.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

    await logActivity({
      managerId,
      action,
      entityType: "invoice",
      entityId: facture.id,
      entityLabel: `${ligne.property.title} — ${periode}`,
      details:
        evenement.nature === "REMBOURSEMENT"
          ? `Paiement Stripe du loyer ${periode} remboursé à hauteur de ${somme}. La facture reste enregistrée comme payée : à vérifier. [${cle}]`
          : `Litige ouvert sur le paiement Stripe du loyer ${periode} (${somme}${evenement.motif ? `, motif : ${evenement.motif}` : ""}${date ? `, réponse avant le ${date}` : ""}). La facture reste enregistrée comme payée : à vérifier. [${cle}]`,
    });

    const [gestionnaire] = await db.select({ email: users.email }).from(users).where(eq(users.id, managerId));
    if (!gestionnaire?.email) return;

    const intro =
      evenement.nature === "REMBOURSEMENT"
        ? `Un paiement en ligne du loyer <strong>${escapeHtml(periode)}</strong> de <strong>${escapeHtml(ligne.property.title)}</strong> a été <strong>remboursé</strong> à hauteur de <strong>${escapeHtml(somme)}</strong> (depuis votre tableau de bord Stripe).`
        : `Le locataire a <strong>contesté</strong> auprès de sa banque le paiement en ligne du loyer <strong>${escapeHtml(periode)}</strong> de <strong>${escapeHtml(ligne.property.title)}</strong> (<strong>${escapeHtml(somme)}</strong>${evenement.motif ? `, motif : <code>${escapeHtml(evenement.motif)}</code>` : ""}). Stripe a retiré ce montant en attendant l'issue du litige.${date ? ` <strong>Vous avez jusqu'au ${escapeHtml(date)}</strong> pour répondre depuis votre tableau de bord Stripe.` : ""}`;

    await sendEmail(
      gestionnaire.email,
      evenement.nature === "REMBOURSEMENT"
        ? `Paiement en ligne remboursé — ${ligne.property.title}, loyer ${periode}`
        : `Litige sur un paiement en ligne — ${ligne.property.title}, loyer ${periode}`,
      `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">${evenement.nature === "REMBOURSEMENT" ? "Un paiement a été remboursé" : "Un paiement est contesté"}</h2>
        <p>${intro}</p>
        <p>
          <strong>Nous n'avons rien modifié</strong> : la facture reste enregistrée comme payée, avec sa quittance. C'est à
          vous de décider de la suite (annuler la quittance, réclamer de nouveau le loyer, répondre à la banque).
        </p>
        <p style="color:#475569; font-size:13px;">Référence Stripe à retrouver : <code>${escapeHtml(evenement.referenceStripe)}</code></p>
      </div>
      `
    );
  } catch (err) {
    console.error(`[stripe] Échec du signalement d'un ${natureTexte} (${evenement.referenceStripe}):`, err);
  }
}
