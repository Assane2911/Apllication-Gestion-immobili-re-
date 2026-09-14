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
      currency: platformSubscriptions.currency,
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
 * Rejette une demande de virement bancaire encore en attente : ne donne
 * jamais accès (contrairement à confirmBankTransfer, aucun appel à
 * activateSubscriptionRecord), marque simplement l'enregistrement REJECTED
 * pour qu'il disparaisse de la liste des virements en attente. Sert par
 * exemple à nettoyer une demande de test ou un virement annoncé mais jamais
 * reçu — sans quoi la seule option de l'administrateur était de laisser la
 * ligne PENDING indéfiniment ou de confirmer à tort un paiement fictif.
 */
export const rejectBankTransfer = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const [record] = await db.select().from(platformSubscriptions).where(eq(platformSubscriptions.id, id));
  if (!record) throw new ApiError(404, "Abonnement introuvable");
  if (record.paymentMethod !== "BANK_TRANSFER") {
    throw new ApiError(400, "Cette action n'est disponible que pour les paiements par virement bancaire");
  }
  if (record.status === "PAID") {
    throw new ApiError(400, "Ce virement a déjà été confirmé : impossible de le rejeter");
  }

  const [updated] = await db
    .update(platformSubscriptions)
    .set({ status: "REJECTED" })
    .where(eq(platformSubscriptions.id, id))
    .returning();

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

  // Le MRR est ventilé PAR DEVISE, et non additionné en un seul nombre : les
  // formules sont tarifées séparément dans chaque devise, sans taux de change
  // (voir TARIFS dans subscription.controller.ts). Additionner 15 000 FCFA et
  // 29 EUR produirait « 15 029 », un chiffre qui ne veut rien dire et sur
  // lequel on prendrait pourtant des décisions.
  const parDevise = new Map<string, { total: number; byPlan: Record<string, number>; contributors: number }>();
  for (const record of latestPaidByUser.values()) {
    const monthly = record.billingCycle === "ANNUAL" ? record.amount / 12 : record.amount;
    const devise = record.currency || "EUR";
    if (!parDevise.has(devise)) {
      parDevise.set(devise, { total: 0, byPlan: { STARTER: 0, PRO: 0, ENTERPRISE: 0 }, contributors: 0 });
    }
    const bloc = parDevise.get(devise)!;
    bloc.total += monthly;
    bloc.byPlan[record.plan] = (bloc.byPlan[record.plan] ?? 0) + monthly;
    bloc.contributors += 1;
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
      // Une entrée par devise réellement facturée, triée par montant
      // décroissant pour que la devise principale vienne en tête.
      byCurrency: [...parDevise.entries()]
        .map(([currency, bloc]) => ({
          currency,
          total: round2(bloc.total),
          byPlan: {
            STARTER: round2(bloc.byPlan.STARTER ?? 0),
            PRO: round2(bloc.byPlan.PRO ?? 0),
            ENTERPRISE: round2(bloc.byPlan.ENTERPRISE ?? 0),
          },
          contributors: bloc.contributors,
        }))
        .sort((a, b) => b.total - a.total),
      contributors: latestPaidByUser.size,
    },
    usage: {
      totalProperties,
      totalTenants,
      activeContracts,
    },
  });
});
