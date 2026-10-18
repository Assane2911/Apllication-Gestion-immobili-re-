import { and, eq, like } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db/client";
import { activityLogs, users } from "../db/schema";
import { escapeHtml } from "../utils/html";
import { formaterMontant } from "../utils/montant";
import { logActivity } from "./activity.service";
import { sendEmail } from "./email.service";

const ACTION = "abonnement.prelevement_echoue";

/**
 * Prévient le gestionnaire que le prélèvement par carte du renouvellement de son abonnement a échoué (webhook
 * Stripe `invoice.payment_failed`). Sans cela, il ne l'apprenait qu'à l'expiration de son accès, sans avoir pu
 * corriger quoi que ce soit.
 *
 * Rien n'est modifié sur le compte : Stripe réessaie de lui-même (voire résilie après le dernier essai, voir
 * `customer.subscription.deleted`), et la fin d'accès reste déterminée par `subscriptionEndsAt`. Le message dit
 * quand aura lieu le prochain essai — ou qu'il n'y en aura plus — et renvoie vers la page Abonnement pour payer
 * autrement ou renouveler.
 *
 * Un même essai rejoué (Stripe rejoue ses webhooks) ne prévient qu'une fois : la clé est la facture Stripe et le
 * numéro d'essai, dans le journal d'activité. Ne lève jamais : un envoi raté ne doit pas faire échouer le webhook.
 */
export async function signalerEchecPrelevement(echec: {
  stripeSubscriptionId: string;
  stripeInvoiceId: string;
  /** Numéro de l'essai (1 pour le premier prélèvement raté). */
  tentative: number;
  /** Date du prochain essai automatique ; null quand Stripe n'en fera plus. */
  prochainEssai: Date | null;
  montant: number;
  devise: string;
}): Promise<boolean> {
  try {
    const [compte] = await db.select().from(users).where(eq(users.stripeSubscriptionId, echec.stripeSubscriptionId));
    if (!compte) return false;

    const reperage = `${echec.stripeInvoiceId} essai ${echec.tentative}`;
    const [dejaSignale] = await db
      .select({ id: activityLogs.id })
      .from(activityLogs)
      .where(
        and(
          eq(activityLogs.managerId, compte.id),
          eq(activityLogs.action, ACTION),
          eq(activityLogs.entityId, echec.stripeInvoiceId),
          like(activityLogs.details, `%${reperage}%`)
        )
      );
    if (dejaSignale) return false;

    const montant = formaterMontant(echec.montant, echec.devise);
    const date = echec.prochainEssai?.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    const suite = date
      ? `Stripe réessaiera automatiquement le <strong>${escapeHtml(date)}</strong>. Si votre carte est en cause (expirée, plafond, fonds insuffisants), vous pouvez dès maintenant régler autrement depuis la page Abonnement.`
      : `Stripe a fait son dernier essai : <strong>aucun nouvel essai automatique n'aura lieu</strong>, et le renouvellement automatique va s'arrêter. Pour garder votre accès, renouvelez votre abonnement depuis la page Abonnement.`;

    await logActivity({
      managerId: compte.id,
      action: ACTION,
      entityType: "subscription",
      entityId: echec.stripeInvoiceId,
      entityLabel: "Renouvellement de l'abonnement",
      details: `Prélèvement de ${montant} refusé (${reperage}). ${date ? `Prochain essai automatique le ${date}.` : "Aucun nouvel essai automatique."}`,
    });

    await sendEmail(
      compte.email,
      "Le prélèvement de votre abonnement a échoué",
      `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#0f172a;">Le prélèvement de votre abonnement a échoué</h2>
        <p>
          Le renouvellement automatique de votre abonnement (<strong>${escapeHtml(montant)}</strong>) n'a pas pu être
          prélevé sur votre carte.
        </p>
        <p>${suite}</p>
        <p style="margin:24px 0;">
          <a href="${escapeHtml(env.frontendUrl)}/subscription" style="background:#2563eb; color:#ffffff; padding:10px 18px; border-radius:8px; text-decoration:none;">Ouvrir la page Abonnement</a>
        </p>
        <p style="color:#475569; font-size:13px;">Votre accès reste actif jusqu'à la fin de la période déjà payée.</p>
      </div>
      `
    );
    return true;
  } catch (err) {
    console.error(`[stripe] Échec du signalement d'un prélèvement raté (${echec.stripeInvoiceId}):`, err);
    return false;
  }
}
