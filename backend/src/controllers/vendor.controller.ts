import { and, eq } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { vendors } from "../db/schema";
import { logActivity } from "../services/activity.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { assertOwnership } from "../utils/authorization";
import { MESSAGE_TELEPHONE_INVALIDE, versE164 } from "../utils/phone";

/**
 * Carnet de prestataires/artisans du gestionnaire — voir vendors (schema.ts).
 * Volontairement plus simple que owner.controller.ts : pas de compte portail,
 * pas de droit à l'effacement dédié (aucune donnée de tiers protégée par le
 * RGPD n'est attachée à un prestataire, seulement ses propres coordonnées
 * professionnelles).
 */
const vendorSchema = z.object({
  name: z.string().min(1),
  trade: z.string().optional(),
  // Même exigence que pour les locataires/propriétaires : format
  // international à l'enregistrement, voir tenant.controller.ts.
  phone: z
    .string()
    .refine((v) => versE164(v) !== null, MESSAGE_TELEPHONE_INVALIDE)
    .transform((v) => versE164(v)!),
  email: z.string().email().optional().or(z.literal("")),
  notes: z.string().optional(),
});

/**
 * Liste complète, sans pagination : un carnet de prestataires reste de
 * petite taille en pratique (contrairement aux locataires/factures), et sert
 * à la fois à la page de gestion et au sélecteur d'assignation sur un
 * incident (IssuesPage.tsx), où une pagination serait plus gênante qu'utile.
 */
export const listVendors = asyncHandler(async (req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(vendors)
    .where(eq(vendors.managerId, req.user!.userId))
    .orderBy(vendors.name);
  res.json(rows);
});

export const createVendor = asyncHandler(async (req: Request, res: Response) => {
  const body = vendorSchema.parse(req.body);

  const [vendor] = await db
    .insert(vendors)
    .values({ ...body, email: body.email || undefined, managerId: req.user!.userId })
    .returning();

  await logActivity({
    req,
    managerId: vendor.managerId,
    action: "vendor.create",
    entityType: "vendor",
    entityId: vendor.id,
    entityLabel: vendor.name,
    details: `Prestataire ajouté : ${vendor.name}${vendor.trade ? ` (${vendor.trade})` : ""}`,
  });

  res.status(201).json(vendor);
});

export const updateVendor = asyncHandler(async (req: Request, res: Response) => {
  const body = vendorSchema.partial().parse(req.body);

  const [existing] = await db.select().from(vendors).where(eq(vendors.id, req.params.id));
  assertOwnership(existing, (v) => v.managerId, req.user!.userId, "Prestataire introuvable");

  const [vendor] = await db
    .update(vendors)
    .set({ ...body, email: body.email === "" ? null : body.email })
    .where(eq(vendors.id, req.params.id))
    .returning();

  await logActivity({
    req,
    managerId: vendor.managerId,
    action: "vendor.update",
    entityType: "vendor",
    entityId: vendor.id,
    entityLabel: vendor.name,
    details: `Prestataire modifié : ${vendor.name}`,
  });

  res.json(vendor);
});

export const deleteVendor = asyncHandler(async (req: Request, res: Response) => {
  const [existing] = await db.select().from(vendors).where(eq(vendors.id, req.params.id));
  assertOwnership(existing, (v) => v.managerId, req.user!.userId, "Prestataire introuvable");

  // Pas de blocage si un incident lui est assigné, contrairement à
  // deleteOwner/un bien associé : issueReports.vendorId est ON DELETE SET
  // NULL (schema.ts), l'historique de l'incident reste donc intact, juste
  // sans prestataire assigné — supprimer un contact du carnet d'adresses ne
  // doit pas être bloqué par ce qu'on lui a confié par le passé.
  await db.delete(vendors).where(eq(vendors.id, req.params.id));

  await logActivity({
    req,
    managerId: existing.managerId,
    action: "vendor.delete",
    entityType: "vendor",
    entityId: existing.id,
    entityLabel: existing.name,
    details: `Prestataire supprimé : ${existing.name}`,
  });

  res.status(204).send();
});

/**
 * Vérifie qu'un vendorId (envoyé par updateIssueStatus) appartient bien au
 * gestionnaire connecté avant de l'assigner à l'un de ses incidents — sans
 * ce contrôle, un gestionnaire pourrait assigner le prestataire d'une AUTRE
 * agence à son propre incident (l'ID seul ne suffit pas à le vérifier).
 */
export async function assertVendorOwnership(vendorId: string, managerId: string): Promise<void> {
  const [vendor] = await db.select().from(vendors).where(and(eq(vendors.id, vendorId), eq(vendors.managerId, managerId)));
  if (!vendor) throw new ApiError(404, "Prestataire introuvable");
}
