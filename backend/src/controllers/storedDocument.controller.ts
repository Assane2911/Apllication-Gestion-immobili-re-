import { and, desc, eq, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { properties, storedDocuments, tenants } from "../db/schema";
import { logActivity } from "../services/activity.service";
import { deleteStorageObjectBestEffort, getSignedUrl, uploadPrivateFile } from "../services/storage.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { assertOwnership } from "../utils/authorization";
import { CATEGORIES_DOCUMENT, MAX_DOCUMENTS_PAR_RATTACHEMENT } from "../utils/categoriesDocument";
import { dateSaisieSchema } from "../utils/dates";
import { buildPaginatedResult, parsePagination } from "../utils/pagination";
import { assertFileContentMatchesDeclaredType } from "../middleware/upload";

/** Durée du lien d'accès : le temps d'ouvrir ou de télécharger le fichier, pas davantage (le document peut être sensible). */
const DUREE_LIEN_SECONDES = 300;

// Un champ de formulaire vide arrive en chaîne vide : c'est « pas de valeur », pas une date invalide.
const videEnAbsent = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const depotSchema = z
  .object({
    propertyId: z.preprocess(videEnAbsent, z.string().min(1).optional()),
    tenantId: z.preprocess(videEnAbsent, z.string().min(1).optional()),
    category: z.enum(CATEGORIES_DOCUMENT).default("OTHER"),
    title: z.string().trim().min(1).max(200),
    expiresAt: z.preprocess(videEnAbsent, dateSaisieSchema.optional()),
    notes: z.preprocess(videEnAbsent, z.string().max(2000).optional()),
  })
  .refine((d) => d.propertyId || d.tenantId, { message: "Rattachez le document à un bien ou à un locataire", path: ["propertyId"] });

const modificationSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  category: z.enum(CATEGORIES_DOCUMENT).optional(),
  expiresAt: dateSaisieSchema.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const listeSchema = z.object({
  propertyId: z.string().min(1).optional(),
  tenantId: z.string().min(1).optional(),
  category: z.enum(CATEGORIES_DOCUMENT).optional(),
});

/** Nom d'origine du fichier, ramené à un texte affichable : sans chemin, sans caractère de contrôle, borné. */
function nomAffichable(nom: string | undefined, repli: string): string {
  const propre = (nom ?? "").replace(/[\\/]/g, "_").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
  return propre || repli;
}

async function documentDuGestionnaire(req: Request) {
  const [doc] = await db.select().from(storedDocuments).where(eq(storedDocuments.id, req.params.id));
  assertOwnership(doc, (d) => d.managerId, req.user!.userId, "Document introuvable", 404, "STORED_DOCUMENT_NOT_FOUND");
  return doc;
}

export const listStoredDocuments = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);
  const filtres = listeSchema.parse(req.query);

  const conditions = [eq(storedDocuments.managerId, req.user!.userId)];
  if (filtres.propertyId) conditions.push(eq(storedDocuments.propertyId, filtres.propertyId));
  if (filtres.tenantId) conditions.push(eq(storedDocuments.tenantId, filtres.tenantId));
  if (filtres.category) conditions.push(eq(storedDocuments.category, filtres.category));
  const where = and(...conditions);

  const [lignes, [{ count }]] = await Promise.all([
    db
      .select({ doc: storedDocuments, bien: properties.title, locataire: tenants })
      .from(storedDocuments)
      .leftJoin(properties, eq(storedDocuments.propertyId, properties.id))
      .leftJoin(tenants, eq(storedDocuments.tenantId, tenants.id))
      .where(where)
      .orderBy(desc(storedDocuments.createdAt))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(storedDocuments).where(where),
  ]);

  const items = lignes.map(({ doc, bien, locataire }: { doc: typeof storedDocuments.$inferSelect; bien: string | null; locataire: typeof tenants.$inferSelect | null }) => {
    // Le chemin du stockage reste côté serveur : le fichier s'ouvre par un lien temporaire (voir getStoredDocumentLink).
    const { filePath: _chemin, ...visible } = doc;
    return { ...visible, propertyTitle: bien, tenantName: locataire ? `${locataire.firstName} ${locataire.lastName}`.trim() : null };
  });
  res.json(buildPaginatedResult(items, count, pagination));
});

export const createStoredDocument = asyncHandler(async (req: Request, res: Response) => {
  const managerId = req.user!.userId;
  if (!req.file) throw new ApiError(400, "Aucun fichier fourni.", "STORED_DOCUMENT_FILE_REQUIRED");
  const body = depotSchema.parse(req.body);

  let titreBien: string | undefined;
  if (body.propertyId) {
    const [bien] = await db.select().from(properties).where(eq(properties.id, body.propertyId));
    assertOwnership(bien, (p) => p.managerId, managerId, "Bien introuvable", 404, "PROPERTY_NOT_FOUND");
    titreBien = bien.title;
  }
  let nomLocataire: string | undefined;
  if (body.tenantId) {
    const [locataire] = await db.select().from(tenants).where(eq(tenants.id, body.tenantId));
    assertOwnership(locataire, (t) => t.managerId, managerId, "Locataire introuvable", 404, "TENANT_NOT_FOUND");
    nomLocataire = `${locataire.firstName} ${locataire.lastName}`.trim();
  }

  const rattachement = body.tenantId ? eq(storedDocuments.tenantId, body.tenantId) : eq(storedDocuments.propertyId, body.propertyId!);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(storedDocuments).where(and(eq(storedDocuments.managerId, managerId), rattachement));
  if (count >= MAX_DOCUMENTS_PAR_RATTACHEMENT) {
    throw new ApiError(409, `Limite de ${MAX_DOCUMENTS_PAR_RATTACHEMENT} documents atteinte pour ce bien ou ce locataire.`, "STORED_DOCUMENT_LIMIT", { max: MAX_DOCUMENTS_PAR_RATTACHEMENT });
  }

  assertFileContentMatchesDeclaredType(req.file);
  const chemin = await uploadPrivateFile(req.file, "documents");

  let cree: typeof storedDocuments.$inferSelect;
  try {
    [cree] = await db
      .insert(storedDocuments)
      .values({
        managerId,
        propertyId: body.propertyId ?? null,
        tenantId: body.tenantId ?? null,
        category: body.category,
        title: body.title,
        filePath: chemin,
        fileName: nomAffichable(req.file.originalname, body.title),
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        expiresAt: body.expiresAt ?? null,
        notes: body.notes ?? null,
        createdBy: req.user!.collaboratorId ?? req.user!.userId,
      })
      .returning();
  } catch (err) {
    // Le fichier est déjà dans le stockage : sans ligne pour le référencer, il resterait orphelin.
    await deleteStorageObjectBestEffort(chemin).catch(() => undefined);
    throw err;
  }

  await logActivity({
    req,
    managerId,
    action: "document.create",
    entityType: "document",
    entityId: cree.id,
    entityLabel: cree.title,
    details: `Document ajouté : ${cree.title}${titreBien ? ` (${titreBien})` : ""}${nomLocataire ? ` — ${nomLocataire}` : ""}`,
  });

  const { filePath: _chemin, ...visible } = cree;
  res.status(201).json({ ...visible, propertyTitle: titreBien ?? null, tenantName: nomLocataire ?? null });
});

export const updateStoredDocument = asyncHandler(async (req: Request, res: Response) => {
  const existant = await documentDuGestionnaire(req);
  const body = modificationSchema.parse(req.body);

  const valeurs: Partial<typeof storedDocuments.$inferInsert> = {};
  if (body.title !== undefined) valeurs.title = body.title;
  if (body.category !== undefined) valeurs.category = body.category;
  if (body.expiresAt !== undefined) {
    valeurs.expiresAt = body.expiresAt;
    // Nouvelle date = document renouvelé : il redevient éligible au rappel d'expiration. Renvoyer la même date
    // (formulaire rouvert puis enregistré) ne doit pas, lui, relancer un rappel déjà envoyé.
    const avant = existant.expiresAt?.getTime() ?? null;
    const apres = body.expiresAt?.getTime() ?? null;
    if (avant !== apres) valeurs.reminderSentAt = null;
  }
  if (body.notes !== undefined) valeurs.notes = body.notes;

  if (Object.keys(valeurs).length === 0) {
    const { filePath: _chemin, ...visible } = existant;
    return res.json(visible);
  }
  const [modifie] = await db.update(storedDocuments).set(valeurs).where(eq(storedDocuments.id, existant.id)).returning();
  const { filePath: _chemin, ...visible } = modifie;
  res.json(visible);
});

/** Lien temporaire d'ouverture du fichier : le chemin du stockage ne sort jamais du serveur. */
export const getStoredDocumentLink = asyncHandler(async (req: Request, res: Response) => {
  const doc = await documentDuGestionnaire(req);
  res.json({ url: await getSignedUrl(doc.filePath, DUREE_LIEN_SECONDES), fileName: doc.fileName, mimeType: doc.mimeType });
});

export const deleteStoredDocument = asyncHandler(async (req: Request, res: Response) => {
  const doc = await documentDuGestionnaire(req);
  await db.delete(storedDocuments).where(eq(storedDocuments.id, doc.id));
  // Après la suppression de la ligne : un stockage indisponible ne doit pas bloquer la suppression (voir deleteStorageObjectBestEffort).
  await deleteStorageObjectBestEffort(doc.filePath).catch(() => undefined);

  await logActivity({
    req,
    managerId: doc.managerId,
    action: "document.delete",
    entityType: "document",
    entityId: doc.id,
    entityLabel: doc.title,
    details: `Document supprimé : ${doc.title}`,
  });
  res.status(204).send();
});
