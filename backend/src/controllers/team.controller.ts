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
import {
  LIBELLES_ROLES_EQUIPE,
  ROLES_EQUIPE,
  ROLE_EQUIPE_INVITATION_PAR_DEFAUT,
  roleEquipeEffectif,
} from "../utils/rolesEquipe";
import { hashToken, INVITATION_TOKEN_TTL_MS } from "../utils/token";

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
  if (!req.user) throw new ApiError(401, "Authentification requise", "AUTH_REQUIRED");
  if (req.user.collaboratorId) {
    throw new ApiError(403, "Seul le gestionnaire propriétaire de l'agence peut gérer l'équipe.");
  }
}

/** Liste les collaborateurs de l'agence (propriétaire ou collaborateur : lecture ouverte à toute l'équipe). */
export const listTeamMembers = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise", "AUTH_REQUIRED");

  const collaborateurs = await db
    .select({
      id: users.id,
      email: users.email,
      createdAt: users.createdAt,
      teamRole: users.teamRole,
      // Invitation pas encore acceptée = aucun mot de passe posé (hasPassword) ET un lien en attente. Le lien
      // seul ne suffisait pas : un collaborateur actif qui demande « mot de passe oublié » en a un aussi.
      hasPassword: users.hasPassword,
      lien: users.resetPasswordTokenHash,
      lienExpireLe: users.resetPasswordExpiresAt,
    })
    .from(users)
    .where(eq(users.teamOwnerId, req.user.userId));

  const maintenant = Date.now();
  res.json(
    collaborateurs.map((c) => {
      const enAttente = !c.hasPassword && !!c.lien;
      return {
        id: c.id,
        email: c.email,
        createdAt: c.createdAt,
        role: roleEquipeEffectif(c.teamRole),
        status: enAttente ? "PENDING" : "ACTIVE",
        // Lien d'invitation périmé : le propriétaire peut le renvoyer (POST /team/:id/resend).
        expired: enAttente && (!c.lienExpireLe || c.lienExpireLe.getTime() < maintenant),
      };
    })
  );
});

/**
 * Envoie (ou renvoie) l'email d'invitation à rejoindre l'agence : lien à usage unique valable
 * INVITATION_TOKEN_TTL_MS, pour choisir son mot de passe (voir resetPassword).
 */
async function envoyerInvitationEquipe(proprietaireId: string, email: string, rawToken: string) {
  const [settings] = await db
    .select({ agencyName: agencySettings.agencyName })
    .from(agencySettings)
    .where(eq(agencySettings.userId, proprietaireId));
  const [proprietaire] = await db.select().from(users).where(eq(users.id, proprietaireId));

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
  // ne fait jamais échouer l'action appelante.
  await sendEmail(email, subject, html).catch((err) => {
    console.error("[team] Échec de l'envoi de l'email d'invitation:", err);
  });
}

const inviteTeamMemberSchema = z.object({
  email: z.string().max(254, "L'adresse email est trop longue").email().transform((v) => v.trim().toLowerCase()),
  role: z.enum(ROLES_EQUIPE).default(ROLE_EQUIPE_INVITATION_PAR_DEFAUT),
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
  const resetPasswordExpiresAt = new Date(Date.now() + INVITATION_TOKEN_TTL_MS);
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
      teamRole: body.role,
      hasPassword: false,
      // Confiance faite au gestionnaire propriétaire, qui a saisi cet email
      // lui-même — même principe que les comptes portail locataire/
      // propriétaire, jamais de double confirmation par email pour eux.
      emailVerifiedAt: new Date(),
      resetPasswordTokenHash,
      resetPasswordExpiresAt,
    })
    .returning();

  await envoyerInvitationEquipe(req.user!.userId, body.email, rawToken);

  await logActivity({
    req,
    managerId: req.user!.userId,
    action: "team.invite",
    entityType: "team_member",
    entityId: collaborateur.id,
    entityLabel: body.email,
    details: `Invitation envoyée à ${body.email} pour rejoindre l'équipe (rôle : ${LIBELLES_ROLES_EQUIPE[body.role]})`,
  });

  res.status(201).json({ id: collaborateur.id, email: collaborateur.email, role: body.role, status: "PENDING" });
});

const changerRoleSchema = z.object({ role: z.enum(ROLES_EQUIPE) });

/** Change le rôle d'un collaborateur. Propriétaire seul ; effet immédiat (le rôle est relu à chaque requête). */
export const updateTeamMemberRole = asyncHandler(async (req: Request, res: Response) => {
  assertEstProprietaire(req);
  const body = changerRoleSchema.parse(req.body);

  const [collaborateur] = await db.select().from(users).where(eq(users.id, req.params.id));
  assertOwnership(collaborateur, (c) => c.teamOwnerId ?? "", req.user!.userId, "Collaborateur introuvable", 404, "COLLABORATOR_NOT_FOUND");

  await db.update(users).set({ teamRole: body.role }).where(eq(users.id, collaborateur.id));

  await logActivity({
    req,
    managerId: req.user!.userId,
    action: "team.role",
    entityType: "team_member",
    entityId: collaborateur.id,
    entityLabel: collaborateur.email,
    details: `Rôle de ${collaborateur.email} : ${LIBELLES_ROLES_EQUIPE[roleEquipeEffectif(collaborateur.teamRole)]} → ${LIBELLES_ROLES_EQUIPE[body.role]}`,
  });

  res.json({ id: collaborateur.id, email: collaborateur.email, role: body.role });
});

export const removeTeamMember = asyncHandler(async (req: Request, res: Response) => {
  assertEstProprietaire(req);

  const [collaborateur] = await db.select().from(users).where(eq(users.id, req.params.id));
  // teamOwnerId est nullable (tout compte n'a pas de propriétaire d'équipe) :
  // le replier sur une chaîne vide, qui ne peut jamais égaler un vrai id,
  // préserve le refus déjà obtenu par le `!==` d'origine.
  assertOwnership(collaborateur, (c) => c.teamOwnerId ?? "", req.user!.userId, "Collaborateur introuvable", 404, "COLLABORATOR_NOT_FOUND");

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

/**
 * Renvoie l'invitation d'un collaborateur qui ne l'a pas encore acceptée (lien perdu ou périmé) : nouveau lien,
 * l'ancien cesse de fonctionner. Sans cela, l'email restait réservé (un compte existe déjà) et le propriétaire ne
 * pouvait que supprimer puis réinviter, sans rien lui dire qu'une invitation était périmée.
 */
export const resendTeamInvitation = asyncHandler(async (req: Request, res: Response) => {
  assertEstProprietaire(req);

  const [collaborateur] = await db.select().from(users).where(eq(users.id, req.params.id));
  assertOwnership(collaborateur, (c) => c.teamOwnerId ?? "", req.user!.userId, "Collaborateur introuvable", 404, "COLLABORATOR_NOT_FOUND");

  if (collaborateur.hasPassword || !collaborateur.resetPasswordTokenHash) {
    throw new ApiError(409, "Cette invitation a déjà été acceptée.");
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  await db
    .update(users)
    .set({ resetPasswordTokenHash: hashToken(rawToken), resetPasswordExpiresAt: new Date(Date.now() + INVITATION_TOKEN_TTL_MS) })
    .where(eq(users.id, collaborateur.id));

  await envoyerInvitationEquipe(req.user!.userId, collaborateur.email, rawToken);

  await logActivity({
    req,
    managerId: req.user!.userId,
    action: "team.invite_resend",
    entityType: "team_member",
    entityId: collaborateur.id,
    entityLabel: collaborateur.email,
    details: `Invitation renvoyée à ${collaborateur.email}`,
  });

  res.json({ id: collaborateur.id, email: collaborateur.email, status: "PENDING", expired: false });
});
