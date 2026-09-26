import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { db } from "../db/client";
import { contracts, messages, properties, tenants, users } from "../db/schema";
import { newMessageFromManagerEmail, sendEmail } from "../services/email.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { assertAccesLocataireOuGestionnaire, chargerLocataireDuCompte, idLocataireDuCompte } from "../utils/authorization";
import { buildPaginatedResult, parsePagination } from "../utils/pagination";

export const listConversations = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");
  const pagination = parsePagination(req);

  let whereClause;
  if (req.user.role === "TENANT") {
    whereClause = eq(contracts.tenantId, (await chargerLocataireDuCompte(req)).id);
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
  // conserve le plus récent.
  const contractIds = contractList.map((item) => item.contract.id);
  const allMessages = await db
    .select()
    .from(messages)
    .where(inArray(messages.contractId, contractIds))
    .orderBy(desc(messages.createdAt));

  const lastMessageByContract = new Map<string, typeof messages.$inferSelect>();
  for (const msg of allMessages) {
    if (!lastMessageByContract.has(msg.contractId)) {
      lastMessageByContract.set(msg.contractId, msg);
    }
  }

  const conversations = contractList.map((item) => ({
    contractId: item.contract.id,
    property: item.property,
    tenant: item.tenant,
    lastMessage: lastMessageByContract.get(item.contract.id) ?? null,
  }));

  res.json(buildPaginatedResult(conversations, count, pagination));
});

export const getMessagesByContract = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");
  const { contractId } = req.params;

  const [contract] = await db
    .select({
      contract: contracts,
      property: properties,
      tenant: tenants,
    })
    .from(contracts)
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .where(eq(contracts.id, contractId));

  if (!contract) throw new ApiError(404, "Contrat introuvable");

  assertAccesLocataireOuGestionnaire(
    req.user.role,
    contract.contract.tenantId === (await idLocataireDuCompte(req)),
    contract.property.managerId === req.user.userId
  );

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
    .where(eq(messages.contractId, contractId))
    .orderBy(asc(messages.createdAt));

  // Marquer comme lus seulement les messages reçus, pas ceux envoyés par
  // l'utilisateur courant : sinon un locataire qui ouvre sa propre
  // conversation marque son propre message comme lu, ce qui vide à tort le
  // badge "non lu" du gestionnaire avant qu'il ne l'ait vu.
  await db
    .update(messages)
    .set({ isRead: true })
    .where(and(eq(messages.contractId, contractId), ne(messages.senderId, req.user.userId)));

  res.json({
    contract: {
      ...contract.contract,
      property: contract.property,
      tenant: contract.tenant,
    },
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

  const [row] = await db
    .select({ contract: contracts, property: properties })
    .from(contracts)
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(eq(contracts.id, contractId));
  if (!row) throw new ApiError(404, "Contrat introuvable");
  const { contract } = row;

  assertAccesLocataireOuGestionnaire(
    req.user.role,
    contract.tenantId === (await idLocataireDuCompte(req)),
    row.property.managerId === req.user.userId
  );

  const [newMsg] = await db
    .insert(messages)
    .values({
      contractId,
      senderId: req.user.userId,
      senderRole: req.user.role,
      content,
      isRead: false,
    })
    .returning();

  // Le locataire reçoit un email quand l'agence (gestionnaire) lui écrit —
  // ne doit jamais faire échouer l'envoi du message si l'email échoue.
  if (req.user.role === "MANAGER") {
    const [row] = await db
      .select({ tenant: tenants, property: properties })
      .from(contracts)
      .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(eq(contracts.id, contractId));

    if (row?.tenant?.email) {
      const { subject, html } = newMessageFromManagerEmail({
        tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
        propertyTitle: row.property.title,
        content,
        frontendUrl: env.frontendUrl,
      });
      await sendEmail(row.tenant.email, subject, html).catch((err) =>
        console.error("[message] Échec de l'envoi de la notification de nouveau message:", err)
      );
    }
  }

  res.status(201).json(newMsg);
});
