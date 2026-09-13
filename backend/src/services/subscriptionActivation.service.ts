import { eq } from "drizzle-orm";
import { db, DbClient, Transaction } from "../db/client";
import { platformSubscriptions, users } from "../db/schema";

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

  const [updatedRecord] = await dbClient
    .update(platformSubscriptions)
    .set({ status: "PAID" })
    .where(eq(platformSubscriptions.id, subscriptionId))
    .returning();

  await dbClient
    .update(users)
    .set({
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: record.plan,
      subscriptionEndsAt: record.endDate,
      subscriptionPaymentMethod: record.paymentMethod,
    })
    .where(eq(users.id, record.userId));

  return updatedRecord;
}
