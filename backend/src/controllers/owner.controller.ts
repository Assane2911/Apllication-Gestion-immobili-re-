import bcrypt from "bcryptjs";
import crypto from "crypto";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { db, Transaction } from "../db/client";
import { agencySettings, contracts, invoices, owners, properties, users } from "../db/schema";
import { ownerInvitationEmail, sendEmail } from "../services/email.service";
import { logActivity } from "../services/activity.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { assertOwnership } from "../utils/authorization";
import { buildPaginatedResult, parsePagination } from "../utils/pagination";
import { CIVILITES, nomAvecCivilite } from "../utils/nom";
import { MESSAGE_TELEPHONE_INVALIDE, versE164 } from "../utils/phone";
import { hashToken, RESET_TOKEN_TTL_MS } from "../utils/token";

// Champs déjà présents en base (voir schema.ts) — créés directement en SQL en
// parallèle de ce chantier, avant que l'Espace propriétaire (résumé financier
// en lecture seule) ne soit construit dessus. On les expose tous en CRUD ici
// plutôt que de se limiter au sous-ensemble prévu initialement (nom/email/
// téléphone), pour ne pas perdre ce qui existe déjà (coordonnées bancaires,
// taux de commission...).
const ownerSchema = z.object({
  // Facultative : un propriétaire peut être une société (voir companyName),
  // auquel cas « Monsieur » n'a aucun sens.
  civility: z.enum(CIVILITES).optional().nullable(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  companyName: z.string().optional(),
  // Même exigence que pour les locataires : format international à
  // l'enregistrement, voir tenant.controller.ts.
  phone: z
    .string()
    .refine((v) => versE164(v) !== null, MESSAGE_TELEPHONE_INVALIDE)
    .transform((v) => versE164(v)!),
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
  address: z.string().optional(),
  iban: z.string().optional(),
  bic: z.string().optional(),
  managementFeeRate: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().optional(),
});

/**
 * Statut de l'accès au portail propriétaire, dérivé de owners.userId et de
 * users.resetPasswordTokenHash (jamais exposé tel quel au frontend) :
 *  - NONE : aucun compte "portail" créé (owner.userId est null)
 *  - PENDING : compte créé par inviteOwnerPortalAccount, en attente que le
 *    propriétaire pose son mot de passe via le lien de réinitialisation
 *  - ACTIVE : mot de passe déjà posé (resetPasswordTokenHash retombé à null,
 *    voir resetPassword dans auth.controller.ts)
 */
type PortalStatus = "NONE" | "PENDING" | "ACTIVE";

function computePortalStatus(ownerUserId: string | null, resetPasswordTokenHash: string | null | undefined): PortalStatus {
  if (!ownerUserId) return "NONE";
  return resetPasswordTokenHash ? "PENDING" : "ACTIVE";
}

export const listOwners = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);
  const whereClause = eq(owners.managerId, req.user!.userId);

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({ owner: owners, resetPasswordTokenHash: users.resetPasswordTokenHash })
      .from(owners)
      .leftJoin(users, eq(users.id, owners.userId))
      .where(whereClause)
      .orderBy(desc(owners.createdAt))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(owners).where(whereClause),
  ]);

  const items = rows.map(({ owner, resetPasswordTokenHash }) => ({
    ...owner,
    portalStatus: computePortalStatus(owner.userId, resetPasswordTokenHash),
  }));

  res.json(buildPaginatedResult(items, count, pagination));
});

export const getOwner = asyncHandler(async (req: Request, res: Response) => {
  const [row] = await db
    .select({ owner: owners, resetPasswordTokenHash: users.resetPasswordTokenHash })
    .from(owners)
    .leftJoin(users, eq(users.id, owners.userId))
    .where(eq(owners.id, req.params.id));
  assertOwnership(row, (r) => r.owner.managerId, req.user!.userId, "Propriétaire introuvable");

  const ownerProperties = await db.select().from(properties).where(eq(properties.ownerId, row.owner.id));

  res.json({
    ...row.owner,
    portalStatus: computePortalStatus(row.owner.userId, row.resetPasswordTokenHash),
    properties: ownerProperties,
  });
});

export const createOwner = asyncHandler(async (req: Request, res: Response) => {
  const body = ownerSchema.parse(req.body);

  // Contrairement à tenants, la base n'a pas de contrainte d'unicité
  // (managerId, email) sur owners (voir schema.ts) : ce contrôle n'est donc
  // qu'applicatif, pas garanti sous concurrence — même limite que si on
  // l'avait laissé sans aucun contrôle, mais couvre le cas courant.
  const [existing] = await db
    .select()
    .from(owners)
    .where(sql`${owners.managerId} = ${req.user!.userId} and ${owners.email} = ${body.email}`);
  if (existing) throw new ApiError(409, "Un propriétaire avec cet email existe déjà");

  const [owner] = await db
    .insert(owners)
    .values({ ...body, managerId: req.user!.userId })
    .returning();

  await logActivity({
    req,
    managerId: owner.managerId,
    action: "owner.create",
    entityType: "owner",
    entityId: owner.id,
    entityLabel: `${owner.firstName} ${owner.lastName}`,
    details: `Propriétaire ajouté : ${owner.firstName} ${owner.lastName} (${owner.email})`,
  });

  res.status(201).json(owner);
});

export const updateOwner = asyncHandler(async (req: Request, res: Response) => {
  const body = ownerSchema.partial().parse(req.body);

  const [existing] = await db.select().from(owners).where(eq(owners.id, req.params.id));
  assertOwnership(existing, (e) => e.managerId, req.user!.userId, "Propriétaire introuvable");

  const [owner] = await db.update(owners).set(body).where(eq(owners.id, req.params.id)).returning();

  await logActivity({
    req,
    managerId: owner.managerId,
    action: "owner.update",
    entityType: "owner",
    entityId: owner.id,
    entityLabel: `${owner.firstName} ${owner.lastName}`,
    details: `Propriétaire modifié : ${owner.firstName} ${owner.lastName}`,
  });

  res.json(owner);
});

export const deleteOwner = asyncHandler(async (req: Request, res: Response) => {
  const [existing] = await db.select().from(owners).where(eq(owners.id, req.params.id));
  assertOwnership(existing, (e) => e.managerId, req.user!.userId, "Propriétaire introuvable");

  const linkedProperties = await db.select().from(properties).where(eq(properties.ownerId, req.params.id));
  if (linkedProperties.length > 0) {
    throw new ApiError(
      409,
      "Impossible de supprimer un propriétaire associé à un ou plusieurs biens. Retirez d'abord l'association sur ces biens."
    );
  }

  await db.delete(owners).where(eq(owners.id, req.params.id));

  await logActivity({
    req,
    managerId: existing.managerId,
    action: "owner.delete",
    entityType: "owner",
    entityId: existing.id,
    entityLabel: `${existing.firstName} ${existing.lastName}`,
    details: `Propriétaire supprimé : ${existing.firstName} ${existing.lastName}`,
  });

  res.status(204).send();
});

/**
 * Le gestionnaire invite un propriétaire à activer son accès au portail
 * (Espace propriétaire, résumé financier en lecture seule). Contrairement au
 * portail locataire (mot de passe choisi par le gestionnaire, voir
 * createTenantPortalAccount), le propriétaire choisit lui-même son mot de
 * passe : on réutilise exactement le mécanisme de réinitialisation de mot de
 * passe (token à usage unique, 1h, voir auth.controller.ts) plutôt que d'en
 * inventer un second.
 *
 * Rappelable tant que l'invitation n'a pas été activée (le token de reset est
 * régénéré et renvoyé) ; une fois le mot de passe défini, resetPasswordTokenHash
 * repasse à null (voir resetPassword) et une nouvelle invitation est refusée.
 */
export const inviteOwnerPortalAccount = asyncHandler(async (req: Request, res: Response) => {
  const [owner] = await db.select().from(owners).where(eq(owners.id, req.params.id));
  assertOwnership(owner, (o) => o.managerId, req.user!.userId, "Propriétaire introuvable");

  const rawToken = crypto.randomBytes(32).toString("hex");
  const resetPasswordTokenHash = hashToken(rawToken);
  const resetPasswordExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  let targetUserId: string;

  if (owner.userId) {
    const [existingUser] = await db.select().from(users).where(eq(users.id, owner.userId));
    if (!existingUser) throw new ApiError(404, "Compte du portail propriétaire introuvable");
    if (!existingUser.resetPasswordTokenHash) {
      throw new ApiError(409, "Un accès au portail existe déjà pour ce propriétaire");
    }
    await db
      .update(users)
      .set({ resetPasswordTokenHash, resetPasswordExpiresAt })
      .where(eq(users.id, existingUser.id));
    targetUserId = existingUser.id;
  } else {
    const [existingUserWithEmail] = await db.select().from(users).where(eq(users.email, owner.email));
    if (existingUserWithEmail) {
      throw new ApiError(409, "Un compte existe déjà avec cet email — impossible de créer l'accès portail");
    }

    // Mot de passe inutilisable en l'état (jamais communiqué) : seul le lien
    // d'invitation (token à usage unique ci-dessus) permet d'en poser un
    // vrai, via resetPassword — même principe que EMPREINTE_FACTICE côté login.
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);

    // Les deux écritures doivent réussir ensemble, comme
    // createTenantPortalAccount : sans transaction, un échec de la seconde
    // laisserait un compte "OWNER" valide jamais relié à aucune fiche propriétaire.
    const created = await db.transaction(async (tx: Transaction) => {
      const [user] = await tx
        .insert(users)
        .values({ email: owner.email, passwordHash, role: "OWNER", resetPasswordTokenHash, resetPasswordExpiresAt })
        .returning();
      await tx.update(owners).set({ userId: user.id }).where(eq(owners.id, owner.id));
      return user;
    });
    targetUserId = created.id;
  }

  const [settings] = await db
    .select({ agencyName: agencySettings.agencyName })
    .from(agencySettings)
    .where(eq(agencySettings.userId, req.user!.userId));

  const inviteUrl = `${env.frontendUrl}/reinitialiser-mot-de-passe?token=${rawToken}`;
  const { subject, html } = ownerInvitationEmail({
    ownerName: nomAvecCivilite(owner),
    agencyName: settings?.agencyName || "Votre agence",
    inviteUrl,
  });
  sendEmail(owner.email, subject, html).catch((err) => {
    console.error("[owners] Échec de l'envoi de l'email d'invitation:", err);
  });

  await logActivity({
    req,
    managerId: owner.managerId,
    action: "owner.invite",
    entityType: "owner",
    entityId: owner.id,
    entityLabel: `${owner.firstName} ${owner.lastName}`,
    details: `Invitation envoyée au propriétaire : ${owner.firstName} ${owner.lastName} (${owner.email})`,
  });

  res.json({ message: "Invitation envoyée", userId: targetUserId });
});

/**
 * Résumé financier en lecture seule pour le propriétaire connecté (Espace
 * propriétaire) : loyer perçu / en attente ce mois-ci pour chacun de ses
 * biens, plus un historique 6 mois — volontairement sans contrats, factures
 * détaillées, documents ni identité des locataires (voir la décision de
 * périmètre prise avec l'utilisateur : "résumé financier seulement").
 *
 * Même construction que getDashboardStats (dashboard.controller.ts), scopée
 * par properties.ownerId au lieu de properties.managerId, et bucketée par
 * devise (jamais sommée à travers des devises différentes — même règle que
 * partout ailleurs dans l'app).
 */
export const getOwnerDashboard = asyncHandler(async (req: Request, res: Response) => {
  const ownerId = req.user!.ownerId;
  if (!ownerId) throw new ApiError(404, "Aucune fiche propriétaire associée à ce compte");

  const [owner] = await db.select().from(owners).where(eq(owners.id, ownerId));
  if (!owner) throw new ApiError(404, "Fiche propriétaire introuvable");

  const ownerProperties = await db.select().from(properties).where(eq(properties.ownerId, ownerId));
  const propertyIds = ownerProperties.map((p: typeof properties.$inferSelect) => p.id);

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const sixMonthsAgo = new Date(year, month - 6, 1);

  const ownerContracts =
    propertyIds.length > 0
      ? await db.select().from(contracts).where(inArray(contracts.propertyId, propertyIds))
      : [];
  const contractIdToPropertyId = new Map(
    ownerContracts.map((c: typeof contracts.$inferSelect) => [c.id, c.propertyId])
  );
  const contractIds = ownerContracts.map((c: typeof contracts.$inferSelect) => c.id);

  const [monthlyInvoices, recentPaidInvoices] =
    contractIds.length > 0
      ? await Promise.all([
          db
            .select()
            .from(invoices)
            .where(
              and(
                inArray(invoices.contractId, contractIds),
                eq(invoices.periodMonth, month),
                eq(invoices.periodYear, year)
              )
            ),
          db
            .select()
            .from(invoices)
            .where(
              and(
                inArray(invoices.contractId, contractIds),
                eq(invoices.status, "PAID"),
                gte(invoices.paidAt, sixMonthsAgo)
              )
            ),
        ])
      : [[], []];

  // Détail par bien : perçu / en attente ce mois-ci (une devise par bien —
  // voir contracts/invoices, qui héritent la devise du bien à leur création).
  const perProperty = new Map<
    string,
    { propertyId: string; title: string; address: string; currency: string; collected: number; pending: number }
  >();
  for (const p of ownerProperties) {
    perProperty.set(p.id, {
      propertyId: p.id,
      title: p.title,
      address: p.address,
      currency: p.currency,
      collected: 0,
      pending: 0,
    });
  }
  for (const inv of monthlyInvoices) {
    const propertyId = contractIdToPropertyId.get(inv.contractId);
    const entry = propertyId ? perProperty.get(propertyId) : undefined;
    if (!entry) continue;
    if (inv.status === "PAID") entry.collected += inv.amount;
    else if (inv.status === "PENDING" || inv.status === "LATE") entry.pending += inv.amount;
  }

  // Totaux, groupés par devise plutôt que sommés à travers des devises différentes.
  const collectedThisMonthByCurrency: Record<string, number> = {};
  const pendingThisMonthByCurrency: Record<string, number> = {};
  for (const entry of perProperty.values()) {
    if (entry.collected > 0) {
      collectedThisMonthByCurrency[entry.currency] = (collectedThisMonthByCurrency[entry.currency] ?? 0) + entry.collected;
    }
    if (entry.pending > 0) {
      pendingThisMonthByCurrency[entry.currency] = (pendingThisMonthByCurrency[entry.currency] ?? 0) + entry.pending;
    }
  }

  const revenueByMonth: Record<string, Record<string, number>> = {};
  for (const inv of recentPaidInvoices) {
    const key = `${inv.periodYear}-${String(inv.periodMonth).padStart(2, "0")}`;
    const currency = inv.currency || "EUR";
    revenueByMonth[key] = revenueByMonth[key] ?? {};
    revenueByMonth[key][currency] = (revenueByMonth[key][currency] ?? 0) + inv.amount;
  }

  res.json({
    ownerName: nomAvecCivilite(owner),
    managementFeeRate: owner.managementFeeRate,
    properties: Array.from(perProperty.values()),
    collectedThisMonthByCurrency,
    pendingThisMonthByCurrency,
    revenueByMonth,
  });
});
