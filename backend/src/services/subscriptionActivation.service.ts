import { and, desc, eq } from "drizzle-orm";
import { db, DbClient, Transaction } from "../db/client";
import { platformSubscriptions, users } from "../db/schema";
import { ApiError } from "../utils/asyncHandler";
import { tarifPourDevise } from "../controllers/subscription.controller";
import { calculerPeriodeActivation } from "./subscriptionPeriod.service";

/**
 * Active réellement l'abonnement d'un utilisateur à partir d'un enregistrement
 * de paiement (platform_subscriptions) déjà existant : bascule l'historique
 * de paiement en "PAID" ET débloque l'accès du compte correspondant
 * (subscriptionStatus/plan/endsAt/paymentMethod).
 *
 * Utilisé après coup pour confirmer un paiement déjà enregistré en PENDING —
 * par le webhook PayDunya (paiement Mobile Money confirmé) et par la
 * validation manuelle d'un virement bancaire par un administrateur. C'est
 * distinct de subscribe(), qui crée ET active l'abonnement en une seule
 * transaction lorsque le paiement est confirmé immédiatement (DEMO, ou futur
 * paiement carte synchrone) — il n'a pas besoin de cette fonction puisqu'il
 * n'y a pas encore d'enregistrement PENDING préexistant à ce moment-là.
 *
 * Idempotent : si l'enregistrement est déjà PAID, ne fait rien et le renvoie
 * tel quel (évite une double activation, par exemple deux notifications
 * PayDunya identiques ou un double clic administrateur).
 *
 * ATOMIQUE. Cette fonction fait DEUX écritures — l'historique de facturation,
 * puis les droits d'accès du compte — et elles ne peuvent pas se dissocier.
 * Sans transaction, l'échec de la seconde laissait un état où le client a
 * payé, où l'historique le confirme, mais où son accès reste fermé : il ne
 * pourrait ni entrer, ni repayer (l'enregistrement est déjà PAID). Le MRR de
 * l'écran d'administration, lui, le compterait comme abonné actif.
 *
 * Les trois appelants — webhook Stripe, webhook PayDunya, validation d'un
 * virement par un administrateur — n'ouvraient aucune transaction. Plutôt que
 * de le leur demander et d'espérer qu'un futur appelant y pense, la fonction
 * ouvre la sienne quand on ne lui en fournit pas.
 *
 * `dbClient` reste accepté pour l'appelant qui a DÉJÀ une transaction en
 * cours : on rejoint la sienne au lieu d'en imbriquer une seconde.
 */
export async function activateSubscriptionRecord(subscriptionId: string, dbClient?: DbClient) {
  if (dbClient) return activerAvec(subscriptionId, dbClient);
  return db.transaction((tx: Transaction) => activerAvec(subscriptionId, tx));
}

async function activerAvec(subscriptionId: string, dbClient: DbClient) {
  const [record] = await dbClient
    .select()
    .from(platformSubscriptions)
    .where(eq(platformSubscriptions.id, subscriptionId));

  if (!record) return null;
  if (record.status === "PAID") return record;

  // Un enregistrement REJECTED (virement bancaire explicitement rejeté par un
  // administrateur, voir rejectBankTransfer) ne doit JAMAIS pouvoir être
  // activé après coup : sans ce garde-fou, confirmer un virement déjà rejeté
  // (ou rappeler cette fonction par erreur sur un enregistrement rejeté)
  // donnait quand même accès à l'abonnement payant. On lève une erreur
  // plutôt que de faire un no-op silencieux comme pour PAID, car ici
  // l'appelant croit confirmer un paiement qui n'a en réalité jamais été
  // validé.
  if (record.status === "REJECTED") {
    throw new ApiError(400, "Ce virement a été rejeté : impossible de le confirmer");
  }

  const [compte] = await dbClient.select().from(users).where(eq(users.id, record.userId));
  if (!compte) return null;

  // La période est RECALCULÉE ici, et non reprise telle qu'elle avait été
  // enregistrée à la demande. Un virement bancaire est validé plusieurs jours
  // après avoir été déclaré ; garder les dates de la demande revenait à faire
  // courir l'abonnement pendant un délai où le compte était encore fermé — le
  // client payait un mois et en recevait trois semaines. Le même écart existe
  // pour tout paiement confirmé en différé.
  //
  // On repart donc de l'instant où l'accès s'ouvre réellement, en reportant
  // les droits déjà payés s'il en reste ET en les reconvertissant au tarif du
  // nouveau plan si le plan a changé (voir calculerPeriodeActivation) —
  // RÉGRESSION : cette fonction recalculait auparavant la période avec
  // calculerPeriode seul, en ignorant totalement record.plan/record.amount et
  // la proratisation ajoutée dans subscribe(). Cette fonction étant le SEUL
  // chemin réellement emprunté pour tout paiement asynchrone (virement,
  // PayDunya, Stripe), un changement de plan payé par l'un de ces moyens
  // recevait le temps restant reporté à valeur nominale pleine sur le nouveau
  // plan au lieu d'être reconverti.
  const maintenant = new Date();
  const changeDePlan = compte.subscriptionPlan !== record.plan;
  const joursRestants = compte.subscriptionEndsAt
    ? (compte.subscriptionEndsAt.getTime() - maintenant.getTime()) / 86_400_000
    : 0;

  let dernierPaiement: typeof platformSubscriptions.$inferSelect | undefined;
  if (changeDePlan && joursRestants > 0) {
    [dernierPaiement] = await dbClient
      .select()
      .from(platformSubscriptions)
      .where(and(eq(platformSubscriptions.userId, record.userId), eq(platformSubscriptions.status, "PAID")))
      .orderBy(desc(platformSubscriptions.createdAt))
      .limit(1);
  }

  const { startDate, endDate } = calculerPeriodeActivation({
    maintenant,
    cycle: record.billingCycle === "ANNUAL" ? "ANNUAL" : "MONTHLY",
    changeDePlan,
    finActuelle: compte.subscriptionEndsAt,
    nouveauMontant: record.amount,
    // La devise de l'enregistrement, pas celle du compte aujourd'hui : c'est
    // dans celle-là que le montant a été fixé au moment de la souscription.
    nouvelleDevise: record.currency,
    dernierPaiement: dernierPaiement
      ? {
          amount: dernierPaiement.amount,
          startDate: dernierPaiement.startDate,
          billingCycle: dernierPaiement.billingCycle === "ANNUAL" ? "ANNUAL" : "MONTHLY",
          currency: dernierPaiement.currency,
          plan: dernierPaiement.plan,
        }
      : null,
    tarifPourDevise,
  });

  // Réclamation atomique : la transition PENDING → PAID est conditionnée au
  // statut lu plus haut. Sans cette garde, un rejeu de webhook (Stripe et
  // PayDunya documentent eux-mêmes rejouer leurs événements) ou un double clic
  // administrateur sur "confirmer le virement" pouvaient tous deux passer le
  // contrôle précédent (record.status === "PAID" au tout début de la
  // fonction) avant que l'un des deux n'ait committé, puis exécuter chacun
  // leur propre écriture. La condition ci-dessous fait qu'un seul de ces
  // appels concurrents peut effectivement faire progresser l'enregistrement ;
  // l'autre trouve 0 ligne affectée et se rabat sur le comportement idempotent
  // déjà prévu plus haut.
  const [updatedRecord] = await dbClient
    .update(platformSubscriptions)
    .set({ status: "PAID", startDate, endDate })
    .where(and(eq(platformSubscriptions.id, subscriptionId), eq(platformSubscriptions.status, "PENDING")))
    .returning();

  if (!updatedRecord) {
    // Un autre appel a gagné la course entre notre lecture et cette écriture.
    const [actuel] = await dbClient.select().from(platformSubscriptions).where(eq(platformSubscriptions.id, subscriptionId));
    if (actuel?.status === "PAID") return actuel;
    throw new ApiError(409, "Ce paiement vient d'être traité par une autre requête. Veuillez réessayer.");
  }

  // L'historique de facturation porte les dates corrigées : sans cela il
  // continuerait d'annoncer une période que le compte n'a pas eue.
  await dbClient
    .update(users)
    .set({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: record.plan,
      subscriptionEndsAt: endDate,
      subscriptionPaymentMethod: record.paymentMethod,
    })
    .where(eq(users.id, record.userId));

  return updatedRecord;
}
