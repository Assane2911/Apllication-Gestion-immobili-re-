import { and, desc, eq, ilike, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { agencySettings, listings, users } from "../db/schema";
import { logActivity } from "../services/activity.service";
import { logAdminAction } from "../services/adminAudit.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { buildPaginatedResult, parsePagination } from "../utils/pagination";

/**
 * Modération des annonces de la vitrine publique par l'administration de la
 * plateforme.
 *
 * Masquer une annonce la retire de TOUTES les lectures publiques (liste, pays,
 * fiche, demandes de contact — voir visibleSurLaVitrine, listing.controller.ts)
 * sans rien supprimer : le gestionnaire la retrouve dans son espace, avec le
 * motif, et ses demandes de contact déjà reçues restent intactes. Seule
 * l'administration la rétablit : le gestionnaire ne peut pas lever lui-même
 * une modération (hiddenByAdminAt n'est pas un champ de son formulaire).
 */

/** Neutralise `%`, `_` et `\` pour qu'une recherche saisie soit lue littéralement dans un LIKE. */
function echapperLike(valeur: string): string {
  return valeur.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const listListingsQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  visibility: z.enum(["VISIBLE", "HIDDEN"]).optional(),
  status: z.enum(["PUBLISHED", "DRAFT", "ARCHIVED"]).optional(),
});

/**
 * Liste paginée de toutes les annonces, tous gestionnaires confondus, avec
 * recherche (titre, lieu, email ou nom d'agence) et filtres. « VISIBLE » est la
 * visibilité RÉELLE sur la vitrine (publiée ET non masquée), pas le seul
 * statut choisi par le gestionnaire.
 *
 * Réponse par liste blanche : ni coordonnées de contact de l'annonce, ni donnée
 * de compte autre que l'email et le nom d'agence du gestionnaire.
 */
export const listAdminListings = asyncHandler(async (req: Request, res: Response) => {
  const parsed = listListingsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ApiError(400, "Paramètres de recherche invalides");
  const { search, visibility, status } = parsed.data;
  const pagination = parsePagination(req);

  const conditions = [];
  if (status) conditions.push(eq(listings.status, status));
  if (visibility === "HIDDEN") conditions.push(isNotNull(listings.hiddenByAdminAt));
  if (visibility === "VISIBLE") conditions.push(and(eq(listings.status, "PUBLISHED"), isNull(listings.hiddenByAdminAt)));
  if (search) {
    const motif = `%${echapperLike(search)}%`;
    const recherche = or(
      ilike(listings.title, motif),
      ilike(listings.location, motif),
      ilike(users.email, motif),
      ilike(agencySettings.agencyName, motif)
    );
    if (recherche) conditions.push(recherche);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const base = () =>
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(listings)
      .innerJoin(users, eq(users.id, listings.managerId))
      .leftJoin(agencySettings, eq(agencySettings.userId, listings.managerId));

  const [rows, [{ count }], [{ masquees }]] = await Promise.all([
    db
      .select({
        id: listings.id,
        title: listings.title,
        type: listings.type,
        location: listings.location,
        country: listings.country,
        price: listings.price,
        currency: listings.currency,
        pricePeriod: listings.pricePeriod,
        imageUrl: listings.imageUrl,
        status: listings.status,
        featured: listings.featured,
        hiddenByAdminAt: listings.hiddenByAdminAt,
        moderationReason: listings.moderationReason,
        createdAt: listings.createdAt,
        managerId: listings.managerId,
        managerEmail: users.email,
        agencyName: agencySettings.agencyName,
      })
      .from(listings)
      .innerJoin(users, eq(users.id, listings.managerId))
      .leftJoin(agencySettings, eq(agencySettings.userId, listings.managerId))
      .where(where)
      .orderBy(desc(listings.createdAt))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    base().where(where),
    // Compteur d'en-tête : indépendant des filtres, pour qu'il ne change pas
    // quand on filtre sur « masquées ».
    db
      .select({ masquees: sql<number>`count(*)::int` })
      .from(listings)
      .where(isNotNull(listings.hiddenByAdminAt)),
  ]);

  const result = buildPaginatedResult(rows, count, pagination);
  res.json({ ...result, counts: { hidden: masquees } });
});

const hideListingSchema = z.object({
  reason: z.string().trim().min(3, "Indiquez le motif du masquage").max(500),
});

const featuredSchema = z.object({ featured: z.boolean() });

/** Annonce et email de son gestionnaire, ou 404. */
async function trouverAnnonce(id: string) {
  const [row] = await db
    .select({ listing: listings, managerEmail: users.email })
    .from(listings)
    .innerJoin(users, eq(users.id, listings.managerId))
    .where(eq(listings.id, id));
  if (!row) throw new ApiError(404, "Annonce introuvable");
  return row;
}

/**
 * Masque une annonce de la vitrine, avec un motif OBLIGATOIRE (montré au
 * gestionnaire). Réclamation atomique : deux administrateurs qui masquent en
 * même temps ne produisent qu'une trace, le second reçoit un 409.
 */
export const hideListing = asyncHandler(async (req: Request, res: Response) => {
  const { reason } = hideListingSchema.parse(req.body);
  const { listing, managerEmail } = await trouverAnnonce(req.params.id);
  if (listing.hiddenByAdminAt) throw new ApiError(409, "Cette annonce est déjà masquée");

  const [updated] = await db
    .update(listings)
    .set({ hiddenByAdminAt: new Date(), moderationReason: reason })
    .where(and(eq(listings.id, listing.id), isNull(listings.hiddenByAdminAt)))
    .returning({ hiddenByAdminAt: listings.hiddenByAdminAt });
  if (!updated) throw new ApiError(409, "Cette annonce est déjà masquée");

  await logAdminAction({
    req,
    action: "listing.hide",
    targetUserId: listing.managerId,
    targetLabel: managerEmail,
    details: `Annonce « ${listing.title} » masquée de la vitrine. Motif : ${reason}`,
  });
  // Le gestionnaire retrouve l'événement dans son journal d'activité. Sans
  // `req` : l'acteur est l'administration, pas un utilisateur de l'agence.
  await logActivity({
    managerId: listing.managerId,
    action: "listing.hide_by_admin",
    entityType: "listing",
    entityId: listing.id,
    entityLabel: listing.title,
    details: `Annonce masquée de la vitrine par l'administration. Motif : ${reason}`,
  });

  res.json({ success: true, hiddenByAdminAt: updated.hiddenByAdminAt });
});

/** Rétablit une annonce masquée : elle redevient visible si le gestionnaire l'a publiée. */
export const restoreListing = asyncHandler(async (req: Request, res: Response) => {
  const { listing, managerEmail } = await trouverAnnonce(req.params.id);
  if (!listing.hiddenByAdminAt) throw new ApiError(409, "Cette annonce n'est pas masquée");

  const [updated] = await db
    .update(listings)
    .set({ hiddenByAdminAt: null, moderationReason: null })
    .where(and(eq(listings.id, listing.id), isNotNull(listings.hiddenByAdminAt)))
    .returning({ id: listings.id });
  if (!updated) throw new ApiError(409, "Cette annonce n'est pas masquée");

  await logAdminAction({
    req,
    action: "listing.restore",
    targetUserId: listing.managerId,
    targetLabel: managerEmail,
    details: `Annonce « ${listing.title} » rétablie sur la vitrine`,
  });
  await logActivity({
    managerId: listing.managerId,
    action: "listing.restore_by_admin",
    entityType: "listing",
    entityId: listing.id,
    entityLabel: listing.title,
    details: "Annonce rétablie sur la vitrine par l'administration",
  });

  res.json({ success: true });
});

/**
 * Met en avant (ou retire de la mise en avant) une annonce. Le gestionnaire
 * choisit déjà lui-même cette option ; l'administration doit pouvoir la
 * retirer à un abus sans masquer toute l'annonce. Sans effet (200, aucune
 * trace) si l'annonce est déjà dans l'état demandé.
 */
export const setListingFeatured = asyncHandler(async (req: Request, res: Response) => {
  const { featured } = featuredSchema.parse(req.body);
  const { listing, managerEmail } = await trouverAnnonce(req.params.id);

  const [updated] = await db
    .update(listings)
    .set({ featured })
    .where(and(eq(listings.id, listing.id), ne(listings.featured, featured)))
    .returning({ id: listings.id });

  if (updated) {
    await logAdminAction({
      req,
      action: featured ? "listing.feature" : "listing.unfeature",
      targetUserId: listing.managerId,
      targetLabel: managerEmail,
      details: `Annonce « ${listing.title} » ${featured ? "mise en avant" : "retirée de la mise en avant"}`,
    });
  }

  res.json({ success: true, featured });
});
