import { desc, eq } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { contracts, properties, tenants } from "../db/schema";
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

export const listProperties = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await db.select().from(properties).orderBy(desc(properties.createdAt));
  res.json(rows);
});

export const getProperty = asyncHandler(async (req: Request, res: Response) => {
  const [property] = await db.select().from(properties).where(eq(properties.id, req.params.id));
  if (!property) throw new ApiError(404, "Bien introuvable");

  const propertyContracts = await db
    .select({ contract: contracts, tenant: tenants })
    .from(contracts)
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .where(eq(contracts.propertyId, property.id))
    .orderBy(desc(contracts.createdAt));

  res.json({ ...property, contracts: propertyContracts.map((r) => ({ ...r.contract, tenant: r.tenant })) });
});

export const createProperty = asyncHandler(async (req: Request, res: Response) => {
  const body = propertySchema.parse(req.body);
  const imageUrl = req.file ? await uploadPublicFile(req.file, "properties") : undefined;

  const [property] = await db
    .insert(properties)
    .values({ ...body, imageUrl })
    .returning();
  res.status(201).json(property);
});

export const updateProperty = asyncHandler(async (req: Request, res: Response) => {
  const body = propertySchema.partial().parse(req.body);
  const imageUrl = req.file ? await uploadPublicFile(req.file, "properties") : undefined;

  const [existing] = await db.select().from(properties).where(eq(properties.id, req.params.id));
  if (!existing) throw new ApiError(404, "Bien introuvable");

  const [property] = await db
    .update(properties)
    .set({ ...body, ...(imageUrl ? { imageUrl } : {}) })
    .where(eq(properties.id, req.params.id))
    .returning();
  res.json(property);
});

export const deleteProperty = asyncHandler(async (req: Request, res: Response) => {
  const [existing] = await db.select().from(properties).where(eq(properties.id, req.params.id));
  if (!existing) throw new ApiError(404, "Bien introuvable");

  const activeContracts = await db
    .select()
    .from(contracts)
    .where(eq(contracts.propertyId, req.params.id));
  if (activeContracts.some((c) => c.status === "ACTIVE")) {
    throw new ApiError(409, "Impossible de supprimer un bien ayant un contrat actif");
  }

  await db.delete(properties).where(eq(properties.id, req.params.id));
  res.status(204).send();
});
