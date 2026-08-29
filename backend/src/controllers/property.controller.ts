import { desc, eq } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { contracts, properties, tenants } from "../db/schema";
import { logActivity } from "../services/activity.service";
import { uploadPublicFile } from "../services/storage.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";

const propertySchema = z.object({
  title: z.string().min(2),
  address: z.string().min(2),
  surface: z.coerce.number().positive(),
  rent: z.coerce.number().positive(),
  status: z.enum(["AVAILABLE", "OCCUPIED", "MAINTENANCE"]).optional(),
  description: z.string().optional(),
});

export const listProperties = asyncHandler(async (req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(properties)
    .where(eq(properties.managerId, req.user!.userId))
    .orderBy(desc(properties.createdAt));
  res.json(rows);
});

export const getProperty = asyncHandler(async (req: Request, res: Response) => {
  const [property] = await db.select().from(properties).where(eq(properties.id, req.params.id));
  if (!property || property.managerId !== req.user!.userId) throw new ApiError(404, "Bien introuvable");

  const propertyContracts = await db
    .select({ contract: contracts, tenant: tenants })
    .from(contracts)
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .where(eq(contracts.propertyId, property.id))
    .orderBy(desc(contracts.createdAt));

  res.json({ ...property, contracts: propertyContracts.map((r: { contract: typeof contracts.$inferSelect; tenant: typeof tenants.$inferSelect }) => ({ ...r.contract, tenant: r.tenant })) });
});

export const createProperty = asyncHandler(async (req: Request, res: Response) => {
  const body = propertySchema.parse(req.body);
  const imageUrl = req.file ? await uploadPublicFile(req.file, "properties") : undefined;

  const [property] = await db
    .insert(properties)
    .values({ ...body, imageUrl, managerId: req.user!.userId })
    .returning();

  await logActivity({
    req,
    managerId: property.managerId,
    action: "property.create",
    entityType: "property",
    entityId: property.id,
    entityLabel: property.title,
    details: `Bien ajouté : ${property.title} (${property.address})`,
  });

  res.status(201).json(property);
});

export const updateProperty = asyncHandler(async (req: Request, res: Response) => {
  const body = propertySchema.partial().parse(req.body);
  const imageUrl = req.file ? await uploadPublicFile(req.file, "properties") : undefined;

  const [existing] = await db.select().from(properties).where(eq(properties.id, req.params.id));
  if (!existing || existing.managerId !== req.user!.userId) throw new ApiError(404, "Bien introuvable");

  const [property] = await db
    .update(properties)
    .set({ ...body, ...(imageUrl ? { imageUrl } : {}) })
    .where(eq(properties.id, req.params.id))
    .returning();

  await logActivity({
    req,
    managerId: property.managerId,
    action: "property.update",
    entityType: "property",
    entityId: property.id,
    entityLabel: property.title,
    details: `Bien modifié : ${property.title}`,
  });

  res.json(property);
});

export const deleteProperty = asyncHandler(async (req: Request, res: Response) => {
  const [existing] = await db.select().from(properties).where(eq(properties.id, req.params.id));
  if (!existing || existing.managerId !== req.user!.userId) throw new ApiError(404, "Bien introuvable");

  const activeContracts = await db
    .select()
    .from(contracts)
    .where(eq(contracts.propertyId, req.params.id));
  if (activeContracts.some((c: typeof contracts.$inferSelect) => c.status === "ACTIVE")) {
    throw new ApiError(409, "Impossible de supprimer un bien ayant un contrat actif");
  }

  await db.delete(properties).where(eq(properties.id, req.params.id));

  await logActivity({
    req,
    managerId: existing.managerId,
    action: "property.delete",
    entityType: "property",
    entityId: existing.id,
    entityLabel: existing.title,
    details: `Bien supprimé : ${existing.title}`,
  });

  res.status(204).send();
});
