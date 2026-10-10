import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import {
  activityLogs,
  adminAuditLogs,
  agencySettings,
  contracts,
  owners,
  platformSubscriptions,
  properties,
  tenants,
  users,
} from "../db/schema";
import { ADMIN_AUDIT_ACTIONS, logAdminAction } from "../services/adminAudit.service";
import { activateSubscriptionRecord } from "../services/subscriptionActivation.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { buildPaginatedResult, parsePagination } from "../utils/pagination";
import { computeSubscriptionInfo } from "./auth.controller";

/** Email d'un gestionnaire, pour l'instantané `targetLabel` du journal d'audit. */
async function emailDuGestionnaire(userId: string): Promise<string | null> {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  return user?.email ?? null;
}

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

  await logAdminAction({
    req,
    action: "subscription.bank_transfer.confirm",
    targetUserId: record.userId,
    targetLabel: await emailDuGestionnaire(record.userId),
    details: `Virement ${record.plan} de ${record.amount} ${record.currency} confirmé (réf. ${record.paymentRef ?? "—"})`,
  });

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

  // Réclamation atomique : la lecture ci-dessus et cette écriture ne sont pas
  // la même opération. Sans la condition sur le statut courant, un
  // administrateur qui confirme le virement (confirmBankTransfer, dans une
  // autre requête) entre notre lecture et notre écriture voyait son
  // activation — déjà committée, accès débloqué — silencieusement écrasée en
  // "REJECTED" par ce rejet arrivé une fraction de seconde plus tard : le
  // client gardait l'accès payant, mais son historique de facturation
  // affichait ce paiement comme rejeté, sans plus aucun moyen de le corriger
  // (activateSubscriptionRecord refuse explicitement de réactiver un
  // enregistrement REJECTED).
  const [updated] = await db
    .update(platformSubscriptions)
    .set({ status: "REJECTED" })
    .where(and(eq(platformSubscriptions.id, id), eq(platformSubscriptions.status, "PENDING")))
    .returning();

  if (!updated) {
    throw new ApiError(409, "Ce virement vient d'être traité par une autre requête. Veuillez rafraîchir la page.");
  }

  await logAdminAction({
    req,
    action: "subscription.bank_transfer.reject",
    targetUserId: record.userId,
    targetLabel: await emailDuGestionnaire(record.userId),
    details: `Virement ${record.plan} de ${record.amount} ${record.currency} rejeté (réf. ${record.paymentRef ?? "—"})`,
  });

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

  // Comptage porté par SQL (COUNT), pas par le chargement de chaque ligne en
  // mémoire pour n'en lire que la longueur — ce tableau de bord agrège TOUTE
  // la plateforme, tous gestionnaires confondus, contrairement aux écrans
  // scopés à une seule agence.
  const [{ count: totalProperties }] = await db.select({ count: sql<number>`count(*)::int` }).from(properties);
  const [{ count: totalTenants }] = await db.select({ count: sql<number>`count(*)::int` }).from(tenants);
  const [{ count: activeContracts }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contracts)
    .where(eq(contracts.status, "ACTIVE"));

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

/** Neutralise `%`, `_` et `\` pour qu'une recherche saisie soit lue littéralement dans un LIKE. */
function echapperLike(valeur: string): string {
  return valeur.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const listManagersQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  plan: z.enum(["STARTER", "PRO", "ENTERPRISE"]).optional(),
  status: z.enum(["TRIAL", "ACTIVE", "CANCELLED", "EXPIRED"]).optional(),
});

/**
 * Liste paginée des gestionnaires (comptes agence) pour l'administrateur, avec
 * recherche (email ou nom d'agence) et filtres par formule et par statut.
 *
 * Les collaborateurs invités (teamOwnerId renseigné) ne sont pas des clients de
 * la plateforme : ils sont exclus. Le statut filtré est le statut CALCULÉ
 * (computeSubscriptionInfo), pas la colonne en base, qui peut être obsolète
 * tant que l'utilisateur ne s'est pas reconnecté — d'où un filtrage en
 * mémoire après la requête SQL, puis la pagination.
 *
 * Aucune donnée sensible n'est renvoyée (hash de mot de passe, secrets 2FA,
 * jetons, coordonnées bancaires de l'agence…) : réponse par liste blanche.
 */
export const listManagers = asyncHandler(async (req: Request, res: Response) => {
  const parsed = listManagersQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ApiError(400, "Paramètres de recherche invalides");
  const { search, plan, status } = parsed.data;
  const pagination = parsePagination(req);

  const conditions = [eq(users.role, "MANAGER"), isNull(users.teamOwnerId)];
  if (plan) conditions.push(eq(users.subscriptionPlan, plan));
  if (search) {
    const motif = `%${echapperLike(search)}%`;
    const recherche = or(ilike(users.email, motif), ilike(agencySettings.agencyName, motif));
    if (recherche) conditions.push(recherche);
  }

  const rows = await db
    .select({ user: users, agencyName: agencySettings.agencyName })
    .from(users)
    .leftJoin(agencySettings, eq(agencySettings.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(users.createdAt));

  const enriched = rows
    .map(({ user, agencyName }) => ({ user, agencyName, info: computeSubscriptionInfo(user) }))
    .filter((r): r is typeof r & { info: NonNullable<typeof r.info> } => r.info !== null)
    .filter((r) => !status || r.info.status === status);

  const total = enriched.length;
  const pageRows = enriched.slice(pagination.offset, pagination.offset + pagination.pageSize);
  const pageIds = pageRows.map((r) => r.user.id);

  const countsFor = async (table: AnyPgTable, column: AnyPgColumn) => {
    if (pageIds.length === 0) return new Map<string, number>();
    const grouped = await db
      .select({ managerId: sql<string>`${column}`, count: sql<number>`count(*)::int` })
      .from(table)
      .where(inArray(column, pageIds))
      .groupBy(column);
    return new Map(grouped.map((g) => [g.managerId, g.count]));
  };
  const [propertyCounts, tenantCounts] = await Promise.all([
    countsFor(properties, properties.managerId),
    countsFor(tenants, tenants.managerId),
  ]);

  const items = pageRows.map(({ user, agencyName, info }) => ({
    id: user.id,
    email: user.email,
    agencyName: agencyName ?? null,
    plan: info.plan,
    status: info.status,
    trialEndsAt: info.trialEndsAt,
    subscriptionEndsAt: info.subscriptionEndsAt,
    propertiesCount: propertyCounts.get(user.id) ?? 0,
    tenantsCount: tenantCounts.get(user.id) ?? 0,
    createdAt: user.createdAt,
  }));

  res.json(buildPaginatedResult(items, total, pagination));
});

/**
 * Fiche détail d'un gestionnaire pour l'administrateur : abonnement (statut
 * calculé), volumétrie d'usage, dernière activité, identité publique de
 * l'agence et historique de facturation récent. Réponse par liste blanche :
 * ni hash, ni secret 2FA, ni jeton, ni IBAN/BIC de l'agence.
 * 404 pour un id inconnu, un administrateur ou un collaborateur invité.
 */
export const getManagerDetail = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.role, "MANAGER"), isNull(users.teamOwnerId)));
  if (!user) throw new ApiError(404, "Gestionnaire introuvable");

  const info = computeSubscriptionInfo(user);
  if (!info) throw new ApiError(404, "Gestionnaire introuvable");

  const countOf = async (table: AnyPgTable, column: AnyPgColumn) => {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(table)
      .where(eq(column, id));
    return row.count;
  };

  const [
    [agency],
    propertiesCount,
    tenantsCount,
    ownersCount,
    [{ count: activeContractsCount }],
    [{ count: collaboratorsCount }],
    [lastActivity],
    billing,
  ] = await Promise.all([
    db.select().from(agencySettings).where(eq(agencySettings.userId, id)),
    countOf(properties, properties.managerId),
    countOf(tenants, tenants.managerId),
    countOf(owners, owners.managerId),
    // Un contrat n'a pas de managerId propre : il appartient au gestionnaire
    // du bien qu'il couvre.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(contracts)
      .innerJoin(properties, eq(properties.id, contracts.propertyId))
      .where(and(eq(properties.managerId, id), eq(contracts.status, "ACTIVE"))),
    db.select({ count: sql<number>`count(*)::int` }).from(users).where(eq(users.teamOwnerId, id)),
    db
      .select({ createdAt: activityLogs.createdAt })
      .from(activityLogs)
      .where(eq(activityLogs.managerId, id))
      .orderBy(desc(activityLogs.createdAt))
      .limit(1),
    db
      .select()
      .from(platformSubscriptions)
      .where(eq(platformSubscriptions.userId, id))
      .orderBy(desc(platformSubscriptions.createdAt))
      .limit(10),
  ]);

  res.json({
    id: user.id,
    email: user.email,
    currency: user.currency,
    createdAt: user.createdAt,
    emailVerifiedAt: user.emailVerifiedAt,
    twoFactorEnabled: user.totpEnabledAt !== null,
    subscription: {
      status: info.status,
      plan: info.plan,
      trialEndsAt: info.trialEndsAt,
      subscriptionEndsAt: info.subscriptionEndsAt,
      trialDaysRemaining: info.trialDaysRemaining,
      paymentMethod: user.subscriptionPaymentMethod,
      autoRenew: user.stripeSubscriptionId !== null,
    },
    agency: agency
      ? {
          agencyName: agency.agencyName,
          phone: agency.phone,
          email: agency.email,
          address: agency.address,
          siretOrId: agency.siretOrId,
        }
      : null,
    usage: {
      properties: propertiesCount,
      tenants: tenantsCount,
      owners: ownersCount,
      activeContracts: activeContractsCount,
      collaborators: collaboratorsCount,
    },
    lastActivityAt: lastActivity?.createdAt ?? null,
    billingHistory: billing.map((b) => ({
      id: b.id,
      plan: b.plan,
      amount: b.amount,
      currency: b.currency,
      billingCycle: b.billingCycle,
      status: b.status,
      paymentMethod: b.paymentMethod,
      paymentRef: b.paymentRef,
      startDate: b.startDate,
      endDate: b.endDate,
      createdAt: b.createdAt,
    })),
  });
});

const listAuditLogsQuerySchema = z.object({
  action: z.enum(ADMIN_AUDIT_ACTIONS).optional(),
  targetUserId: z.string().min(1).max(100).optional(),
});

/**
 * Journal d'audit de l'administration, du plus récent au plus ancien,
 * paginé, filtrable par type d'action et par gestionnaire visé. Un paramètre
 * mal formé donne un 400 explicite plutôt que d'être ignoré : l'appelant ne
 * doit pas croire son filtre appliqué alors qu'il ne l'est pas.
 */
export const listAdminAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const parsed = listAuditLogsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ApiError(400, "Paramètres de recherche invalides");
  const { action, targetUserId } = parsed.data;
  const pagination = parsePagination(req);

  const conditions = [];
  if (action) conditions.push(eq(adminAuditLogs.action, action));
  if (targetUserId) conditions.push(eq(adminAuditLogs.targetUserId, targetUserId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count: total }] = await db.select({ count: sql<number>`count(*)::int` }).from(adminAuditLogs).where(where);
  const rows = await db
    .select()
    .from(adminAuditLogs)
    .where(where)
    .orderBy(desc(adminAuditLogs.createdAt), desc(adminAuditLogs.id))
    .limit(pagination.pageSize)
    .offset(pagination.offset);

  res.json(
    buildPaginatedResult(
      rows.map((r) => ({
        id: r.id,
        adminEmail: r.adminEmail,
        action: r.action,
        targetUserId: r.targetUserId,
        targetLabel: r.targetLabel,
        details: r.details,
        createdAt: r.createdAt,
      })),
      total,
      pagination
    )
  );
});
