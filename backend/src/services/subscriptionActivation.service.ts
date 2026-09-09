import { eq } from "drizzle-orm";
import { db, DbClient } from "../db/client";
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
 */
export async function activateSubscriptionRecord(subscriptionId: string, dbClient: DbClient = db) {
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
