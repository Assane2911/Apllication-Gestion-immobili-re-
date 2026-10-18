import * as Sentry from "@sentry/node";
import { and, eq, like } from "drizzle-orm";
import { db } from "../db/client";
import { activityLogs, contracts, invoices, properties, users } from "../db/schema";
import { escapeHtml } from "../utils/html";
import { formaterMontant } from "../utils/montant";
import { resteDu } from "../utils/montants";
import { logActivity } from "./activity.service";
import { sendEmail } from "./email.service";

const ACTION = "paiement_en_ligne.non_rapproche";

const PRESTATAIRES = { STRIPE: "Stripe", PAYDUNYA: "PayDunya" } as const;

/**
 * Signale un paiement en ligne que le prestataire a bel et bien encaissé (webhook authentique, montant confirmé)
 * mais qu'AUCUNE facture ne peut recevoir : le gestionnaire a réglé la facture en partie ou en entier pendant que
 * le locataire payait, l'a annulée, ou la facture porte désormais la référence d'une autre session.
 *
 * Le webhook répond 200 dans ce cas (rejouer l'événement n'y changerait rien) : sans ce signalement, l'argent du
 * locataire était pris, rien n'était écrit, et personne ne le savait. La facture n'est JAMAIS modifiée ici — le
 * gestionnaire décide : rembourser depuis le tableau de bord du prestataire, ou enregistrer le paiement à la main.
 *
 * Ne lève jamais : un signalement raté ne doit pas faire échouer le webhook. Un même paiement rejoué ne prévient
 * qu'une fois (clé : la référence du prestataire, dans le journal d'activité).
 */
export async function signalerPaiementNonRapproche(paiement: {
  prestataire: keyof typeof PRESTATAIRES;
  /** Notre identifiant de facture, tel que renvoyé par le prestataire (client_reference_id / custom_data). */
  referenceFacture: string;
  /** Identifiant de session (Stripe) ou jeton (PayDunya) : ce que le gestionnaire cherchera chez le prestataire. */
  referencePrestataire: string;
  montant: number;
  devise: string;
  raison: string;
}) {
  const nom = PRESTATAIRES[paiement.prestataire];
  try {
    // Isolé : un suivi d'erreurs indisponible ne doit pas empêcher de prévenir le gestionnaire, qui est l'essentiel.
    try {
      Sentry.captureMessage(`Paiement ${nom} encaissé mais non rapproché (${paiement.raison})`, {
        level: "warning",
        tags: { source: "paiement.non_rapproche", prestataire: paiement.prestataire },
      });
    } catch {
      // Voir ci-dessus.
    }

    const [ligne] = await db
      .select({ invoice: invoices, property: properties })
      .from(invoices)
      .innerJoin(contracts, eq(invoices.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(eq(invoices.id, paiement.referenceFacture));
    if (!ligne) return;

    const managerId = ligne.property.managerId;
    const [dejaSignale] = await db
      .select({ id: activityLogs.id })
      .from(activityLogs)
      .where(
        and(
          eq(activityLogs.managerId, managerId),
          eq(activityLogs.action, ACTION),
          eq(activityLogs.entityId, ligne.invoice.id),
          like(activityLogs.details, `%${paiement.referencePrestataire}%`)
        )
      );
    if (dejaSignale) return;

    const facture = ligne.invoice;
    const devise = paiement.devise || facture.currency || "EUR";
    const periode = `${String(facture.periodMonth).padStart(2, "0")}/${facture.periodYear}`;
    const recu = formaterMontant(paiement.montant, devise);
    const reste = formaterMontant(resteDu(facture), facture.currency ?? devise);

    await logActivity({
      managerId,
      action: ACTION,
      entityType: "invoice",
      entityId: facture.id,
      entityLabel: `${ligne.property.title} — ${periode}`,
      details: `Paiement ${nom} de ${recu} encaissé mais non rapproché de la facture ${periode} (${paiement.raison}). Référence ${nom} : ${paiement.referencePrestataire}. À rembourser depuis ${nom} ou à enregistrer à la main.`,
    });

    const [gestionnaire] = await db.select({ email: users.email }).from(users).where(eq(users.id, managerId));
    if (!gestionnaire?.email) return;
    await sendEmail(
      gestionnaire.email,
      `Paiement en ligne à vérifier — ${ligne.property.title}, loyer ${periode}`,
      `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">Un paiement en ligne n'a pas pu être rapproché</h2>
        <p>
          Un locataire a réglé <strong>${escapeHtml(recu)}</strong> par ${escapeHtml(nom)} pour le loyer
          <strong>${escapeHtml(periode)}</strong> de <strong>${escapeHtml(ligne.property.title)}</strong>,
          mais la facture ne pouvait plus recevoir ce paiement : ${escapeHtml(paiement.raison)}.
        </p>
        <p>
          <strong>Nous n'avons rien modifié sur la facture</strong> (reste dû actuellement : ${escapeHtml(reste)}).
          L'argent a bien été encaissé par ${escapeHtml(nom)} : vous pouvez soit le rembourser au locataire depuis
          votre tableau de bord ${escapeHtml(nom)}, soit enregistrer le paiement à la main dans l'application.
        </p>
        <p style="color:#475569; font-size:13px;">Référence ${escapeHtml(nom)} à retrouver : <code>${escapeHtml(paiement.referencePrestataire)}</code></p>
      </div>
      `
    );
  } catch (err) {
    console.error(`[paiement] Échec du signalement d'un paiement ${nom} non rapproché (${paiement.referencePrestataire}):`, err);
  }
}

/**
 * Même situation pour l'ABONNEMENT à la plateforme : un gestionnaire a payé, mais rien ne permet de lui activer
 * son accès (abonnement introuvable, montant différent de l'attendu, renouvellement incohérent). Personne n'est
 * prévenu par la plateforme — le gestionnaire paie sans rien obtenir —, donc l'événement remonte à Sentry avec de
 * quoi retrouver le paiement chez le prestataire. Ne lève jamais.
 */
export function signalerAbonnementNonRapproche(paiement: {
  prestataire: keyof typeof PRESTATAIRES;
  referencePrestataire: string;
  montant: number;
  raison: string;
}) {
  try {
    Sentry.captureMessage(`Paiement d'abonnement ${PRESTATAIRES[paiement.prestataire]} encaissé mais non appliqué (${paiement.raison})`, {
      level: "error",
      tags: { source: "abonnement.non_rapproche", prestataire: paiement.prestataire },
      extra: { referencePrestataire: paiement.referencePrestataire, montant: paiement.montant },
    });
  } catch {
    // Un suivi d'erreurs indisponible ne doit jamais faire échouer le webhook.
  }
}
