import { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { contracts, properties, tenants } from "../db/schema";
import { logActivity } from "../services/activity.service";
import { annulerRevision, bauxAReviser, creerRevision, listerRevisions, motifRevision } from "../services/rentRevision.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { assertOwnership } from "../utils/authorization";
import { dateSaisieSchema } from "../utils/dates";
import { formaterMontant, MONTANT_MAXIMUM } from "../utils/montant";

const revisionSchema = z
  .object({
    mode: z.enum(["AMOUNT", "PERCENT", "INDEX"]),
    newRent: z.coerce.number().finite().positive().max(MONTANT_MAXIMUM).optional(),
    percent: z.coerce.number().finite().optional(),
    indexOld: z.coerce.number().finite().max(MONTANT_MAXIMUM).optional(),
    indexNew: z.coerce.number().finite().max(MONTANT_MAXIMUM).optional(),
    indexName: z.string().trim().max(60).nullable().optional(),
    // Premier jour du mois d'effet, au format AAAA-MM-JJ.
    effectiveDate: dateSaisieSchema,
    note: z.string().trim().max(1000, "La note ne peut pas dépasser 1 000 caractères").nullable().optional(),
    notifyTenant: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "AMOUNT" && v.newRent === undefined) ctx.addIssue({ code: "custom", path: ["newRent"], message: "Indiquez le nouveau loyer." });
    if (v.mode === "PERCENT" && v.percent === undefined) ctx.addIssue({ code: "custom", path: ["percent"], message: "Indiquez le pourcentage." });
    if (v.mode === "INDEX" && (v.indexOld === undefined || v.indexNew === undefined)) {
      ctx.addIssue({ code: "custom", path: ["indexOld"], message: "Indiquez l'ancienne et la nouvelle valeur de l'indice." });
    }
  });

async function contratDuGestionnaire(req: Request) {
  const [contrat] = await db.select().from(contracts).where(eq(contracts.id, req.params.id));
  if (!contrat) throw new ApiError(404, "Contrat introuvable");
  const [bien] = await db.select().from(properties).where(eq(properties.id, contrat.propertyId));
  assertOwnership(bien, (p) => p.managerId, req.user!.userId, "Contrat introuvable");
  return { contrat, bien };
}

export const listRentRevisions = asyncHandler(async (req: Request, res: Response) => {
  const { contrat } = await contratDuGestionnaire(req);
  res.json(await listerRevisions(contrat.id));
});

export const createRentRevision = asyncHandler(async (req: Request, res: Response) => {
  const body = revisionSchema.parse(req.body);
  const { contrat, bien } = await contratDuGestionnaire(req);

  const entree =
    body.mode === "AMOUNT"
      ? ({ mode: "AMOUNT", newRent: body.newRent! } as const)
      : body.mode === "PERCENT"
        ? ({ mode: "PERCENT", percent: body.percent! } as const)
        : ({ mode: "INDEX", indexOld: body.indexOld!, indexNew: body.indexNew!, indexName: body.indexName } as const);

  const resultat = await creerRevision({
    contractId: contrat.id,
    managerId: bien.managerId,
    entree,
    effectiveDate: body.effectiveDate,
    note: body.note,
    // Le collaborateur qui agit, pas le propriétaire dont le jeton porte l'id (voir identiteJetonPourManager).
    createdBy: req.user!.collaboratorId ?? req.user!.userId,
    prevenirLocataire: body.notifyTenant ?? false,
  });

  const [locataire] = await db.select().from(tenants).where(eq(tenants.id, contrat.tenantId));
  const r = resultat.revision;
  await logActivity({
    req,
    managerId: bien.managerId,
    action: "contract.rent_revision",
    entityType: "contract",
    entityId: contrat.id,
    entityLabel: `${bien.title}${locataire ? ` — ${locataire.firstName} ${locataire.lastName}` : ""}`,
    details:
      `Loyer ${resultat.appliquee ? "révisé" : "révision programmée"} : ${formaterMontant(r.previousRent, contrat.currency)} → ${formaterMontant(r.newRent, contrat.currency)}` +
      ` à compter du ${r.effectiveDate.toISOString().slice(0, 10)}${motifRevision(r) ? ` (${motifRevision(r)})` : ""}.`,
  });

  res.status(201).json({
    ...resultat.revision,
    appliquee: resultat.appliquee,
    facturesRecalculees: resultat.facturesRecalculees,
    emailEnvoye: resultat.emailEnvoye,
  });
});

export const cancelRentRevision = asyncHandler(async (req: Request, res: Response) => {
  const { contrat, bien } = await contratDuGestionnaire(req);
  await annulerRevision(contrat.id, req.params.revisionId);
  await logActivity({
    req,
    managerId: bien.managerId,
    action: "contract.rent_revision_cancel",
    entityType: "contract",
    entityId: contrat.id,
    entityLabel: bien.title,
    details: "Révision de loyer programmée annulée.",
  });
  res.status(204).send();
});

/** Baux actifs dont la date anniversaire approche (ou vient de passer) sans révision prévue. */
export const listRevisionsDue = asyncHandler(async (req: Request, res: Response) => {
  res.json(await bauxAReviser(req.user!.userId));
});
