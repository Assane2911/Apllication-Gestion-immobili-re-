import { desc, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { suggestions } from "../db/schema";
import { asyncHandler } from "../utils/asyncHandler";
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

  res.status(201).json(creee);
});

/** Lecture réservée à l'administration de la plateforme. */
export const listSuggestions = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);

  const [lignes, [{ count }]] = await Promise.all([
    db
      .select()
      .from(suggestions)
      .orderBy(desc(suggestions.createdAt))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(suggestions),
  ]);

  res.json(buildPaginatedResult(lignes, count, pagination));
});
