import { and, asc, desc, eq, inArray, isNull, ne, or, sql, SQL, SQLWrapper } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { db } from "../db/client";
import { contractCotenants, contracts, messages, ownerMessages, properties, tenants, users } from "../db/schema";
import { bauxDuLocataire, estColocataire } from "../services/colocation.service";
import { newMessageFromManagerEmail, sendEmail } from "../services/email.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { assertAccesLocataireOuGestionnaire, chargerCompteCourant, chargerLocataireDuCompte, idLocataireDuCompte } from "../utils/authorization";
import { assertPlanAtLeast } from "../middleware/auth";
import { buildPaginatedResult, parsePagination } from "../utils/pagination";
import { langueOuDefaut } from "../utils/langue";
import { assertAudioContentMatchesDeclaredType } from "../middleware/upload";
import { getSignedUrl, uploadPrivateFile } from "../services/storage.service";
import { DUREE_MAX_MESSAGE_VOCAL_SEC, libelleMessageVocal, TOLERANCE_DUREE_SEC } from "../utils/messageVocal";

type Qualite = "TITULAIRE" | "COLOCATAIRE";
type Locataire = typeof tenants.$inferSelect;

/**
 * Un fil de discussion par locataire du bail : le titulaire et chaque colocataire écrivent à
 * l'agence chacun de leur côté, sans voir les échanges des autres. Une ligne sans tenant_id
 * (antérieure au rattachement de initDb) appartient au fil du titulaire.
 */
function conditionDuFil(contractId: string, tenantId: string, titulaireId: string): SQL {
  return tenantId === titulaireId
    ? and(eq(messages.contractId, contractId), or(eq(messages.tenantId, tenantId), isNull(messages.tenantId)))!
    : and(eq(messages.contractId, contractId), eq(messages.tenantId, tenantId))!;
}

const idDuFil = (contractId: string, tenantId: string) => `${contractId}:${tenantId}`;

type LigneMessage = typeof messages.$inferSelect;

/**
 * Le message tel que le client le reçoit : le chemin de stockage de l'enregistrement ne sort jamais (il révélerait
 * l'organisation du bucket) ; il est remplacé par un lien signé à durée limitée, généré à chaque lecture du fil.
 */
export async function messagePublic<T extends { audioPath: string | null }>(message: T): Promise<Omit<T, "audioPath"> & { audioUrl: string | null }> {
  const { audioPath, ...reste } = message;
  let audioUrl: string | null = null;
  if (audioPath) {
    // Un lien qu'on ne sait pas générer ne doit pas faire échouer tout le fil : le message s'affiche sans lecteur.
    audioUrl = await getSignedUrl(audioPath).catch((err) => {
      console.error("[message] Lien signé impossible pour un message vocal :", err);
      return null;
    });
  }
  return { ...reste, audioUrl };
}

/** Pour un aperçu (dernier message d'un fil) : pas de lien signé, seulement l'indication qu'il s'agit d'un vocal. */
export function apercuMessage<T extends { audioPath: string | null }>(message: T | null | undefined) {
  if (!message) return null;
  const { audioPath, ...reste } = message;
  return { ...reste, isVoice: Boolean(audioPath) };
}

/** Lignes d'un résultat SQL brut, quel que soit le pilote (postgres-js : tableau ; PGlite : { rows }). */
const lignesSql = <T>(resultat: unknown): T[] =>
  (Array.isArray(resultat) ? resultat : ((resultat as { rows?: T[] }).rows ?? [])) as T[];

/**
 * Les fils de discussion d'un gestionnaire : un par bail pour le titulaire, un par colocataire, et
 * un par ancien colocataire qui a écrit (son historique reste consultable). C'est CET ensemble qu'on
 * pagine, et non les baux : un bail en colocation occupe plusieurs lignes de la liste, et la
 * pagination d'après les baux affichait plus de lignes que la taille de page, avec un total faux.
 */
function filsDuGestionnaire(managerId: string) {
  return sql`
    WITH fils AS (
      SELECT c.id AS contract_id, c.tenant_id AS tenant_id, 0 AS rang, c.created_at AS created_at
      FROM contracts c JOIN properties p ON p.id = c.property_id
      WHERE p.manager_id = ${managerId}
      UNION ALL
      SELECT cc.contract_id, cc.tenant_id, 1, c.created_at
      FROM contract_cotenants cc
      JOIN contracts c ON c.id = cc.contract_id
      JOIN properties p ON p.id = c.property_id
      WHERE p.manager_id = ${managerId}
      UNION ALL
      SELECT DISTINCT m.contract_id, m.tenant_id, 2, c.created_at
      FROM messages m
      JOIN contracts c ON c.id = m.contract_id
      JOIN properties p ON p.id = c.property_id
      WHERE p.manager_id = ${managerId}
        AND m.tenant_id IS NOT NULL
        AND m.tenant_id <> c.tenant_id
        AND NOT EXISTS (
          SELECT 1 FROM contract_cotenants cc WHERE cc.contract_id = m.contract_id AND cc.tenant_id = m.tenant_id
        )
    )`;
}

export const listConversations = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise", "AUTH_REQUIRED");
  const pagination = parsePagination(req);

  if (req.user.role === "MANAGER") return listerFilsDuGestionnaire(req, res, pagination);
  if (req.user.role !== "TENANT") {
    // Un compte ADMIN promu depuis un ancien compte MANAGER (voir
    // scripts/createAdmin.ts, qui conserve le même id utilisateur) voyait
    // auparavant cette branche `else` s'exécuter comme s'il était toujours
    // gestionnaire, exposant les conversations de ses anciens biens. Aucun
    // rôle autre que TENANT ou MANAGER n'a d'accès à cette liste.
    throw new ApiError(403, "Accès refusé", "ACCESS_DENIED");
  }

  // Titulaire OU colocataire : chaque bail où il est partie lui ouvre SON fil avec l'agence — un seul
  // par bail, donc la pagination par baux est exacte.
  const moi = await chargerLocataireDuCompte(req);
  const qualites = await bauxDuLocataire(moi.id);
  if (qualites.size === 0) return res.json(buildPaginatedResult([], 0, pagination));
  const whereClause = inArray(contracts.id, [...qualites.keys()]);

  const [contractList, [{ count }]] = await Promise.all([
    db
      .select({ contract: contracts, property: properties })
      .from(contracts)
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(whereClause)
      .orderBy(desc(contracts.createdAt))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(contracts).where(whereClause),
  ]);
  if (contractList.length === 0) return res.json(buildPaginatedResult([], count, pagination));

  // Évite la requête N+1 : tous les messages de CETTE PAGE en une requête, le plus récent de chaque fil retenu.
  const contractIds = contractList.map((item) => item.contract.id);
  const titulaires = new Map<string, string>(contractList.map((item) => [item.contract.id, item.contract.tenantId]));
  const allMessages = await db
    .select()
    .from(messages)
    .where(inArray(messages.contractId, contractIds))
    .orderBy(desc(messages.createdAt));
  const dernierParFil = new Map<string, typeof messages.$inferSelect>();
  for (const msg of allMessages) {
    const cle = idDuFil(msg.contractId, msg.tenantId ?? titulaires.get(msg.contractId)!);
    if (!dernierParFil.has(cle)) dernierParFil.set(cle, msg);
  }

  const conversations = contractList.map((item) => ({
    id: idDuFil(item.contract.id, moi.id),
    contractId: item.contract.id,
    tenantId: moi.id,
    qualite: qualites.get(item.contract.id) ?? "TITULAIRE",
    property: item.property,
    tenant: moi,
    lastMessage: apercuMessage(dernierParFil.get(idDuFil(item.contract.id, moi.id))),
  }));
  res.json(buildPaginatedResult(conversations, count, pagination));
});

async function listerFilsDuGestionnaire(req: Request, res: Response, pagination: ReturnType<typeof parsePagination>) {
  const fils = filsDuGestionnaire(req.user!.userId);
  const [pageBrute, compteBrut] = await Promise.all([
    db.execute(
      sql`${fils} SELECT contract_id, tenant_id, rang FROM fils ORDER BY created_at DESC, contract_id, rang, tenant_id LIMIT ${pagination.pageSize} OFFSET ${pagination.offset}`
    ),
    db.execute(sql`${fils} SELECT count(*)::int AS n FROM fils`),
  ]);
  const page = lignesSql<{ contract_id: string; tenant_id: string; rang: number }>(pageBrute);
  const total = Number(lignesSql<{ n: number }>(compteBrut)[0]?.n ?? 0);
  if (page.length === 0) return res.json(buildPaginatedResult([], total, pagination));

  const contractIds = [...new Set(page.map((r) => r.contract_id))];
  const tenantIds = [...new Set(page.map((r) => r.tenant_id))];
  const [baux, locataires, allMessages] = await Promise.all([
    db
      .select({ contract: contracts, property: properties })
      .from(contracts)
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(inArray(contracts.id, contractIds)),
    db.select().from(tenants).where(inArray(tenants.id, tenantIds)),
    db.select().from(messages).where(inArray(messages.contractId, contractIds)).orderBy(desc(messages.createdAt)),
  ]);
  const bailParId = new Map<string, (typeof baux)[number]>(baux.map((b: (typeof baux)[number]) => [b.contract.id, b]));
  const locataireParId = new Map<string, Locataire>(locataires.map((t: Locataire) => [t.id, t]));

  const dernierParFil = new Map<string, typeof messages.$inferSelect>();
  for (const msg of allMessages) {
    const cle = idDuFil(msg.contractId, msg.tenantId ?? bailParId.get(msg.contractId)!.contract.tenantId);
    if (!dernierParFil.has(cle)) dernierParFil.set(cle, msg);
  }

  const conversations = page.map((r) => {
    const bail = bailParId.get(r.contract_id)!;
    return {
      id: idDuFil(r.contract_id, r.tenant_id),
      contractId: r.contract_id,
      tenantId: r.tenant_id,
      qualite: (Number(r.rang) === 0 ? "TITULAIRE" : "COLOCATAIRE") as Qualite,
      property: bail.property,
      tenant: locataireParId.get(r.tenant_id)!,
      lastMessage: apercuMessage(dernierParFil.get(idDuFil(r.contract_id, r.tenant_id))),
    };
  });
  res.json(buildPaginatedResult(conversations, total, pagination));
}

/**
 * Le fil demandé, et le droit d'y accéder : un locataire n'ouvre que le sien (titulaire ou
 * colocataire du bail) ; le gestionnaire du bien ouvre celui du locataire choisi (`tenantId`,
 * le titulaire par défaut). `ecriture` : un ancien colocataire n'est plus partie au bail, son
 * fil reste lisible mais on ne lui écrit plus.
 */
async function resoudreFil(req: Request, contractId: string, ecriture: boolean) {
  const [row] = await db
    .select({ contract: contracts, property: properties, titulaire: tenants })
    .from(contracts)
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .where(eq(contracts.id, contractId));
  if (!row) throw new ApiError(404, "Contrat introuvable", "CONTRACT_NOT_FOUND");

  if (req.user!.role === "TENANT") {
    const moi = await idLocataireDuCompte(req);
    if (moi && moi === row.contract.tenantId) return { ...row, tenant: row.titulaire, qualite: "TITULAIRE" as Qualite };
    if (moi && (await estColocataire(row.contract.id, moi))) {
      const [fiche] = await db.select().from(tenants).where(eq(tenants.id, moi));
      return { ...row, tenant: fiche, qualite: "COLOCATAIRE" as Qualite };
    }
  }
  assertAccesLocataireOuGestionnaire(req.user!.role, false, row.property.managerId === req.user!.userId, {
    message: "Contrat introuvable",
    code: "CONTRACT_NOT_FOUND",
  });

  const demande = typeof req.query.tenantId === "string" && req.query.tenantId ? req.query.tenantId : row.contract.tenantId;
  if (demande === row.contract.tenantId) return { ...row, tenant: row.titulaire, qualite: "TITULAIRE" as Qualite };
  const [fiche] = await db.select().from(tenants).where(eq(tenants.id, demande));
  if (fiche && (await estColocataire(row.contract.id, demande))) return { ...row, tenant: fiche, qualite: "COLOCATAIRE" as Qualite };
  if (fiche) {
    const [ancien] = await db.select({ id: messages.id }).from(messages).where(conditionDuFil(row.contract.id, demande, row.contract.tenantId)).limit(1);
    if (ancien) {
      if (ecriture) throw new ApiError(409, "Ce locataire n'est plus colocataire du bail : son fil reste consultable, mais on ne lui écrit plus ici.", "COTENANT_THREAD_READ_ONLY");
      return { ...row, tenant: fiche, qualite: "COLOCATAIRE" as Qualite };
    }
  }
  throw new ApiError(404, "Conversation introuvable", "CONVERSATION_NOT_FOUND");
}

/**
 * Lecture incrémentale d'un fil (`?apresId=<dernier message connu>`) : seuls les messages POSTÉRIEURS à celui-là sont renvoyés
 * (et signés), avec les identifiants de mes messages que l'autre partie a lus depuis. L'écran ouvert interroge ainsi le serveur
 * toutes les quelques secondes sans retélécharger ni re-signer tout le fil. La comparaison se fait en SQL, à la précision de
 * la base : une date passée par le client, tronquée à la milliseconde, renverrait chaque fois le dernier message. Un repère
 * inconnu ou étranger à ce fil (message supprimé, fil changé) rend le fil entier.
 */
export const apresMessage = (colonneDate: SQLWrapper, depuisLeRepere: SQL): SQL =>
  sql`${colonneDate} > COALESCE((${depuisLeRepere}), '-infinity'::timestamp)`;

export const getMessagesByContract = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise", "AUTH_REQUIRED");
  const { contractId } = req.params;
  const fil = await resoudreFil(req, contractId, false);
  const condition = conditionDuFil(contractId, fil.tenant.id, fil.contract.tenantId);
  const apresId = typeof req.query.apresId === "string" && req.query.apresId ? req.query.apresId : null;
  const filtre = apresId
    ? and(condition, apresMessage(messages.createdAt, sql`SELECT m.created_at FROM messages m WHERE m.id = ${apresId} AND m.contract_id = ${contractId}`))!
    : condition;

  const msgList = await db
    .select({
      message: messages,
      sender: {
        id: users.id,
        email: users.email,
        role: users.role,
      },
    })
    .from(messages)
    .innerJoin(users, eq(messages.senderId, users.id))
    .where(filtre)
    .orderBy(asc(messages.createdAt));

  // Marquer comme lus seulement les messages reçus, pas ceux envoyés par
  // l'utilisateur courant : sinon un locataire qui ouvre sa propre
  // conversation marque son propre message comme lu, ce qui vide à tort le
  // badge "non lu" du gestionnaire avant qu'il ne l'ait vu.
  //
  // Seulement ceux qui sont encore « non lus » : le fil est relu en continu (rafraîchissement automatique), et PostgreSQL crée une
  // nouvelle version de ligne à chaque UPDATE, même quand la valeur ne change pas. Sans ce filtre, chaque rafraîchissement réécrivait
  // TOUS les messages déjà lus du fil (base alourdie, journal d'écriture gonflé). Même règle que le fil des propriétaires.
  await db
    .update(messages)
    .set({ isRead: true })
    .where(and(condition, ne(messages.senderId, req.user.userId), eq(messages.isRead, false)));

  // En lecture incrémentale : lesquels de MES messages ont été lus par l'autre partie (pour l'état « Lu » à l'écran).
  const luesIds = apresId
    ? (await db.select({ id: messages.id }).from(messages).where(and(condition, eq(messages.senderId, req.user.userId), eq(messages.isRead, true)))).map(
        (m: { id: string }) => m.id
      )
    : undefined;

  res.json({
    contract: {
      ...fil.contract,
      property: fil.property,
      // L'interlocuteur de ce fil : le titulaire, ou le colocataire.
      tenant: fil.tenant,
    },
    tenantId: fil.tenant.id,
    qualite: fil.qualite,
    luesIds,
    // L'auteur (id et adresse de connexion) n'est renvoyé qu'au gestionnaire : l'écran du locataire ne s'appuie que sur
    // `senderRole`, et l'adresse de connexion du gestionnaire — ou du propriétaire de l'agence, pour un message écrit
    // par un collaborateur — n'a pas à quitter l'espace gestionnaire.
    messages: await Promise.all(
      msgList.map(async (m: { message: typeof messages.$inferSelect; sender: { id: string; email: string; role: string } }) => {
        const message = await messagePublic(m.message);
        return req.user!.role === "MANAGER" ? { ...message, sender: m.sender } : { ...message, senderId: undefined };
      })
    ),
  });
});

/**
 * Nombre de messages non lus, pour la pastille du menu « Messagerie ». Un seul calcul par rôle, sans rien charger d'autre que des
 * décomptes :
 *  - locataire : les messages de l'agence qu'il n'a pas lus, dans tous ses fils (titulaire ou colocataire) ;
 *  - gestionnaire : ceux de ses locataires (`tenants`) et de ses propriétaires (`owners`), distingués pour les onglets.
 * Mêmes règles que la cloche (notification.controller.ts) : « non lu » = envoyé par l'autre partie et pas encore ouvert.
 */
export const nonLusMessagerie = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise", "AUTH_REQUIRED");

  if (req.user.role === "TENANT") {
    const moi = await idLocataireDuCompte(req);
    if (!moi) return res.json({ count: 0 });
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(contracts, eq(messages.contractId, contracts.id))
      .where(
        and(
          // Son fil : rattaché à sa fiche, ou ancienne ligne non rattachée d'un bail dont il est titulaire.
          or(eq(messages.tenantId, moi), and(isNull(messages.tenantId), eq(contracts.tenantId, moi))),
          eq(messages.senderRole, "MANAGER"),
          eq(messages.isRead, false)
        )
      );
    return res.json({ count: n });
  }

  if (req.user.role !== "MANAGER") throw new ApiError(403, "Accès refusé", "ACCESS_DENIED");
  const [[locataires], [proprietaires]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(contracts, eq(messages.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(and(eq(properties.managerId, req.user.userId), eq(messages.senderRole, "TENANT"), eq(messages.isRead, false))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(ownerMessages)
      .where(and(eq(ownerMessages.managerId, req.user.userId), eq(ownerMessages.senderRole, "OWNER"), eq(ownerMessages.isRead, false))),
  ]);
  res.json({ count: locataires.n + proprietaires.n, tenants: locataires.n, owners: proprietaires.n });
});

// Borné : sans plafond, un message pouvait peser jusqu'à la limite du corps JSON (10 Mo) et alourdissait la base et
// chaque réponse qui renvoie le fil entier. Rogné avant le test de vacuité : « espaces » n'est pas un message.
export const sendMessageSchema = z.object({
  content: z.string().trim().min(1, "Le message ne peut pas être vide").max(5000, "Le message ne peut pas dépasser 5 000 caractères"),
});

export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise", "AUTH_REQUIRED");
  const { contractId } = req.params;
  const { content } = sendMessageSchema.parse(req.body);

  const fil = await resoudreFil(req, contractId, true);

  // Messagerie directe intégrée : fonctionnalité Pro (CGU §3) — seul l'envoi
  // par le GESTIONNAIRE est concerné ; un locataire ne doit jamais être privé
  // de la possibilité d'écrire à son agence par la formule que celle-ci a
  // choisie.
  if (req.user.role === "MANAGER") {
    assertPlanAtLeast(await chargerCompteCourant(req), "PRO");
  }

  const [newMsg] = await db
    .insert(messages)
    .values({
      contractId,
      senderId: req.user.userId,
      senderRole: req.user.role,
      tenantId: fil.tenant.id,
      content,
      isRead: false,
    })
    .returning();

  // Le locataire reçoit un email quand l'agence (gestionnaire) lui écrit —
  // ne doit jamais faire échouer l'envoi du message si l'email échoue.
  // Le destinataire est le locataire de CE fil (titulaire ou colocataire).
  if (req.user.role === "MANAGER") {
    if (fil.tenant.email && !fil.tenant.anonymizedAt) {
      const { subject, html } = newMessageFromManagerEmail({
        tenantName: `${fil.tenant.firstName} ${fil.tenant.lastName}`,
        propertyTitle: fil.property.title,
        content,
        frontendUrl: env.frontendUrl,
        langue: langueOuDefaut(fil.tenant.language),
      });
      await sendEmail(fil.tenant.email, subject, html).catch((err) =>
        console.error("[message] Échec de l'envoi de la notification de nouveau message:", err)
      );
    }
  }

  res.status(201).json(await messagePublic(newMsg));
});

export const sendVoiceSchema = z.object({
  durationSec: z.coerce
    .number()
    .int("Durée invalide")
    .min(1, "Enregistrement trop court")
    .max(DUREE_MAX_MESSAGE_VOCAL_SEC + TOLERANCE_DUREE_SEC, "Un message vocal ne peut pas dépasser 3 minutes"),
});

/**
 * Message vocal : un enregistrement (WebM, Ogg ou MP4) rangé dans le stockage PRIVÉ, rattaché au fil comme un message
 * texte. Mêmes règles d'accès et d'abonnement que `sendMessage` ; la vérification de propriété précède celle du
 * contenu, pour que l'accès refusé reste un 403/404 net.
 */
export const sendVoiceMessage = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise", "AUTH_REQUIRED");
  const { contractId } = req.params;

  const fil = await resoudreFil(req, contractId, true);
  if (req.user.role === "MANAGER") {
    assertPlanAtLeast(await chargerCompteCourant(req), "PRO");
  }

  const fichier = req.file;
  if (!fichier) throw new ApiError(400, "Aucun enregistrement reçu", "AUDIO_REQUIRED");
  const { durationSec } = sendVoiceSchema.parse(req.body);
  assertAudioContentMatchesDeclaredType(fichier);

  const audioPath = await uploadPrivateFile(fichier, "messages");
  const [newMsg] = await db
    .insert(messages)
    .values({
      contractId,
      senderId: req.user.userId,
      senderRole: req.user.role,
      tenantId: fil.tenant.id,
      content: "",
      audioPath,
      audioDurationSec: durationSec,
      audioMime: fichier.mimetype,
      isRead: false,
    })
    .returning();

  if (req.user.role === "MANAGER" && fil.tenant.email && !fil.tenant.anonymizedAt) {
    const langue = langueOuDefaut(fil.tenant.language);
    const { subject, html } = newMessageFromManagerEmail({
      tenantName: `${fil.tenant.firstName} ${fil.tenant.lastName}`,
      propertyTitle: fil.property.title,
      content: libelleMessageVocal(langue, durationSec),
      frontendUrl: env.frontendUrl,
      langue,
    });
    await sendEmail(fil.tenant.email, subject, html).catch((err) =>
      console.error("[message] Échec de l'envoi de la notification de nouveau message:", err)
    );
  }

  res.status(201).json(await messagePublic(newMsg));
});
