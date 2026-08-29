import { asc, desc, eq, inArray } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { contracts, messages, properties, tenants, users } from "../db/schema";
import { ApiError, asyncHandler } from "../utils/asyncHandler";

export const listConversations = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");

  let contractList = [];
  if (req.user.role === "TENANT") {
    if (!req.user.tenantId) throw new ApiError(403, "Profil locataire manquant");
    contractList = await db
      .select({
        contract: contracts,
        property: properties,
        tenant: tenants,
      })
      .from(contracts)
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
      .where(eq(contracts.tenantId, req.user.tenantId));
  } else {
    contractList = await db
      .select({
        contract: contracts,
        property: properties,
        tenant: tenants,
      })
      .from(contracts)
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
      .orderBy(desc(contracts.createdAt));
  }

  // Pour chaque contrat, récupérer le dernier message
  const conversations = [];
  for (const item of contractList) {
    const lastMsg = await db
      .select()
      .from(messages)
      .where(eq(messages.contractId, item.contract.id))
      .orderBy(desc(messages.createdAt))
      .limit(1);

    conversations.push({
      contractId: item.contract.id,
      property: item.property,
      tenant: item.tenant,
      lastMessage: lastMsg[0] ?? null,
    });
  }

  res.json(conversations);
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

  if (req.user.role === "TENANT" && contract.contract.tenantId !== req.user.tenantId) {
    throw new ApiError(403, "Accès refusé");
  }

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

  // Marquer les messages reçus comme lus
  await db
    .update(messages)
    .set({ isRead: "true" })
    .where(eq(messages.contractId, contractId));

  res.json({
    contract: {
      ...contract.contract,
      property: contract.property,
      tenant: contract.tenant,
    },
    messages: msgList.map((m) => ({
      ...m.message,
      sender: m.sender,
    })),
  });
});

const sendMessageSchema = z.object({
  content: z.string().min(1, "Le message ne peut pas être vide"),
});

export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");
  const { contractId } = req.params;
  const { content } = sendMessageSchema.parse(req.body);

  const [contract] = await db.select().from(contracts).where(eq(contracts.id, contractId));
  if (!contract) throw new ApiError(404, "Contrat introuvable");

  if (req.user.role === "TENANT" && contract.tenantId !== req.user.tenantId) {
    throw new ApiError(403, "Accès refusé");
  }

  const [newMsg] = await db
    .insert(messages)
    .values({
      contractId,
      senderId: req.user.userId,
      senderRole: req.user.role,
      content,
      isRead: "false",
    })
    .returning();

  res.status(201).json(newMsg);
});
