import { and, desc, eq } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { activityLogs } from "../db/schema";
import { asyncHandler } from "../utils/asyncHandler";

/**
 * Journal d'activité (audit log) — liste les 200 dernières actions les plus
 * récentes, filtrable par ?entityType=&entityId= (ex: l'historique d'un bien
 * ou d'un locataire précis).
 */
/**
 * Filtres de la route. `.optional()` sans `.catch()` : un parametre repete ou
 * mal forme doit donner un 400 explicite, pas etre avale en silence — sans
 * quoi l'appelant croirait son filtre applique alors qu'il a ete ignore.
 */
const filtreJournalSchema = z.object({
  entityType: z.string().min(1).max(100).optional(),
  entityId: z.string().min(1).max(100).optional(),
});

export const listActivityLogs = asyncHandler(async (req: Request, res: Response) => {
  // `as { entityType?: string }` etait une promesse que rien ne tenait :
  // Express rend un TABLEAU des qu'un parametre est repete (?entityType=a&
  // entityType=b) et un objet pour ?entityType[x]=1. Le tableau partait tel
  // quel dans eq(), Postgres refusait le parametre, et un filtre mal forme
  // — ou une URL bricolee — se soldait par une erreur 500 au lieu d'etre
  // simplement ignore. Zod verifie au lieu d'affirmer.
  const { entityType, entityId } = filtreJournalSchema.parse(req.query);

  const conditions = [eq(activityLogs.managerId, req.user!.userId)];
  if (entityType) conditions.push(eq(activityLogs.entityType, entityType));
  if (entityId) conditions.push(eq(activityLogs.entityId, entityId));

  const rows = await db
    .select()
    .from(activityLogs)
    .where(and(...conditions))
    .orderBy(desc(activityLogs.createdAt))
    .limit(200);

  res.json(rows);
});
