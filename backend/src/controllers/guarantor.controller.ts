import { and, asc, eq, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { contractGuarantors, contracts, properties } from "../db/schema";
import { logActivity } from "../services/activity.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { assertOwnership } from "../utils/authorization";
import { CIVILITES } from "../utils/nom";
import { MESSAGE_TELEPHONE_INVALIDE, versE164 } from "../utils/phone";
import { avecCode } from "../utils/validationExplicite";

/**
 * Garants d'un bail. Ils figurent sur le bail remis au locataire : une fois ce
 * bail signé par le locataire, on ne les ajoute, ne les modifie ni ne les retire
 * plus (même raison que pour le loyer ou les clauses : une signature porte sur
 * un contenu figé).
 */
export const MAX_GARANTS_PAR_BAIL = 5;

const garantSchema = z.object({
  civility: z.enum(CIVILITES).optional().nullable(),
  firstName: z.string().trim().min(1, "Prénom du garant requis").max(100),
  lastName: z.string().trim().min(1, "Nom du garant requis").max(100),
  phone: z
    .string()
    .refine((v) => versE164(v) !== null, avecCode(MESSAGE_TELEPHONE_INVALIDE, "PHONE_INVALID"))
    .transform((v) => versE164(v)!),
  email: z
    .union([z.literal(""), z.null(), z.string().trim().email("Adresse email du garant invalide")])
    .optional()
    .transform((v) => (v ? v.toLowerCase() : null)),
  address: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  // .finite() : « 1e999 » est converti en Infinity par la coercition et passait `positive()` ; le montant s'imprime sur
  // le bail. Le plafond écarte une faute de frappe manifeste sans gêner les francs CFA.
  maxAmount: z
    .union([z.null(), z.coerce.number().finite("Le montant garanti est invalide").positive("Le montant garanti doit être positif").max(1_000_000_000_000, "Le montant garanti est trop élevé")])
    .optional(),
  notes: z.string().trim().max(1000).nullable().optional().transform((v) => v || null),
});

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
      "Ce bail a été signé par le locataire : ses garants font partie du contenu signé et ne peuvent plus changer. Établissez un nouveau bail ou un avenant.",
      "LEASE_SIGNED_GUARANTORS_LOCKED"
    );
  }
}

const nomGarant = (g: { firstName: string; lastName: string }) => `${g.firstName} ${g.lastName}`;

export const listGuarantors = asyncHandler(async (req: Request, res: Response) => {
  const { contrat } = await contratDuGestionnaire(req);
  res.json(await db.select().from(contractGuarantors).where(eq(contractGuarantors.contractId, contrat.id)).orderBy(asc(contractGuarantors.createdAt)));
});

export const createGuarantor = asyncHandler(async (req: Request, res: Response) => {
  const { contrat, bien } = await contratDuGestionnaire(req);
  // Corps validé après l'appartenance : un corps mal formé visant la ressource d'une autre agence répond 404, comme un identifiant inventé.
  const body = garantSchema.parse(req.body);
  assertBailNonSigne(contrat);

  const [{ nombre }] = await db
    .select({ nombre: sql<number>`count(*)::int` })
    .from(contractGuarantors)
    .where(eq(contractGuarantors.contractId, contrat.id));
  if (nombre >= MAX_GARANTS_PAR_BAIL) throw new ApiError(409, `Un bail compte au plus ${MAX_GARANTS_PAR_BAIL} garants.`, "GUARANTOR_LIMIT", { max: MAX_GARANTS_PAR_BAIL });

  const [garant] = await db
    .insert(contractGuarantors)
    .values({ contractId: contrat.id, ...body, civility: body.civility ?? null, maxAmount: body.maxAmount ?? null })
    .returning();

  await logActivity({
    req,
    managerId: bien.managerId,
    action: "contract.guarantor_add",
    entityType: "contract",
    entityId: contrat.id,
    entityLabel: bien.title,
    details: `Garant ajouté au bail : ${nomGarant(garant)}.`,
  });
  res.status(201).json(garant);
});

export const updateGuarantor = asyncHandler(async (req: Request, res: Response) => {
  const { contrat, bien } = await contratDuGestionnaire(req);
  // Corps validé après l'appartenance : un corps mal formé visant la ressource d'une autre agence répond 404, comme un identifiant inventé.
  // Un champ absent reste absent (partial() s'arrête avant la transformation « vide » → null) :
  // modifier le téléphone ne touche ni l'email, ni l'adresse, ni la note.
  const body = garantSchema.partial().parse(req.body);
  if (Object.keys(body).length === 0) throw new ApiError(400, "Aucune modification fournie.", "NOTHING_TO_UPDATE");
  assertBailNonSigne(contrat);

  const [garant] = await db
    .update(contractGuarantors)
    .set(body)
    .where(and(eq(contractGuarantors.id, req.params.guarantorId), eq(contractGuarantors.contractId, contrat.id)))
    .returning();
  if (!garant) throw new ApiError(404, "Garant introuvable", "GUARANTOR_NOT_FOUND");

  await logActivity({
    req,
    managerId: bien.managerId,
    action: "contract.guarantor_update",
    entityType: "contract",
    entityId: contrat.id,
    entityLabel: bien.title,
    details: `Garant modifié : ${nomGarant(garant)}.`,
  });
  res.json(garant);
});

export const deleteGuarantor = asyncHandler(async (req: Request, res: Response) => {
  const { contrat, bien } = await contratDuGestionnaire(req);
  assertBailNonSigne(contrat);

  const [garant] = await db
    .delete(contractGuarantors)
    .where(and(eq(contractGuarantors.id, req.params.guarantorId), eq(contractGuarantors.contractId, contrat.id)))
    .returning();
  if (!garant) throw new ApiError(404, "Garant introuvable", "GUARANTOR_NOT_FOUND");

  await logActivity({
    req,
    managerId: bien.managerId,
    action: "contract.guarantor_delete",
    entityType: "contract",
    entityId: contrat.id,
    entityLabel: bien.title,
    details: `Garant retiré du bail : ${nomGarant(garant)}.`,
  });
  res.status(204).send();
});
