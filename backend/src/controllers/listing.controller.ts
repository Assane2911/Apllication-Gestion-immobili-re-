import { and, desc, eq, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { listingLeads, listings } from "../db/schema";
import { assertFileContentMatchesDeclaredType } from "../middleware/upload";
import { logActivity } from "../services/activity.service";
import { uploadPublicFile } from "../services/storage.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { deleteStorageObjectBestEffort } from "../services/storage.service";
import { assertOwnership } from "../utils/authorization";
import { buildPaginatedResult, parsePagination } from "../utils/pagination";

/**
 * Module "CRM Leads & Visites" + vitrine publique : annonces (listings)
 * publiables par le gestionnaire, consultables sans authentification par
 * n'importe quel visiteur (avec filtrage par pays — "Filtrage Pays"), et
 * demandes de contact/visite (listingLeads) qu'un visiteur peut soumettre
 * sans compte, qui atterrissent ensuite dans un CRM côté gestionnaire.
 *
 * Les tables `listings`/`listingLeads` existent déjà en base (voir la note en
 * tête de schema.ts : créées directement en base en parallèle de ce
 * chantier), avec des contraintes CHECK non modélisées dans Drizzle — les
 * enums Zod ci-dessous DOIVENT rester synchronisés avec ces contraintes
 * (voir les valeurs listées dans les commentaires de schema.ts), sous peine
 * de laisser passer côté applicatif une valeur que la base rejettera.
 */
const LISTING_TYPES = ["RENT", "SALE", "PROMOTION", "LAND", "OTHER"] as const;
const LISTING_STATUSES = ["PUBLISHED", "DRAFT", "ARCHIVED"] as const;
const PRICE_PERIODS = ["MONTH", "ONE_TIME"] as const;
const LEAD_REQUEST_TYPES = ["VISIT", "INFO"] as const;
const LEAD_STATUSES = ["NEW", "CONTACTED", "VISITED", "CONVERTED", "ARCHIVED"] as const;

// Un champ booléen envoyé en multipart/form-data (upload d'image oblige,
// comme property.controller.ts) arrive toujours sous forme de chaîne
// ("true"/"false"), jamais de vrai booléen JSON — z.coerce.boolean() serait
// piégeux ici : TOUTE chaîne non vide (y compris "false") est "truthy" et
// deviendrait donc `true`.
const booleanField = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => v === true || v === "true");

const listingSchema = z.object({
  type: z.enum(LISTING_TYPES).optional(),
  title: z.string().min(2),
  description: z.string().min(2),
  price: z.coerce.number().positive(),
  currency: z.string().min(1).max(10).optional(),
  pricePeriod: z.enum(PRICE_PERIODS).optional(),
  surface: z.coerce.number().positive().optional(),
  rooms: z.coerce.number().int().positive().optional(),
  location: z.string().min(2),
  contactPhone: z.string().optional(),
  contactWhatsapp: z.string().optional(),
  contactEmail: z.string().email().optional(),
  status: z.enum(LISTING_STATUSES).optional(),
  featured: booleanField,
  // Code pays ISO 3166-1 alpha-2 (ex: "SN", "FR") — c'est la clé du filtrage
  // pays côté vitrine publique (listPublicCountries/listPublicListings
  // ci-dessous) : une annonce sans pays renseigné n'apparaîtra jamais dans un
  // filtre par pays, d'où le format contraint (mais le champ reste optionnel
  // pour rester compatible avec des lignes existantes créées hors API).
  country: z.string().length(2).optional(),
});

const publicFilterSchema = z.object({
  country: z.string().length(2).optional(),
  type: z.enum(LISTING_TYPES).optional(),
});

const leadSchema = z.object({
  prospectName: z.string().min(2),
  prospectEmail: z.string().email(),
  prospectPhone: z.string().min(6),
  requestType: z.enum(LEAD_REQUEST_TYPES).optional(),
  preferredDate: z.coerce.date().optional(),
  message: z.string().optional(),
});

const leadUpdateSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  notes: z.string().optional(),
});

const leadFilterSchema = z.object({
  listingId: z.string().optional(),
  status: z.enum(LEAD_STATUSES).optional(),
});

/** Retire managerId (identifiant interne du gestionnaire) des annonces exposées à un visiteur non authentifié. */
function toPublicListing(listing: typeof listings.$inferSelect) {
  const { managerId: _managerId, ...publicFields } = listing;
  return publicFields;
}

// --- Vitrine publique (aucune authentification) ---

export const listPublicListings = asyncHandler(async (req: Request, res: Response) => {
  const filters = publicFilterSchema.parse(req.query);
  const pagination = parsePagination(req);

  const whereClause = and(
    eq(listings.status, "PUBLISHED"),
    filters.country ? eq(listings.country, filters.country) : undefined,
    filters.type ? eq(listings.type, filters.type) : undefined
  );

  const [rows, [{ count }]] = await Promise.all([
    db
      .select()
      .from(listings)
      .where(whereClause)
      .orderBy(desc(listings.featured), desc(listings.createdAt))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(listings).where(whereClause),
  ]);

  res.json(buildPaginatedResult(rows.map(toPublicListing), count, pagination));
});

/**
 * Pays pour lesquels au moins une annonce est actuellement PUBLISHED — sert à
 * peupler le sélecteur de filtrage pays côté vitrine sans jamais proposer un
 * pays dont le résultat serait systématiquement vide.
 */
export const listPublicCountries = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await db
    .selectDistinct({ country: listings.country })
    .from(listings)
    .where(eq(listings.status, "PUBLISHED"));

  const countries = rows
    .map((r: { country: string | null }) => r.country)
    .filter((c: string | null): c is string => Boolean(c))
    .sort();

  res.json({ countries });
});

export const getPublicListing = asyncHandler(async (req: Request, res: Response) => {
  const [listing] = await db.select().from(listings).where(eq(listings.id, req.params.id));
  // Une annonce DRAFT/ARCHIVED renvoie 404 comme si elle n'existait pas —
  // jamais un 403 qui confirmerait au visiteur qu'une annonce existe mais lui
  // est cachée (même principe de non-divulgation que le 404 d'ownership côté
  // gestionnaire ailleurs dans l'app).
  if (!listing || listing.status !== "PUBLISHED") throw new ApiError(404, "Annonce introuvable");

  res.json(toPublicListing(listing));
});

/**
 * Un visiteur non authentifié soumet une demande de visite ou d'information
 * sur une annonce publiée — c'est la SEULE écriture en base de tout le
 * backend accessible sans authentification (voir listingLeadLimiter,
 * rateLimit.ts, monté sur cette route). Le lead est rattaché au gestionnaire
 * propriétaire de l'annonce (jamais choisi par l'appelant), pour qu'il
 * atterrisse dans le bon CRM.
 */
export const createPublicLead = asyncHandler(async (req: Request, res: Response) => {
  const body = leadSchema.parse(req.body);

  const [listing] = await db.select().from(listings).where(eq(listings.id, req.params.id));
  if (!listing || listing.status !== "PUBLISHED") throw new ApiError(404, "Annonce introuvable");

  const [lead] = await db
    .insert(listingLeads)
    .values({
      listingId: listing.id,
      managerId: listing.managerId,
      prospectName: body.prospectName,
      prospectEmail: body.prospectEmail,
      prospectPhone: body.prospectPhone,
      requestType: body.requestType,
      preferredDate: body.preferredDate,
      message: body.message,
    })
    .returning();

  await logActivity({
    managerId: listing.managerId,
    action: "listing_lead.create",
    entityType: "listing_lead",
    entityId: lead.id,
    entityLabel: body.prospectName,
    details: `Nouvelle demande (${body.requestType ?? "VISIT"}) reçue via la vitrine pour l'annonce « ${listing.title} »`,
  });

  res.status(201).json({ message: "Demande envoyée avec succès" });
});

// --- CRM gestionnaire (authentifié) ---

async function loadListingForManager(listingId: string, managerId: string) {
  const [listing] = await db.select().from(listings).where(eq(listings.id, listingId));
  if (!listing || listing.managerId !== managerId) throw new ApiError(404, "Annonce introuvable");
  return listing;
}

export const listListings = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);
  const whereClause = eq(listings.managerId, req.user!.userId);

  const [rows, [{ count }]] = await Promise.all([
    db
      .select()
      .from(listings)
      .where(whereClause)
      .orderBy(desc(listings.createdAt))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(listings).where(whereClause),
  ]);

  res.json(buildPaginatedResult(rows, count, pagination));
});

export const getListing = asyncHandler(async (req: Request, res: Response) => {
  const listing = await loadListingForManager(req.params.id, req.user!.userId);
  res.json(listing);
});

export const createListing = asyncHandler(async (req: Request, res: Response) => {
  const body = listingSchema.parse(req.body);
  assertFileContentMatchesDeclaredType(req.file);
  const imageUrl = req.file ? await uploadPublicFile(req.file, "listings") : undefined;

  const [listing] = await db
    .insert(listings)
    .values({
      ...body,
      currency: body.currency || "EUR",
      imageUrl,
      managerId: req.user!.userId,
    })
    .returning();

  await logActivity({
    req,
    managerId: listing.managerId,
    action: "listing.create",
    entityType: "listing",
    entityId: listing.id,
    entityLabel: listing.title,
    details: `Annonce créée : ${listing.title} (${listing.location})`,
  });

  res.status(201).json(listing);
});

export const updateListing = asyncHandler(async (req: Request, res: Response) => {
  const body = listingSchema.partial().parse(req.body);
  const existing = await loadListingForManager(req.params.id, req.user!.userId);

  // La vérification de propriété (loadListingForManager, ci-dessus) doit
  // précéder l'upload — même garde-fou que updateProperty
  // (property.controller.ts) : sinon un gestionnaire pouvait faire stocker un
  // fichier arbitraire sur notre infrastructure en visant l'id de l'annonce
  // d'un AUTRE gestionnaire, le 404 n'arrivant qu'après coup.
  assertFileContentMatchesDeclaredType(req.file);
  const imageUrl = req.file ? await uploadPublicFile(req.file, "listings") : undefined;

  const [listing] = await db
    .update(listings)
    .set({ ...body, ...(imageUrl ? { imageUrl } : {}) })
    .where(eq(listings.id, existing.id))
    .returning();

  await logActivity({
    req,
    managerId: listing.managerId,
    action: "listing.update",
    entityType: "listing",
    entityId: listing.id,
    entityLabel: listing.title,
    details: `Annonce modifiée : ${listing.title}`,
  });

  res.json(listing);
});

export const deleteListing = asyncHandler(async (req: Request, res: Response) => {
  const existing = await loadListingForManager(req.params.id, req.user!.userId);

  // Contrairement à un bien (property) rattaché à des contrats actifs, une
  // annonce n'a aucune donnée contractuelle qui en dépend : ses demandes de
  // contact (listingLeads) sont de simples enregistrements CRM, pas des
  // engagements juridiques — elles sont supprimées en cascade (onDelete
  // "cascade", voir schema.ts) sans qu'il soit nécessaire de bloquer la
  // suppression de l'annonce.
  await db.delete(listings).where(eq(listings.id, existing.id));

  // Le fichier doit partir avec la ligne qui le référence : une fois celle-ci
  // supprimée, plus rien ne permet de le retrouver pour le purger ensuite.
  // Nettoyage best-effort et APRÈS la suppression en base (voir
  // deleteStorageObjectBestEffort) : un stockage indisponible ne doit jamais
  // faire échouer une suppression demandée par l'utilisateur.
  // Le `catch` est ici, et pas seulement dans le service : best-effort
  // signifie que la suppression déjà enregistrée en base doit répondre
  // succès même si le stockage est indisponible.
  await deleteStorageObjectBestEffort(existing.imageUrl).catch(() => undefined);

  await logActivity({
    req,
    managerId: existing.managerId,
    action: "listing.delete",
    entityType: "listing",
    entityId: existing.id,
    entityLabel: existing.title,
    details: `Annonce supprimée : ${existing.title}`,
  });

  res.status(204).send();
});

// --- CRM Leads (authentifié) ---

export const listListingLeads = asyncHandler(async (req: Request, res: Response) => {
  const filters = leadFilterSchema.parse(req.query);
  const pagination = parsePagination(req);

  const whereClause = and(
    eq(listingLeads.managerId, req.user!.userId),
    filters.listingId ? eq(listingLeads.listingId, filters.listingId) : undefined,
    filters.status ? eq(listingLeads.status, filters.status) : undefined
  );

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({ lead: listingLeads, listing: listings })
      .from(listingLeads)
      .innerJoin(listings, eq(listingLeads.listingId, listings.id))
      .where(whereClause)
      .orderBy(desc(listingLeads.createdAt))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(listingLeads).where(whereClause),
  ]);

  const items = rows.map((r: { lead: typeof listingLeads.$inferSelect; listing: typeof listings.$inferSelect }) => ({
    ...r.lead,
    listingTitle: r.listing.title,
  }));

  res.json(buildPaginatedResult(items, count, pagination));
});

export const updateListingLead = asyncHandler(async (req: Request, res: Response) => {
  const body = leadUpdateSchema.parse(req.body);

  const [existing] = await db.select().from(listingLeads).where(eq(listingLeads.id, req.params.id));
  assertOwnership(existing, (e) => e.managerId, req.user!.userId, "Demande introuvable");

  const [lead] = await db.update(listingLeads).set(body).where(eq(listingLeads.id, existing.id)).returning();

  await logActivity({
    req,
    managerId: lead.managerId,
    action: "listing_lead.update",
    entityType: "listing_lead",
    entityId: lead.id,
    entityLabel: lead.prospectName,
    details: `Demande mise à jour : ${lead.prospectName} → ${lead.status}`,
  });

  res.json(lead);
});
