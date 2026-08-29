import { and, desc, eq } from "drizzle-orm";
import { Request, Response } from "express";
import { db } from "../db/client";
import { activityLogs } from "../db/schema";
import { asyncHandler } from "../utils/asyncHandler";

/**
 * Journal d'activité (audit log) — liste les 200 dernières actions les plus
 * récentes, filtrable par ?entityType=&entityId= (ex: l'historique d'un bien
 * ou d'un locataire précis).
 */
export const listActivityLogs = asyncHandler(async (req: Request, res: Response) => {
  const { entityType, entityId } = req.query as { entityType?: string; entityId?: string };

  const conditions = [];
  if (entityType) conditions.push(eq(activityLogs.entityType, entityType));
  if (entityId) conditions.push(eq(activityLogs.entityId, entityId));

  const rows = await db
    .select()
    .from(activityLogs)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(activityLogs.createdAt))
    .limit(200);

  res.json(rows);
});
