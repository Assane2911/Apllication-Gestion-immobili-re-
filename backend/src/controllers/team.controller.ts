import bcrypt from "bcryptjs";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { db } from "../db/client";
import { agencySettings, users } from "../db/schema";
import { logActivity } from "../services/activity.service";
import { sendEmail, teamInvitationEmail } from "../services/email.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { assertOwnership } from "../utils/authorization";
import { hashToken, RESET_TOKEN_TTL_MS } from "../utils/token";

/**
 * Gestion de l'équipe (multi-utilisateurs, formule Entreprise — CGU §3).
 *
 * Un collaborateur est un compte MANAGER à part entière (users.teamOwnerId
 * renseigné), qui se connecte avec son propre email/mot de passe : voir
 * identiteJetonPourManager (auth.controller.ts) pour la résolution du jeton.
 * Seul le PROPRIÉTAIRE de l'agence (jamais un collaborateur) peut inviter ou
 * révoquer un collaborateur — req.user.collaboratorId distingue les deux.
 */
function assertEstProprietaire(req: Request): void {
  if (!req.user) throw new ApiError(401, "Authentification requise");
  if (req.user.collaboratorId) {
    throw new ApiError(403, "Seul le gestionnaire propriétaire de l'agence peut gérer l'équipe.");
  }
}

/** Liste les collaborateurs de l'agence (propriétaire ou collaborateur : lecture ouverte à toute l'équipe). */
export const listTeamMembers = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");

  const collaborateurs = await db
    .select({
      id: users.id,
      email: users.email,
      createdAt: users.createdAt,
      // Un collaborateur qui n'a jamais posé de mot de passe (invitation pas
      // encore acceptée) a toujours un resetPasswordTokenHash en attente.
      accepted: users.resetPasswordTokenHash,
    })
    .from(users)
    .where(eq(users.teamOwnerId, req.user.userId));

  res.json(
    collaborateurs.map((c) => ({
      id: c.id,
      email: c.email,
      createdAt: c.createdAt,
      status: c.accepted ? "PENDING" : "ACTIVE",
    }))
  );
});

const inviteTeamMemberSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
});

export const inviteTeamMember = asyncHandler(async (req: Request, res: Response) => {
  assertEstProprietaire(req);
  const body = inviteTeamMemberSchema.parse(req.body);

  // Même contrôle que inviteOwnerPortalAccount/createTenantPortalAccount :
  // users.email est UNIQUE, donc un email déjà pris — quel que soit le
  // compte auquel il appartient — ne peut pas devenir un second compte.
  const [existing] = await db.select().from(users).where(eq(users.email, body.email));
  if (existing) {
    throw new ApiError(409, "Un compte existe déjà avec cet email");
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const resetPasswordTokenHash = hashToken(rawToken);
  const resetPasswordExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  // Mot de passe inutilisable en l'état (jamais communiqué) : seul le lien
  // d'invitation (token à usage unique ci-dessus) permet d'en poser un vrai,
  // via resetPassword — même principe que EMPREINTE_FACTICE côté login et
  // que inviteOwnerPortalAccount.
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);

  const [collaborateur] = await db
    .insert(users)
    .values({
      email: body.email,
      passwordHash,
      role: "MANAGER",
      teamOwnerId: req.user!.userId,
      hasPassword: false,
      // Confiance faite au gestionnaire propriétaire, qui a saisi cet email
      // lui-même — même principe que les comptes portail locataire/
      // propriétaire, jamais de double confirmation par email pour eux.
      emailVerifiedAt: new Date(),
      resetPasswordTokenHash,
      resetPasswordExpiresAt,
    })
    .returning();

  const [settings] = await db
    .select({ agencyName: agencySettings.agencyName })
    .from(agencySettings)
    .where(eq(agencySettings.userId, req.user!.userId));
  const [proprietaire] = await db.select().from(users).where(eq(users.id, req.user!.userId));

  const inviteUrl = `${env.frontendUrl}/reinitialiser-mot-de-passe?token=${rawToken}`;
  const { subject, html } = teamInvitationEmail({
    agencyName: settings?.agencyName || "Votre agence",
    ownerName: proprietaire?.email || "Votre gestionnaire",
    inviteUrl,
  });
  // Attendu avant la réponse : sur Vercel (serverless), l'exécution peut
  // s'arrêter juste après l'envoi de la réponse, avant qu'un envoi non
  // attendu ait eu le temps de partir (même bug déjà corrigé ailleurs — voir
  // errorHandler.ts). `.catch()` garantit quand même que l'échec de l'email
  // ne fait jamais échouer la création du compte collaborateur.
  await sendEmail(body.email, subject, html).catch((err) => {
    console.error("[team] Échec de l'envoi de l'email d'invitation:", err);
  });

  await logActivity({
    req,
    managerId: req.user!.userId,
    action: "team.invite",
    entityType: "team_member",
    entityId: collaborateur.id,
    entityLabel: body.email,
    details: `Invitation envoyée à ${body.email} pour rejoindre l'équipe`,
  });

  res.status(201).json({ id: collaborateur.id, email: collaborateur.email, status: "PENDING" });
});

export const removeTeamMember = asyncHandler(async (req: Request, res: Response) => {
  assertEstProprietaire(req);

  const [collaborateur] = await db.select().from(users).where(eq(users.id, req.params.id));
  // teamOwnerId est nullable (tout compte n'a pas de propriétaire d'équipe) :
  // le replier sur une chaîne vide, qui ne peut jamais égaler un vrai id,
  // préserve le refus déjà obtenu par le `!==` d'origine.
  assertOwnership(collaborateur, (c) => c.teamOwnerId ?? "", req.user!.userId, "Collaborateur introuvable");

  // Révoque immédiatement toute session déjà ouverte (même si le compte est
  // supprimé juste après) : le futur `authenticate` d'un jeton déjà émis
  // échouerait de toute façon sur "compte introuvable", mais un abandon
  // prématuré de la requête ne doit pas laisser un accès actif.
  await db.delete(users).where(eq(users.id, collaborateur.id));

  await logActivity({
    req,
    managerId: req.user!.userId,
    action: "team.remove",
    entityType: "team_member",
    entityId: collaborateur.id,
    entityLabel: collaborateur.email,
    details: `Accès révoqué pour ${collaborateur.email}`,
  });

  res.status(204).send();
});
