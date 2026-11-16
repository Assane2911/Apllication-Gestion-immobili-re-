import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db/client";
import { users } from "../db/schema";
import { BudgetTemps, SANS_LIMITE, traiterParLots } from "../utils/budgetTemps";
import { joursEntre } from "../utils/dates";
import { langueOuDefaut } from "../utils/langue";
import { accessEndEmail, sendEmail } from "./email.service";

/** Prévenir 3 jours avant l'échéance. */
export const JOURS_AVANT_FIN_ACCES = 3;
/**
 * Rattrapage : un e-mail « terminé » n'est envoyé que pour une échéance des 3 derniers jours. Une exécution manquée (panne, budget de
 * temps) se rattrape, mais une très ancienne échéance ne déclenche JAMAIS d'e-mail : les comptes expirés de longue date ne sont pas
 * relancés par ce dispositif.
 */
export const JOURS_RATTRAPAGE_FIN_ACCES = 3;
/**
 * Un abonnement reconduit automatiquement (Stripe) voit son échéance repoussée par le webhook du renouvellement, parfois quelques
 * heures après la date : on laisse un jour avant de le dire « terminé », pour ne pas annoncer une fin qui n'en est pas une.
 */
const DELAI_RENOUVELLEMENT_AUTO_MS = 24 * 3_600_000;

type CasFinAcces = "essaiBientot" | "essaiTermine" | "abonnementBientot" | "abonnementTermine";

/**
 * E-mails de fin d'essai gratuit et de fin d'abonnement, au gestionnaire PROPRIÉTAIRE de l'agence (jamais à un collaborateur) :
 *  - « bientôt » : l'échéance tombe dans les 3 jours ;
 *  - « terminé » : l'échéance est passée depuis moins de 3 jours (l'accès à la gestion est suspendu).
 *
 * Ne reçoivent rien : un compte suspendu par l'administration (il retrouve ses messages à la réactivation tant que la fenêtre n'est pas
 * échue), une adresse non confirmée, un accès sans date de fin, et — pour « bientôt » — un abonnement à reconduction automatique, qui
 * se renouvelle de lui-même.
 *
 * Chaque colonne `ending_notice_for` / `ended_notice_for` retient la date d'échéance POUR laquelle le message est parti : réclamée de
 * façon atomique AVANT l'envoi (deux exécutions simultanées n'envoient qu'un message), rendue si l'envoi échoue, et remise en jeu
 * d'elle-même quand l'échéance est repoussée (paiement, jours offerts, parrainage), puisque c'est alors une autre date.
 */
export async function runSubscriptionExpiryNotices(budget: BudgetTemps = SANS_LIMITE) {
  const maintenant = new Date();
  const debut = new Date(maintenant.getTime() - JOURS_RATTRAPAGE_FIN_ACCES * 86_400_000);
  const fin = new Date(maintenant.getTime() + JOURS_AVANT_FIN_ACCES * 86_400_000);

  const candidats = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.role, "MANAGER"),
        isNull(users.teamOwnerId),
        isNull(users.suspendedAt),
        isNotNull(users.emailVerifiedAt),
        or(
          and(eq(users.subscriptionStatus, "TRIAL"), isNotNull(users.trialEndsAt), gte(users.trialEndsAt, debut), lte(users.trialEndsAt, fin)),
          and(
            inArray(users.subscriptionStatus, ["ACTIVE", "CANCELLED"]),
            isNotNull(users.subscriptionEndsAt),
            gte(users.subscriptionEndsAt, debut),
            lte(users.subscriptionEndsAt, fin)
          )
        )
      )
    );

  let envoyes = 0;
  let echecs = 0;
  const parLots = await traiterParLots(candidats, env.cronConcurrence, budget, async (compte) => {
    const essai = compte.subscriptionStatus === "TRIAL";
    const echeance = new Date((essai ? compte.trialEndsAt : compte.subscriptionEndsAt) as Date);
    const reconduit = !essai && compte.subscriptionStatus === "ACTIVE" && compte.stripeSubscriptionId !== null;
    const bientot = echeance.getTime() > maintenant.getTime();

    if (bientot && reconduit) return;
    if (!bientot && reconduit && maintenant.getTime() - echeance.getTime() < DELAI_RENOUVELLEMENT_AUTO_MS) return;

    const cas: CasFinAcces = essai ? (bientot ? "essaiBientot" : "essaiTermine") : bientot ? "abonnementBientot" : "abonnementTermine";
    const colonne = bientot ? users.endingNoticeFor : users.endedNoticeFor;
    const precedent = bientot ? compte.endingNoticeFor : compte.endedNoticeFor;
    const marque = (valeur: Date | null) => (bientot ? { endingNoticeFor: valeur } : { endedNoticeFor: valeur });

    // Réclamation atomique : l'échéance lue doit être encore celle du compte, et le message pas déjà parti pour elle.
    const reclame = await db
      .update(users)
      .set(marque(echeance))
      .where(
        and(
          eq(users.id, compte.id),
          isNull(users.suspendedAt),
          eq(essai ? users.trialEndsAt : users.subscriptionEndsAt, echeance),
          or(isNull(colonne), ne(colonne, echeance))
        )
      )
      .returning({ id: users.id });
    if (reclame.length === 0) return;

    const { subject, html } = accessEndEmail({
      cas,
      endDate: echeance,
      daysLeft: Math.max(1, joursEntre(maintenant, echeance)),
      frontendUrl: env.frontendUrl,
      langue: langueOuDefaut(compte.language),
    });
    const resultat = await sendEmail(compte.email, subject, html);
    if (resultat.error) {
      // Rendu : l'exécution suivante retente, tant que l'échéance est dans la fenêtre.
      await db.update(users).set(marque(precedent)).where(eq(users.id, compte.id));
      echecs += 1;
      return;
    }
    envoyes += 1;
  });

  if (envoyes > 0) console.log(`[reminder] ⏳ ${envoyes} e-mail(s) de fin d'essai ou d'abonnement envoyé(s).`);
  if (parLots.interrompu) console.warn("[reminder] Budget de temps épuisé : des e-mails de fin d'essai ou d'abonnement sont reportés à la prochaine exécution.");
  return { sent: envoyes, echecs, interrompu: parLots.interrompu };
}
