import { and, desc, eq, inArray } from "drizzle-orm";
import { Request, Response } from "express";
import { db } from "../db/client";
import { agencySettings, contracts, platformSubscriptions, properties, tenants, users } from "../db/schema";
import { activateSubscriptionRecord } from "../services/subscriptionActivation.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { computeSubscriptionInfo } from "./auth.controller";

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

/**
 * Tableau de bord de pilotage de la plateforme (vue d'ensemble pour
 * l'administrateur) : santé du portefeuille de gestionnaires (essai / abonnement
 * payant actif / sans accès), revenu récurrent mensuel (MRR) estimé à partir du
 * dernier paiement confirmé de chaque abonnement payant, essais sur le point de
 * se terminer sans abonnement payant derrière (relance commerciale), et volume
 * global d'usage (biens/locataires/contrats) tous gestionnaires confondus.
 *
 * Le statut d'abonnement stocké sur `users` (TRIAL/ACTIVE/...) peut être
 * obsolète (un essai ou un abonnement expiré n'est réévalué qu'à la connexion
 * de l'utilisateur) : on réutilise donc `computeSubscriptionInfo`, la même
 * logique que celle qui détermine réellement l'accès, plutôt que de faire
 * confiance telle quelle à la colonne en base.
 */
export const getPlatformDashboardStats = asyncHandler(async (_req: Request, res: Response) => {
  const managers = await db.select().from(users).where(eq(users.role, "MANAGER"));

  let trialActive = 0;
  let subscriptionActive = 0;
  let expired = 0;
  const activeManagerIds: string[] = [];
  const trialsEndingSoon: { userId: string; email: string; trialEndsAt: Date | null; daysRemaining: number }[] = [];

  for (const manager of managers) {
    const info = computeSubscriptionInfo(manager);
    if (!info) continue;

    if (info.isSubscriptionActive) {
      subscriptionActive += 1;
      activeManagerIds.push(manager.id);
    } else if (info.isTrialActive) {
      trialActive += 1;
      if (info.trialDaysRemaining <= 7) {
        trialsEndingSoon.push({
          userId: manager.id,
          email: manager.email,
          trialEndsAt: manager.trialEndsAt,
          daysRemaining: info.trialDaysRemaining,
        });
      }
    } else {
      expired += 1;
    }
  }
  trialsEndingSoon.sort((a, b) => a.daysRemaining - b.daysRemaining);
  const soonestTrials = trialsEndingSoon.slice(0, 10);

  // Nom d'agence des essais bientôt terminés, quand il a été renseigné (la
  // fiche agence n'existe que si le gestionnaire a déjà ouvert cette page).
  const soonTrialUserIds = soonestTrials.map((t) => t.userId);
  const agencies =
    soonTrialUserIds.length > 0
      ? await db.select().from(agencySettings).where(inArray(agencySettings.userId, soonTrialUserIds))
      : [];
  const agencyNameByUserId = new Map(agencies.map((a) => [a.userId, a.agencyName]));

  // MRR : `users` ne conserve que le plan courant et sa date de fin, pas le
  // montant ni la périodicité réellement payés — on va donc chercher le
  // dernier paiement confirmé (PAID) de chaque abonnement payant actif dans
  // l'historique de facturation, et on ramène un abonnement annuel à un
  // équivalent mensuel (÷ 12) pour pouvoir les additionner entre eux.
  const paidRecords =
    activeManagerIds.length > 0
      ? await db
          .select()
          .from(platformSubscriptions)
          .where(and(inArray(platformSubscriptions.userId, activeManagerIds), eq(platformSubscriptions.status, "PAID")))
          .orderBy(desc(platformSubscriptions.createdAt))
      : [];
  const latestPaidByUser = new Map<string, (typeof paidRecords)[number]>();
  for (const record of paidRecords) {
    if (!latestPaidByUser.has(record.userId)) {
      latestPaidByUser.set(record.userId, record);
    }
  }

  const mrrByPlan: Record<string, number> = { STARTER: 0, PRO: 0, ENTERPRISE: 0 };
  let mrrTotal = 0;
  for (const record of latestPaidByUser.values()) {
    const monthly = record.billingCycle === "ANNUAL" ? record.amount / 12 : record.amount;
    mrrByPlan[record.plan] = (mrrByPlan[record.plan] ?? 0) + monthly;
    mrrTotal += monthly;
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const totalProperties = (await db.select({ id: properties.id }).from(properties)).length;
  const totalTenants = (await db.select({ id: tenants.id }).from(tenants)).length;
  const activeContracts = (
    await db.select({ id: contracts.id }).from(contracts).where(eq(contracts.status, "ACTIVE"))
  ).length;

  res.json({
    managers: {
      total: managers.length,
      trialActive,
      subscriptionActive,
      expired,
    },
    trialsEndingSoon: soonestTrials.map((t) => ({
      ...t,
      agencyName: agencyNameByUserId.get(t.userId) ?? null,
    })),
    mrr: {
      total: round2(mrrTotal),
      byPlan: {
        STARTER: round2(mrrByPlan.STARTER ?? 0),
        PRO: round2(mrrByPlan.PRO ?? 0),
        ENTERPRISE: round2(mrrByPlan.ENTERPRISE ?? 0),
      },
      contributors: latestPaidByUser.size,
    },
    usage: {
      totalProperties,
      totalTenants,
      activeContracts,
    },
  });
});
