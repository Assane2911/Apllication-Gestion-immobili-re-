import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { contracts, inspections, properties, tenants } from "../db/schema";
import { logActivity } from "../services/activity.service";
import { bauxDuLocataire } from "../services/colocation.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { assertOwnership, chargerCompteCourant, chargerLocataireDuCompte, idLocataireDuCompte } from "../utils/authorization";
import { assertPlanAtLeast } from "../middleware/auth";
import { buildPaginatedResult, parsePagination } from "../utils/pagination";
import { TAILLE_MAX_SIGNATURE } from "../utils/signature";

// État des lieux volontairement simplifié à un triplet nom/état/notes par
// pièce plutôt qu'une décomposition fine (murs/sol/plafond/fenêtres
// séparément) : suffisant pour documenter l'état contradictoire de chaque
// pièce sans complexifier démesurément le formulaire de saisie.
//
// Bornes larges mais réelles : le constat est stocké en base et réinjecté dans
// chaque export imprimable, il ne doit pas pouvoir enfler sans limite.
const roomSchema = z.object({
  name: z.string().min(1).max(200),
  condition: z.enum(["BON", "MOYEN", "MAUVAIS"]).default("BON"),
  notes: z.string().max(2000).optional().default(""),
});
const metersSchema = z.object({
  electricity: z.string().max(100).optional().default(""),
  water: z.string().max(100).optional().default(""),
  gas: z.string().max(100).optional().default(""),
});
const keySchema = z.object({
  label: z.string().min(1).max(200),
  quantity: z.coerce.number().int().min(0).max(1000).default(1),
});

const createInspectionSchema = z.object({
  contractId: z.string().min(1),
  type: z.enum(["ENTRY", "EXIT"]).default("ENTRY"),
});

const updateInspectionSchema = z.object({
  rooms: z.array(roomSchema).max(100).optional(),
  meters: metersSchema.optional(),
  keys: z.array(keySchema).max(50).optional(),
  generalComments: z.string().max(20_000).optional(),
  status: z.enum(["DRAFT", "COMPLETED"]).optional(),
});

const signInspectionSchema = z.object({
  signatureDataUrl: z
    .string()
    .max(TAILLE_MAX_SIGNATURE, `Signature trop volumineuse (max ${TAILLE_MAX_SIGNATURE / 1000} Ko)`)
    .regex(/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/]+={0,2}$/, "Signature invalide"),
});

/** JSON stocké en `text` (voir schema.ts) : on parse ici plutôt que de renvoyer la chaîne brute au frontend. */
function parseInspection(row: typeof inspections.$inferSelect) {
  return {
    ...row,
    rooms: row.roomsData ? JSON.parse(row.roomsData) : [],
    meters: row.metersData ? JSON.parse(row.metersData) : { electricity: "", water: "", gas: "" },
    keys: row.keysData ? JSON.parse(row.keysData) : [],
  };
}

/**
 * Tant que le constat est en brouillon, son contenu peut encore changer et le
 * locataire n'a rien à y lire : l'application ne lui montre que « en attente de
 * finalisation ». On ne lui renvoie donc que le cadre (type, statut, dates),
 * pas les observations en cours de rédaction. Le gestionnaire, lui, voit tout.
 */
function sansContenuSiBrouillon(row: typeof inspections.$inferSelect): typeof inspections.$inferSelect {
  if (row.status === "COMPLETED") return row;
  return { ...row, roomsData: null, metersData: null, keysData: null, generalComments: null };
}

export const listInspections = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);
  const whereClause = eq(inspections.managerId, req.user!.userId);

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({ inspection: inspections, property: properties, tenant: tenants })
      .from(inspections)
      .innerJoin(properties, eq(inspections.propertyId, properties.id))
      .innerJoin(tenants, eq(inspections.tenantId, tenants.id))
      .where(whereClause)
      .orderBy(desc(inspections.createdAt))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(inspections).where(whereClause),
  ]);

  const items = rows.map((r: { inspection: typeof inspections.$inferSelect; property: typeof properties.$inferSelect; tenant: typeof tenants.$inferSelect }) => ({
    ...parseInspection(r.inspection),
    property: r.property,
    tenant: r.tenant,
  }));

  res.json(buildPaginatedResult(items, count, pagination));
});

export const getInspection = asyncHandler(async (req: Request, res: Response) => {
  const [row] = await db
    .select({ inspection: inspections, property: properties, tenant: tenants })
    .from(inspections)
    .innerJoin(properties, eq(inspections.propertyId, properties.id))
    .innerJoin(tenants, eq(inspections.tenantId, tenants.id))
    .where(eq(inspections.id, req.params.id));
  assertOwnership(row, (r) => r.inspection.managerId, req.user!.userId, "État des lieux introuvable");

  res.json({ ...parseInspection(row.inspection), property: row.property, tenant: row.tenant });
});

/**
 * Pour le locataire : les états des lieux de ses baux (liste à plat, comme myContracts). Un
 * colocataire voit ceux du bail qu'il occupe, au même titre que le bail lui-même ; la signature,
 * elle, reste au titulaire (voir signInspection).
 */
export const myInspections = asyncHandler(async (req: Request, res: Response) => {
  const fiche = await chargerLocataireDuCompte(req);
  const baux = await bauxDuLocataire(fiche.id);

  const rows = await db
    .select({ inspection: inspections, property: properties })
    .from(inspections)
    .innerJoin(properties, eq(inspections.propertyId, properties.id))
    // inArray refuse une liste vide : un locataire sans aucun bail ne cherche que par sa fiche.
    .where(baux.size > 0 ? or(eq(inspections.tenantId, fiche.id), inArray(inspections.contractId, [...baux.keys()])) : eq(inspections.tenantId, fiche.id))
    .orderBy(desc(inspections.createdAt));

  res.json(rows.map((r: { inspection: typeof inspections.$inferSelect; property: typeof properties.$inferSelect }) => ({
    ...parseInspection(sansContenuSiBrouillon(r.inspection)),
    property: r.property,
  })));
});

export const createInspection = asyncHandler(async (req: Request, res: Response) => {
  const body = createInspectionSchema.parse(req.body);

  const [contract] = await db.select().from(contracts).where(eq(contracts.id, body.contractId));
  if (!contract) throw new ApiError(404, "Contrat introuvable");
  const [property] = await db.select().from(properties).where(eq(properties.id, contract.propertyId));
  assertOwnership(property, (p) => p.managerId, req.user!.userId, "Contrat introuvable");

  const [inspection] = await db
    .insert(inspections)
    .values({
      contractId: contract.id,
      propertyId: contract.propertyId,
      managerId: req.user!.userId,
      tenantId: contract.tenantId,
      type: body.type,
    })
    .returning();

  await logActivity({
    req,
    managerId: property.managerId,
    action: "inspection.create",
    entityType: "inspection",
    entityId: inspection.id,
    entityLabel: `${property.title} — ${body.type === "ENTRY" ? "Entrée" : "Sortie"}`,
    details: `État des lieux ${body.type === "ENTRY" ? "d'entrée" : "de sortie"} créé pour ${property.title}`,
  });

  res.status(201).json({ ...parseInspection(inspection), property });
});

export const updateInspection = asyncHandler(async (req: Request, res: Response) => {
  const body = updateInspectionSchema.parse(req.body);

  const [existing] = await db.select().from(inspections).where(eq(inspections.id, req.params.id));
  assertOwnership(existing, (e) => e.managerId, req.user!.userId, "État des lieux introuvable");

  // Une fois finalisé (COMPLETED), le contenu constaté contradictoirement ne
  // doit plus bouger — seule la signature est encore possible. Sans ce garde-
  // fou, un gestionnaire pourrait modifier l'état des lieux après coup, y
  // compris après que le locataire l'a déjà signé, ce qui viderait la
  // signature de tout son sens probatoire.
  const editsContent = body.rooms !== undefined || body.meters !== undefined || body.keys !== undefined || body.generalComments !== undefined;
  if (existing.status === "COMPLETED" && editsContent) {
    throw new ApiError(409, "Impossible de modifier le contenu d'un état des lieux déjà finalisé");
  }

  // Repasser de COMPLETED à DRAFT n'a plus de sens dès qu'une signature existe
  // (elle porterait alors sur un contenu qui a pu changer depuis).
  if (body.status === "DRAFT" && existing.status === "COMPLETED" && (existing.signedByManagerAt || existing.signedByTenantAt)) {
    throw new ApiError(409, "Impossible de repasser en brouillon un état des lieux déjà signé");
  }

  const values: Partial<typeof inspections.$inferInsert> = {};
  if (body.rooms !== undefined) values.roomsData = JSON.stringify(body.rooms);
  if (body.meters !== undefined) values.metersData = JSON.stringify(body.meters);
  if (body.keys !== undefined) values.keysData = JSON.stringify(body.keys);
  if (body.generalComments !== undefined) values.generalComments = body.generalComments;
  if (body.status !== undefined) values.status = body.status;

  const [updated] = await db.update(inspections).set(values).where(eq(inspections.id, req.params.id)).returning();

  if (body.status === "COMPLETED" && existing.status !== "COMPLETED") {
    const [property] = await db.select().from(properties).where(eq(properties.id, updated.propertyId));
    await logActivity({
      req,
      managerId: req.user!.userId,
      action: "inspection.finalize",
      entityType: "inspection",
      entityId: updated.id,
      entityLabel: property?.title || "",
      details: `État des lieux finalisé pour ${property?.title || "un bien"}`,
    });
  }

  res.json(parseInspection(updated));
});

export const deleteInspection = asyncHandler(async (req: Request, res: Response) => {
  const [existing] = await db.select().from(inspections).where(eq(inspections.id, req.params.id));
  assertOwnership(existing, (e) => e.managerId, req.user!.userId, "État des lieux introuvable");

  if (existing.status === "COMPLETED" || existing.signedByManagerAt || existing.signedByTenantAt) {
    throw new ApiError(409, "Impossible de supprimer un état des lieux finalisé ou déjà signé");
  }

  await db.delete(inspections).where(eq(inspections.id, req.params.id));
  res.status(204).send();
});

/** Signature électronique (gestionnaire ou locataire) — même mécanisme que signContract. */
export const signInspection = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise", "AUTH_REQUIRED");
  const { signatureDataUrl } = signInspectionSchema.parse(req.body);

  const [inspection] = await db.select().from(inspections).where(eq(inspections.id, req.params.id));
  if (!inspection) throw new ApiError(404, "État des lieux introuvable");

  // Signer un constat encore en brouillon n'a pas de sens : le contenu peut
  // encore changer, la signature contradictoire doit porter sur un état
  // des lieux finalisé (voir updateInspection, même verrou dans l'autre sens).
  if (inspection.status !== "COMPLETED") {
    throw new ApiError(409, "L'état des lieux doit être finalisé avant signature");
  }

  /** Une signature engage les parties : qui a signé, et quand, doit rester visible dans le journal. */
  const tracerSignature = async (qui: "locataire" | "gestionnaire") => {
    const [bien] = await db.select().from(properties).where(eq(properties.id, inspection.propertyId));
    await logActivity({
      req,
      managerId: inspection.managerId,
      action: "inspection.sign",
      entityType: "inspection",
      entityId: inspection.id,
      entityLabel: bien?.title || "",
      details: `État des lieux signé électroniquement par le ${qui} (${bien?.title || "un bien"})`,
    });
  };

  if (req.user.role === "TENANT") {
    if (inspection.tenantId !== (await idLocataireDuCompte(req))) throw new ApiError(403, "Accès refusé", "ACCESS_DENIED");
    const [updated] = await db
      .update(inspections)
      .set({ signedByTenantAt: new Date(), tenantSignatureUrl: signatureDataUrl })
      .where(and(eq(inspections.id, req.params.id), isNull(inspections.signedByTenantAt)))
      .returning();
    if (!updated) throw new ApiError(409, "Vous avez déjà signé cet état des lieux : une signature ne se remplace pas.");
    await tracerSignature("locataire");
    return res.json(parseInspection(updated));
  }

  if (req.user.role === "MANAGER") {
    assertOwnership(inspection, (i) => i.managerId, req.user.userId, "Accès refusé", 403);
    // Signature électronique : fonctionnalité Pro (CGU §3) — même règle que
    // signContract (contract.controller.ts). Le locataire (branche
    // ci-dessus) n'est jamais restreint par la formule de son gestionnaire.
    assertPlanAtLeast(await chargerCompteCourant(req), "PRO");
    const [updated] = await db
      .update(inspections)
      .set({ signedByManagerAt: new Date(), managerSignatureUrl: signatureDataUrl })
      .where(and(eq(inspections.id, req.params.id), isNull(inspections.signedByManagerAt)))
      .returning();
    if (!updated) throw new ApiError(409, "Cet état des lieux est déjà signé par le gestionnaire : une signature ne se remplace pas.");
    await tracerSignature("gestionnaire");
    return res.json(parseInspection(updated));
  }

  throw new ApiError(403, "Accès refusé", "ACCESS_DENIED");
});

/** Utilisé par document.controller.ts (export HTML certifié) : mêmes règles d'accès que le contenu lui-même. */
export async function loadInspectionForExport(inspectionId: string) {
  const [row] = await db
    .select({ inspection: inspections, property: properties, tenant: tenants })
    .from(inspections)
    .innerJoin(properties, eq(inspections.propertyId, properties.id))
    .innerJoin(tenants, eq(inspections.tenantId, tenants.id))
    .where(eq(inspections.id, inspectionId));
  if (!row) return null;
  return { ...parseInspection(row.inspection), property: row.property, tenant: row.tenant };
}
