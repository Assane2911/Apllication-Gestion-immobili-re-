import { desc, eq, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { suggestions } from "../db/schema";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { chargerCompteCourant } from "../utils/authorization";
import { buildPaginatedResult, parsePagination } from "../utils/pagination";

/**
 * Une suggestion est une phrase, pas un formulaire.
 *
 * Le minimum exigé est délibérément bas — quelques caractères — parce que
 * chaque champ obligatoire supplémentaire est une raison de renoncer, et
 * qu'une idée qu'on renonce à écrire ne vaut rien. Le plafond, lui, protège
 * la base d'un collage accidentel.
 */
const suggestionSchema = z.object({
  message: z.string().trim().min(5, "Dites-nous en un peu plus.").max(4000),
  // Le chemin d'où part la suggestion, pour la comprendre sans aller-retour.
  // Facultatif : un client qui ne l'envoie pas ne doit pas être refusé.
  page: z.string().max(200).optional().nullable(),
});

/** Où en est une idée. Liste fermée : les onglets et libellés du frontend en dépendent. */
export const SUGGESTION_STATUSES = ["NEW", "PLANNED", "DONE", "DECLINED"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

/** N'importe quel utilisateur connecté peut proposer quelque chose. */
export const createSuggestion = asyncHandler(async (req: Request, res: Response) => {
  const body = suggestionSchema.parse(req.body ?? {});
  const compte = await chargerCompteCourant(req);

  const [creee] = await db
    .insert(suggestions)
    .values({
      authorId: compte.id,
      // L'email est recopié, pas seulement référencé : la suggestion survit à
      // la suppression du compte, et sans cette copie elle deviendrait un
      // texte anonyme que plus personne ne pourrait rattacher ni recontacter.
      authorLabel: compte.email,
      authorRole: compte.role,
      page: body.page ?? null,
      message: body.message,
    })
    .returning();

  // Liste blanche : `status` et surtout `adminNote` (note INTERNE de
  // l'administration) n'ont rien à faire dans la réponse faite à l'auteur.
  res.status(201).json({
    id: creee.id,
    authorLabel: creee.authorLabel,
    authorRole: creee.authorRole,
    page: creee.page,
    message: creee.message,
    createdAt: creee.createdAt,
  });
});

const listQuerySchema = z.object({
  status: z.enum(SUGGESTION_STATUSES).optional(),
});

/**
 * Liste réservée à l'administration, filtrable par statut. Renvoie aussi le
 * nombre de suggestions PAR statut (toutes pages, indépendamment du filtre),
 * pour que les onglets de l'écran disent combien attend d'être lu.
 */
export const listSuggestions = asyncHandler(async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ApiError(400, "Paramètres de recherche invalides");
  const { status } = parsed.data;
  const pagination = parsePagination(req);
  const where = status ? eq(suggestions.status, status) : undefined;

  const [lignes, [{ count }], parStatut] = await Promise.all([
    db
      .select()
      .from(suggestions)
      .where(where)
      .orderBy(desc(suggestions.createdAt), desc(suggestions.id))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(suggestions).where(where),
    db
      .select({ status: suggestions.status, count: sql<number>`count(*)::int` })
      .from(suggestions)
      .groupBy(suggestions.status),
  ]);

  const counts: Record<SuggestionStatus, number> & { total: number } = {
    NEW: 0,
    PLANNED: 0,
    DONE: 0,
    DECLINED: 0,
    total: 0,
  };
  for (const ligne of parStatut) {
    if ((SUGGESTION_STATUSES as readonly string[]).includes(ligne.status)) {
      counts[ligne.status as SuggestionStatus] = ligne.count;
    }
    counts.total += ligne.count;
  }

  res.json({ ...buildPaginatedResult(lignes, count, pagination), counts });
});

const updateSuggestionSchema = z
  .object({
    status: z.enum(SUGGESTION_STATUSES).optional(),
    // Chaîne vide = effacer la note.
    adminNote: z.string().trim().max(2000).optional(),
  })
  .refine((b) => b.status !== undefined || b.adminNote !== undefined, {
    message: "Rien à modifier",
  });

/**
 * Met à jour le suivi d'une suggestion (statut et/ou note interne).
 * Réservé à l'administration. Ne touche jamais au message ni à l'auteur : ce
 * que l'utilisateur a écrit reste tel quel.
 */
export const updateSuggestion = asyncHandler(async (req: Request, res: Response) => {
  const body = updateSuggestionSchema.safeParse(req.body ?? {});
  if (!body.success) throw new ApiError(400, body.error.issues[0]?.message ?? "Paramètres invalides");

  const changements: Partial<typeof suggestions.$inferInsert> = {};
  if (body.data.status !== undefined) changements.status = body.data.status;
  if (body.data.adminNote !== undefined) changements.adminNote = body.data.adminNote === "" ? null : body.data.adminNote;

  const [maj] = await db.update(suggestions).set(changements).where(eq(suggestions.id, req.params.id)).returning();
  if (!maj) throw new ApiError(404, "Suggestion introuvable");

  res.json(maj);
});
