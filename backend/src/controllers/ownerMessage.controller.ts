import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { env } from "../config/env";
import { db } from "../db/client";
import { ownerMessages, owners, users } from "../db/schema";
import { assertAudioContentMatchesDeclaredType } from "../middleware/upload";
import { assertPlanAtLeast } from "../middleware/auth";
import { newMessageForOwnerEmail, sendEmail } from "../services/email.service";
import { uploadPrivateFile } from "../services/storage.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { assertOwnership, chargerCompteCourant, chargerProprietaireDuCompte } from "../utils/authorization";
import { langueOuDefaut } from "../utils/langue";
import { libelleMessageVocal } from "../utils/messageVocal";
import { nomAvecCivilite } from "../utils/nom";
import { buildPaginatedResult, parsePagination } from "../utils/pagination";
import { apercuMessage, messagePublic, sendMessageSchema, sendVoiceSchema } from "./message.controller";

/**
 * Discussion agence ↔ propriétaire. Un fil unique par propriétaire (voir la table `owner_messages`) : le propriétaire
 * n'ouvre que le sien, résolu par son COMPTE (jamais par un identifiant de l'URL ni par le jeton, comme le reste du
 * portail) ; le gestionnaire n'ouvre que ceux des propriétaires de son agence.
 */

type Fiche = typeof owners.$inferSelect;

/** Ce que le gestionnaire sait de l'interlocuteur : de quoi l'afficher et savoir s'il peut lui répondre. */
function interlocuteur(owner: Fiche) {
  return {
    id: owner.id,
    firstName: owner.firstName,
    lastName: owner.lastName,
    companyName: owner.companyName,
    civility: owner.civility,
    displayName: nomAvecCivilite(owner),
    hasPortalAccess: Boolean(owner.userId),
  };
}

/** Lire le fil et marquer lus les messages REÇUS (pas ceux que l'on a soi-même écrits). */
async function lireFil(owner: Fiche, lecteurId: string, voitLesAuteurs: boolean) {
  const lignes = await db
    .select({ message: ownerMessages, sender: { id: users.id, email: users.email, role: users.role } })
    .from(ownerMessages)
    .innerJoin(users, eq(ownerMessages.senderId, users.id))
    .where(eq(ownerMessages.ownerId, owner.id))
    .orderBy(asc(ownerMessages.createdAt));

  await db
    .update(ownerMessages)
    .set({ isRead: true })
    .where(and(eq(ownerMessages.ownerId, owner.id), ne(ownerMessages.senderId, lecteurId), eq(ownerMessages.isRead, false)));

  return Promise.all(
    lignes.map(async (l: { message: typeof ownerMessages.$inferSelect; sender: { id: string; email: string; role: string } }) => {
      const message = await messagePublic(l.message);
      // Comme la messagerie des locataires : l'adresse de connexion de l'auteur ne sort pas de l'espace gestionnaire.
      return voitLesAuteurs ? { ...message, sender: l.sender } : { ...message, senderId: undefined };
    })
  );
}

interface Contenu {
  texte: string;
  audio?: { path: string; durationSec: number; mime: string };
}

async function enregistrer(req: Request, owner: Fiche, contenu: Contenu) {
  const [message] = await db
    .insert(ownerMessages)
    .values({
      ownerId: owner.id,
      managerId: owner.managerId,
      senderId: req.user!.userId,
      senderRole: req.user!.role,
      content: contenu.texte,
      audioPath: contenu.audio?.path ?? null,
      audioDurationSec: contenu.audio?.durationSec ?? null,
      audioMime: contenu.audio?.mime ?? null,
      isRead: false,
    })
    .returning();

  // Le propriétaire est prévenu par e-mail quand l'agence lui écrit ; un échec d'envoi ne fait jamais échouer le message.
  if (req.user!.role === "MANAGER" && owner.email && !owner.anonymizedAt) {
    const langue = langueOuDefaut(owner.language);
    const { subject, html } = newMessageForOwnerEmail({
      ownerName: nomAvecCivilite(owner),
      content: contenu.audio ? libelleMessageVocal(langue, contenu.audio.durationSec) : contenu.texte,
      frontendUrl: env.frontendUrl,
      langue,
    });
    await sendEmail(owner.email, subject, html).catch((err) =>
      console.error("[ownerMessage] Échec de l'envoi de la notification de nouveau message:", err)
    );
  }

  return messagePublic(message);
}

// ───────────────────────────── Côté propriétaire ─────────────────────────────

export const getMyOwnerThread = asyncHandler(async (req: Request, res: Response) => {
  const owner = await chargerProprietaireDuCompte(req);
  res.json({ messages: await lireFil(owner, req.user!.userId, false) });
});

export const sendMyOwnerMessage = asyncHandler(async (req: Request, res: Response) => {
  const owner = await chargerProprietaireDuCompte(req);
  const { content } = sendMessageSchema.parse(req.body);
  res.status(201).json(await enregistrer(req, owner, { texte: content }));
});

export const sendMyOwnerVoice = asyncHandler(async (req: Request, res: Response) => {
  const owner = await chargerProprietaireDuCompte(req);
  const fichier = req.file;
  if (!fichier) throw new ApiError(400, "Aucun enregistrement reçu", "AUDIO_REQUIRED");
  const { durationSec } = sendVoiceSchema.parse(req.body);
  assertAudioContentMatchesDeclaredType(fichier);
  const path = await uploadPrivateFile(fichier, "messages");
  res.status(201).json(await enregistrer(req, owner, { texte: "", audio: { path, durationSec, mime: fichier.mimetype } }));
});

// ───────────────────────────── Côté gestionnaire ─────────────────────────────

/**
 * Les fils de l'agence : un par propriétaire qui a accès à son espace, ou dont le fil contient déjà des messages.
 * Les propriétaires anonymisés n'y figurent plus (leur fil a été effacé avec eux). Le plus récemment actif d'abord.
 */
export const listOwnerConversations = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);
  const managerId = req.user!.userId;
  const aDesMessages = sql`EXISTS (SELECT 1 FROM ${ownerMessages} m WHERE m.owner_id = ${owners.id})`;
  const where = and(eq(owners.managerId, managerId), isNull(owners.anonymizedAt), or(isNotNull(owners.userId), aDesMessages));
  const dernierMessage = sql`(SELECT max(m.created_at) FROM ${ownerMessages} m WHERE m.owner_id = ${owners.id})`;

  const [page, [{ count }]] = await Promise.all([
    db
      .select()
      .from(owners)
      .where(where)
      .orderBy(sql`${dernierMessage} DESC NULLS LAST`, asc(owners.lastName), asc(owners.firstName), asc(owners.id))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(owners).where(where),
  ]);
  if (page.length === 0) return res.json(buildPaginatedResult([], count, pagination));

  const ids = page.map((o: Fiche) => o.id);
  const [derniers, nonLus] = await Promise.all([
    db
      .selectDistinctOn([ownerMessages.ownerId])
      .from(ownerMessages)
      .where(inArray(ownerMessages.ownerId, ids))
      .orderBy(ownerMessages.ownerId, desc(ownerMessages.createdAt)),
    db
      .select({ ownerId: ownerMessages.ownerId, n: sql<number>`count(*)::int` })
      .from(ownerMessages)
      .where(and(inArray(ownerMessages.ownerId, ids), eq(ownerMessages.senderRole, "OWNER"), eq(ownerMessages.isRead, false)))
      .groupBy(ownerMessages.ownerId),
  ]);
  const dernierParProprietaire = new Map<string, (typeof derniers)[number]>(derniers.map((m: (typeof derniers)[number]) => [m.ownerId, m]));
  const nonLusParProprietaire = new Map<string, number>(nonLus.map((r: { ownerId: string; n: number }) => [r.ownerId, Number(r.n)]));

  const conversations = page.map((o: Fiche) => ({
    id: o.id,
    owner: interlocuteur(o),
    unreadCount: nonLusParProprietaire.get(o.id) ?? 0,
    lastMessage: apercuMessage(dernierParProprietaire.get(o.id)),
  }));
  res.json(buildPaginatedResult(conversations, count, pagination));
});

/** La fiche du propriétaire demandé, s'il est bien de l'agence : 404 sinon, que la fiche existe ailleurs ou non. */
async function proprietaireDeLAgence(req: Request): Promise<Fiche> {
  const [owner] = await db.select().from(owners).where(eq(owners.id, req.params.ownerId));
  assertOwnership(owner, (o) => o.managerId, req.user!.userId, "Propriétaire introuvable", 404, "OWNER_NOT_FOUND");
  return owner;
}

/** On n'écrit qu'à un propriétaire qui peut lire : un compte portail actif, et une fiche non anonymisée. */
function assertPeutRecevoir(owner: Fiche) {
  if (owner.anonymizedAt) {
    throw new ApiError(409, "Ce propriétaire a été anonymisé : on ne peut plus lui écrire.", "OWNER_ANONYMIZED_LOCKED");
  }
  if (!owner.userId) {
    throw new ApiError(
      409,
      "Ce propriétaire n'a pas encore accès à son espace : invitez-le depuis sa fiche avant de lui écrire.",
      "OWNER_NO_PORTAL_ACCESS"
    );
  }
}

export const getOwnerThread = asyncHandler(async (req: Request, res: Response) => {
  const owner = await proprietaireDeLAgence(req);
  res.json({ owner: interlocuteur(owner), messages: await lireFil(owner, req.user!.userId, true) });
});

export const sendOwnerMessage = asyncHandler(async (req: Request, res: Response) => {
  const { content } = sendMessageSchema.parse(req.body);
  const owner = await proprietaireDeLAgence(req);
  // Messagerie directe : fonctionnalité Pro, comme celle des locataires (seul l'envoi par le gestionnaire est concerné).
  assertPlanAtLeast(await chargerCompteCourant(req), "PRO");
  assertPeutRecevoir(owner);
  res.status(201).json(await enregistrer(req, owner, { texte: content }));
});

export const sendOwnerVoice = asyncHandler(async (req: Request, res: Response) => {
  const owner = await proprietaireDeLAgence(req);
  assertPlanAtLeast(await chargerCompteCourant(req), "PRO");
  assertPeutRecevoir(owner);
  const fichier = req.file;
  if (!fichier) throw new ApiError(400, "Aucun enregistrement reçu", "AUDIO_REQUIRED");
  const { durationSec } = sendVoiceSchema.parse(req.body);
  assertAudioContentMatchesDeclaredType(fichier);
  const path = await uploadPrivateFile(fichier, "messages");
  res.status(201).json(await enregistrer(req, owner, { texte: "", audio: { path, durationSec, mime: fichier.mimetype } }));
});
