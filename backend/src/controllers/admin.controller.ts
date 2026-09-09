import { and, desc, eq } from "drizzle-orm";
import { Request, Response } from "express";
import { db } from "../db/client";
import { platformSubscriptions, users } from "../db/schema";
import { activateSubscriptionRecord } from "../services/subscriptionActivation.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";

/**
 * Liste les abonnements SaaS réglés par virement bancaire et toujours en
 * attente de confirmation. C'est le seul moyen de paiement qui ne dispose
 * d'aucune confirmation automatique (contrairement à PayDunya, confirmé par
 * webhook) — un administrateur doit vérifier manuellement que le virement
 * est bien arrivé sur le compte bancaire de la plateforme avant de valider.
 */
export const listPendingBankTransfers = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: platformSubscriptions.id,
      userId: platformSubscriptions.userId,
      managerEmail: users.email,
      plan: platformSubscriptions.plan,
      amount: platformSubscriptions.amount,
      billingCycle: platformSubscriptions.billingCycle,
      paymentRef: platformSubscriptions.paymentRef,
      startDate: platformSubscriptions.startDate,
      endDate: platformSubscriptions.endDate,
      createdAt: platformSubscriptions.createdAt,
    })
    .from(platformSubscriptions)
    .innerJoin(users, eq(users.id, platformSubscriptions.userId))
    .where(and(eq(platformSubscriptions.status, "PENDING"), eq(platformSubscriptions.paymentMethod, "BANK_TRANSFER")))
    .orderBy(desc(platformSubscriptions.createdAt));

  res.json(rows);
});

/**
 * Confirme manuellement la réception d'un virement bancaire : active
 * réellement l'abonnement du gestionnaire concerné (accès débloqué,
 * historique de paiement marqué PAID). Action à n'utiliser qu'après
 * vérification que le virement est bien arrivé sur le compte bancaire de la
 * plateforme — elle donne un accès payant sans autre garde-fou côté serveur.
 */
export const confirmBankTransfer = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const [record] = await db.select().from(platformSubscriptions).where(eq(platformSubscriptions.id, id));
  if (!record) throw new ApiError(404, "Abonnement introuvable");
  if (record.paymentMethod !== "BANK_TRANSFER") {
    throw new ApiError(400, "Cette action n'est disponible que pour les paiements par virement bancaire");
  }

  const updated = await activateSubscriptionRecord(id);

  res.json({ success: true, record: updated });
});
