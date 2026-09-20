import bcrypt from "bcryptjs";
import crypto from "crypto";
import { desc, eq, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { db, Transaction } from "../db/client";
import { agencySettings, owners, properties, users } from "../db/schema";
import { ownerInvitationEmail, sendEmail } from "../services/email.service";
import { logActivity } from "../services/activity.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { buildPaginatedResult, parsePagination } from "../utils/pagination";
import { hashToken, RESET_TOKEN_TTL_MS } from "../utils/token";

// Champs déjà présents en base (voir schema.ts) — créés directement en SQL en
// parallèle de ce chantier, avant que l'Espace propriétaire (résumé financier
// en lecture seule) ne soit construit dessus. On les expose tous en CRUD ici
// plutôt que de se limiter au sous-ensemble prévu initialement (nom/email/
// téléphone), pour ne pas perdre ce qui existe déjà (coordonnées bancaires,
// taux de commission...).
const ownerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  companyName: z.string().optional(),
  phone: z.string().min(6),
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
  address: z.string().optional(),
  iban: z.string().optional(),
  bic: z.string().optional(),
  managementFeeRate: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().optional(),
});

export const listOwners = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);
  const whereClause = eq(owners.managerId, req.user!.userId);

  const [rows, [{ count }]] = await Promise.all([
    db
      .select()
      .from(owners)
      .where(whereClause)
      .orderBy(desc(owners.createdAt))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(owners).where(whereClause),
  ]);

  res.json(buildPaginatedResult(rows, count, pagination));
});

export const getOwner = asyncHandler(async (req: Request, res: Response) => {
  const [owner] = await db.select().from(owners).where(eq(owners.id, req.params.id));
  if (!owner || owner.managerId !== req.user!.userId) throw new ApiError(404, "Propriétaire introuvable");

  const ownerProperties = await db.select().from(properties).where(eq(properties.ownerId, owner.id));

  res.json({ ...owner, properties: ownerProperties });
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
  if (!existing || existing.managerId !== req.user!.userId) throw new ApiError(404, "Propriétaire introuvable");

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
  if (!existing || existing.managerId !== req.user!.userId) throw new ApiError(404, "Propriétaire introuvable");

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
  if (!owner || owner.managerId !== req.user!.userId) throw new ApiError(404, "Propriétaire introuvable");

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
    ownerName: `${owner.firstName} ${owner.lastName}`,
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
