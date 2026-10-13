import { and, asc, desc, eq, inArray, isNull, ne, or, sql, SQL } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { db } from "../db/client";
import { contractCotenants, contracts, messages, properties, tenants, users } from "../db/schema";
import { bauxDuLocataire, estColocataire } from "../services/colocation.service";
import { newMessageFromManagerEmail, sendEmail } from "../services/email.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { assertAccesLocataireOuGestionnaire, chargerCompteCourant, chargerLocataireDuCompte, idLocataireDuCompte } from "../utils/authorization";
import { assertPlanAtLeast } from "../middleware/auth";
import { buildPaginatedResult, parsePagination } from "../utils/pagination";

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

export const listConversations = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");
  const pagination = parsePagination(req);

  let whereClause;
  let moi: Locataire | null = null;
  let qualites = new Map<string, Qualite>();
  if (req.user.role === "TENANT") {
    // Titulaire OU colocataire : chaque bail où il est partie lui ouvre SON fil avec l'agence.
    moi = await chargerLocataireDuCompte(req);
    qualites = await bauxDuLocataire(moi.id);
    if (qualites.size === 0) return res.json(buildPaginatedResult([], 0, pagination));
    whereClause = inArray(contracts.id, [...qualites.keys()]);
  } else if (req.user.role === "MANAGER") {
    whereClause = eq(properties.managerId, req.user.userId);
  } else {
    // Un compte ADMIN promu depuis un ancien compte MANAGER (voir
    // scripts/createAdmin.ts, qui conserve le même id utilisateur) voyait
    // auparavant cette branche `else` s'exécuter comme s'il était toujours
    // gestionnaire, exposant les conversations de ses anciens biens. Aucun
    // rôle autre que TENANT ou MANAGER n'a d'accès à cette liste.
    throw new ApiError(403, "Accès refusé");
  }

  // La pagination porte sur les baux ; un bail en colocation donne, côté gestionnaire, un fil par
  // locataire.
  const [contractList, [{ count }]] = await Promise.all([
    db
      .select({
        contract: contracts,
        property: properties,
        tenant: tenants,
      })
      .from(contracts)
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
      .where(whereClause)
      .orderBy(desc(contracts.createdAt))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(contracts)
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(whereClause),
  ]);

  if (contractList.length === 0) {
    return res.json(buildPaginatedResult([], count, pagination));
  }

  // Évite la requête N+1 : on charge tous les messages de CETTE PAGE de
  // contrats en une seule requête ordonnée par date décroissante, puis on
  // conserve le plus récent de chaque fil.
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

  if (moi) {
    const locataire = moi;
    const conversations = contractList.map((item) => ({
      id: idDuFil(item.contract.id, locataire.id),
      contractId: item.contract.id,
      tenantId: locataire.id,
      qualite: qualites.get(item.contract.id) ?? "TITULAIRE",
      property: item.property,
      tenant: locataire,
      lastMessage: dernierParFil.get(idDuFil(item.contract.id, locataire.id)) ?? null,
    }));
    return res.json(buildPaginatedResult(conversations, count, pagination));
  }

  // Gestionnaire : le fil du titulaire, celui de chaque colocataire, et celui d'un ancien
  // colocataire s'il a écrit (l'historique reste consultable).
  const colocations = await db
    .select({ contractId: contractCotenants.contractId, tenant: tenants })
    .from(contractCotenants)
    .innerJoin(tenants, eq(contractCotenants.tenantId, tenants.id))
    .where(inArray(contractCotenants.contractId, contractIds));
  const colocatairesParBail = new Map<string, Locataire[]>();
  for (const c of colocations) colocatairesParBail.set(c.contractId, [...(colocatairesParBail.get(c.contractId) ?? []), c.tenant]);

  const anciensIds = new Set<string>();
  for (const msg of allMessages) {
    if (!msg.tenantId || msg.tenantId === titulaires.get(msg.contractId)) continue;
    if (!(colocatairesParBail.get(msg.contractId) ?? []).some((t) => t.id === msg.tenantId)) anciensIds.add(msg.tenantId);
  }
  const anciens = anciensIds.size
    ? await db.select().from(tenants).where(inArray(tenants.id, [...anciensIds]))
    : [];
  const ficheParId = new Map<string, Locataire>(anciens.map((t: Locataire) => [t.id, t]));

  const conversations = contractList.flatMap((item) => {
    const fil = (tenant: Locataire, qualite: Qualite) => ({
      id: idDuFil(item.contract.id, tenant.id),
      contractId: item.contract.id,
      tenantId: tenant.id,
      qualite,
      property: item.property,
      tenant,
      lastMessage: dernierParFil.get(idDuFil(item.contract.id, tenant.id)) ?? null,
    });
    const colocataires = colocatairesParBail.get(item.contract.id) ?? [];
    const dejaListes = new Set([item.tenant.id, ...colocataires.map((t) => t.id)]);
    const anciensDuBail = [...new Set(allMessages.filter((m) => m.contractId === item.contract.id).map((m) => m.tenantId))]
      .filter((id): id is string => !!id && !dejaListes.has(id) && ficheParId.has(id))
      .map((id) => ficheParId.get(id)!);
    return [
      fil(item.tenant, "TITULAIRE"),
      ...colocataires.map((t) => fil(t, "COLOCATAIRE")),
      ...anciensDuBail.map((t) => fil(t, "COLOCATAIRE")),
    ];
  });

  res.json(buildPaginatedResult(conversations, count, pagination));
});

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
  if (!row) throw new ApiError(404, "Contrat introuvable");

  if (req.user!.role === "TENANT") {
    const moi = await idLocataireDuCompte(req);
    if (moi && moi === row.contract.tenantId) return { ...row, tenant: row.titulaire, qualite: "TITULAIRE" as Qualite };
    if (moi && (await estColocataire(row.contract.id, moi))) {
      const [fiche] = await db.select().from(tenants).where(eq(tenants.id, moi));
      return { ...row, tenant: fiche, qualite: "COLOCATAIRE" as Qualite };
    }
  }
  assertAccesLocataireOuGestionnaire(req.user!.role, false, row.property.managerId === req.user!.userId);

  const demande = typeof req.query.tenantId === "string" && req.query.tenantId ? req.query.tenantId : row.contract.tenantId;
  if (demande === row.contract.tenantId) return { ...row, tenant: row.titulaire, qualite: "TITULAIRE" as Qualite };
  const [fiche] = await db.select().from(tenants).where(eq(tenants.id, demande));
  if (fiche && (await estColocataire(row.contract.id, demande))) return { ...row, tenant: fiche, qualite: "COLOCATAIRE" as Qualite };
  if (fiche) {
    const [ancien] = await db.select({ id: messages.id }).from(messages).where(conditionDuFil(row.contract.id, demande, row.contract.tenantId)).limit(1);
    if (ancien) {
      if (ecriture) throw new ApiError(409, "Ce locataire n'est plus colocataire du bail : son fil reste consultable, mais on ne lui écrit plus ici.");
      return { ...row, tenant: fiche, qualite: "COLOCATAIRE" as Qualite };
    }
  }
  throw new ApiError(404, "Conversation introuvable");
}

export const getMessagesByContract = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");
  const { contractId } = req.params;
  const fil = await resoudreFil(req, contractId, false);
  const condition = conditionDuFil(contractId, fil.tenant.id, fil.contract.tenantId);

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
    .where(condition)
    .orderBy(asc(messages.createdAt));

  // Marquer comme lus seulement les messages reçus, pas ceux envoyés par
  // l'utilisateur courant : sinon un locataire qui ouvre sa propre
  // conversation marque son propre message comme lu, ce qui vide à tort le
  // badge "non lu" du gestionnaire avant qu'il ne l'ait vu.
  await db
    .update(messages)
    .set({ isRead: true })
    .where(and(condition, ne(messages.senderId, req.user.userId)));

  res.json({
    contract: {
      ...fil.contract,
      property: fil.property,
      // L'interlocuteur de ce fil : le titulaire, ou le colocataire.
      tenant: fil.tenant,
    },
    tenantId: fil.tenant.id,
    qualite: fil.qualite,
    messages: msgList.map(
      (m: { message: typeof messages.$inferSelect; sender: { id: string; email: string; role: string } }) => ({
        ...m.message,
        sender: m.sender,
      })
    ),
  });
});

const sendMessageSchema = z.object({
  content: z.string().min(1, "Le message ne peut pas être vide"),
});

export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");
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
      });
      await sendEmail(fil.tenant.email, subject, html).catch((err) =>
        console.error("[message] Échec de l'envoi de la notification de nouveau message:", err)
      );
    }
  }

  res.status(201).json(newMsg);
});
