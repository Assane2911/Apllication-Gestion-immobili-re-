import { eq } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { agencySettings } from "../db/schema";
import { ApiError, asyncHandler } from "../utils/asyncHandler";

export const getAgencySettings = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");

  let [settings] = await db
    .select()
    .from(agencySettings)
    .where(eq(agencySettings.userId, req.user.userId));

  if (!settings) {
    [settings] = await db
      .insert(agencySettings)
      .values({
        userId: req.user.userId,
        agencyName: "Agence Immobilière Privée",
        address: "Avenue Principale, Immeuble Horizon",
        phone: "+33 1 40 00 00 00",
        email: req.user.role === "MANAGER" ? "contact@monagence-immo.com" : "contact@agence.com",
        legalNotice: "Société de gestion immobilière immatriculée au RCS. Carte professionnelle de gestion n°CPI 7501.",
      })
      .returning();
  }

  res.json(settings);
});

const updateAgencySettingsSchema = z.object({
  agencyName: z.string().min(1),
  logoUrl: z.string().optional().nullable(),
  siretOrId: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  legalNotice: z.string().optional().nullable(),
  stampOrSignatureUrl: z.string().optional().nullable(),
});

export const updateAgencySettings = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");
  const body = updateAgencySettingsSchema.parse(req.body);

  const [existing] = await db
    .select()
    .from(agencySettings)
    .where(eq(agencySettings.userId, req.user.userId));

  if (!existing) {
    const [created] = await db
      .insert(agencySettings)
      .values({
        userId: req.user.userId,
        ...body,
      })
      .returning();
    return res.json(created);
  }

  const [updated] = await db
    .update(agencySettings)
    .set({
      ...body,
      updatedAt: new Date(),
    })
    .where(eq(agencySettings.userId, req.user.userId))
    .returning();

  res.json(updated);
});
