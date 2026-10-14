import { and, desc, eq, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { activityLogs } from "../db/schema";
import { asyncHandler } from "../utils/asyncHandler";
import { buildPaginatedResult, parsePagination } from "../utils/pagination";

/**
 * Journal d'activité (audit log) — actions du gestionnaire, de la plus récente
 * à la plus ancienne, paginées (?page=&pageSize=) et filtrables par
 * ?entityType=&entityId= (ex: l'historique d'un bien ou d'un locataire précis).
 * Avant la pagination, seules les 200 dernières étaient renvoyées : tout ce qui
 * était plus ancien (jusqu'à un an de journal conservé) restait introuvable.
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

  const pagination = parsePagination(req);
  const where = and(...conditions);

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(activityLogs).where(where);
  // `id` départage les entrées du même instant : sans lui, deux pages pourraient
  // se recouvrir ou laisser une ligne de côté.
  const rows = await db
    .select()
    .from(activityLogs)
    .where(where)
    .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
    .limit(pagination.pageSize)
    .offset(pagination.offset);

  res.json(buildPaginatedResult(rows, count, pagination));
});
