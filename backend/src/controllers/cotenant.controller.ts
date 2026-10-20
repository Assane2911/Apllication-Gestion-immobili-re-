import { and, asc, eq, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { contractCotenants, contracts, properties, tenants } from "../db/schema";
import { logActivity } from "../services/activity.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { assertOwnership } from "../utils/authorization";

/**
 * Colocataires d'un bail : des locataires de l'agence qui partagent le bail avec
 * son titulaire. Ils figurent sur le bail imprimé ; une fois ce bail signé par le
 * titulaire, la liste ne change plus (même verrou que le loyer, les clauses et
 * les garants). Une éventuelle clause de solidarité relève des clauses
 * particulières du bail : la plateforme n'en présume aucune.
 */
export const MAX_COLOCATAIRES_PAR_BAIL = 5;

const ajoutSchema = z.object({ tenantId: z.string().min(1, "Choisissez un locataire.") });

async function contratDuGestionnaire(req: Request) {
  const [contrat] = await db.select().from(contracts).where(eq(contracts.id, req.params.id));
  if (!contrat) throw new ApiError(404, "Contrat introuvable", "CONTRACT_NOT_FOUND");
  const [bien] = await db.select().from(properties).where(eq(properties.id, contrat.propertyId));
  assertOwnership(bien, (p) => p.managerId, req.user!.userId, "Contrat introuvable", 404, "CONTRACT_NOT_FOUND");
  return { contrat, bien };
}

function assertBailNonSigne(contrat: typeof contracts.$inferSelect) {
  if (contrat.signedByTenantAt) {
    throw new ApiError(
      409,
      "Ce bail a été signé par le locataire : ses colocataires font partie du contenu signé et ne peuvent plus changer. Établissez un nouveau bail."
    );
  }
}

/** Colocataires d'un bail, avec leur fiche (pour l'écran et le bail imprimé). */
export async function colocatairesDuBail(contractId: string) {
  return db
    .select({ id: contractCotenants.id, tenant: tenants })
    .from(contractCotenants)
    .innerJoin(tenants, eq(contractCotenants.tenantId, tenants.id))
    .where(eq(contractCotenants.contractId, contractId))
    .orderBy(asc(contractCotenants.createdAt));
}

export const listCotenants = asyncHandler(async (req: Request, res: Response) => {
  const { contrat } = await contratDuGestionnaire(req);
  res.json(await colocatairesDuBail(contrat.id));
});

export const addCotenant = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = ajoutSchema.parse(req.body);
  const { contrat, bien } = await contratDuGestionnaire(req);
  assertBailNonSigne(contrat);

  const [locataire] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  assertOwnership(locataire, (t) => t.managerId, req.user!.userId, "Locataire introuvable", 404, "TENANT_NOT_FOUND");
  if (locataire.anonymizedAt) throw new ApiError(409, "Ce locataire a été anonymisé : il ne peut pas rejoindre un bail.", "TENANT_ANONYMIZED_NO_COTENANT");
  if (locataire.id === contrat.tenantId) throw new ApiError(409, "Ce locataire est déjà le titulaire du bail.", "TENANT_IS_HOLDER");

  const [{ nombre }] = await db
    .select({ nombre: sql<number>`count(*)::int` })
    .from(contractCotenants)
    .where(eq(contractCotenants.contractId, contrat.id));
  if (nombre >= MAX_COLOCATAIRES_PAR_BAIL) throw new ApiError(409, `Un bail compte au plus ${MAX_COLOCATAIRES_PAR_BAIL} colocataires en plus du titulaire.`);

  // L'index unique (bail, locataire) tranche une double saisie simultanée.
  const [lien] = await db.insert(contractCotenants).values({ contractId: contrat.id, tenantId: locataire.id }).onConflictDoNothing().returning();
  if (!lien) throw new ApiError(409, "Ce locataire est déjà colocataire de ce bail.", "TENANT_ALREADY_COTENANT");

  await logActivity({
    req,
    managerId: bien.managerId,
    action: "contract.cotenant_add",
    entityType: "contract",
    entityId: contrat.id,
    entityLabel: bien.title,
    details: `Colocataire ajouté au bail : ${locataire.firstName} ${locataire.lastName}.`,
  });
  res.status(201).json({ id: lien.id, tenant: locataire });
});

export const removeCotenant = asyncHandler(async (req: Request, res: Response) => {
  const { contrat, bien } = await contratDuGestionnaire(req);
  assertBailNonSigne(contrat);

  const [lien] = await db
    .delete(contractCotenants)
    .where(and(eq(contractCotenants.id, req.params.cotenantId), eq(contractCotenants.contractId, contrat.id)))
    .returning();
  if (!lien) throw new ApiError(404, "Colocataire introuvable", "COTENANT_NOT_FOUND");
  const [locataire] = await db.select().from(tenants).where(eq(tenants.id, lien.tenantId));

  await logActivity({
    req,
    managerId: bien.managerId,
    action: "contract.cotenant_remove",
    entityType: "contract",
    entityId: contrat.id,
    entityLabel: bien.title,
    details: `Colocataire retiré du bail : ${locataire ? `${locataire.firstName} ${locataire.lastName}` : lien.tenantId}.`,
  });
  res.status(204).send();
});
