import { and, asc, desc, eq } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { contracts, leaseNotices, properties, tenants } from "../db/schema";
import { assertFileContentMatchesDeclaredType } from "../middleware/upload";
import { logActivity } from "../services/activity.service";
import {
  AUTEURS_DE_CONGE,
  calculerDateDeSortie,
  etapesDeSortie,
  facturesApresLaSortie,
  MODES_DE_NOTIFICATION,
  UNITES_DE_PREAVIS,
} from "../services/conge.service";
import { deleteStorageObjectBestEffort, getSignedUrl, uploadPrivateFile } from "../services/storage.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { assertOwnership } from "../utils/authorization";
import { ANNEE_BAIL_MAX, ANNEE_BAIL_MIN, dateDeBailPlausible } from "../utils/dates";
import { nomComplet } from "../utils/nom";
import { avecCode } from "../utils/validationExplicite";

const dateSchema = z.coerce
  .date()
  .refine(
    dateDeBailPlausible,
    avecCode(`La date doit être comprise entre ${ANNEE_BAIL_MIN} et ${ANNEE_BAIL_MAX}`, "LEASE_DATE_OUT_OF_RANGE", { min: ANNEE_BAIL_MIN, max: ANNEE_BAIL_MAX })
  );

const texteFacultatif = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === "" ? null : s))
    .nullable()
    .optional();

const creationSchema = z.object({
  givenBy: z.enum(AUTEURS_DE_CONGE),
  deliveryMode: z.enum(MODES_DE_NOTIFICATION),
  // Date de signification (acte d'huissier) ou de réception : le point de départ du préavis.
  servedAt: dateSchema,
  periodValue: z.coerce.number().int("La durée du préavis est un nombre entier.").min(1).max(120),
  periodUnit: z.enum(UNITES_DE_PREAVIS),
  // Absente : calculée à partir de la date de signification et de la durée du préavis.
  exitDate: dateSchema.optional(),
  bailiffName: texteFacultatif(200),
  actReference: texteFacultatif(120),
  reason: texteFacultatif(1000),
});

const modificationSchema = creationSchema.partial();

async function bailDuGestionnaire(req: Request) {
  const [contrat] = await db.select().from(contracts).where(eq(contracts.id, req.params.id));
  if (!contrat) throw new ApiError(404, "Contrat introuvable", "CONTRACT_NOT_FOUND");
  const [bien] = await db.select().from(properties).where(eq(properties.id, contrat.propertyId));
  assertOwnership(bien, (p) => p.managerId, req.user!.userId, "Contrat introuvable", 404, "CONTRACT_NOT_FOUND");
  return { contrat, bien };
}

async function congeDuBail(contractId: string, noticeId: string) {
  const [conge] = await db
    .select()
    .from(leaseNotices)
    .where(and(eq(leaseNotices.id, noticeId), eq(leaseNotices.contractId, contractId)));
  if (!conge) throw new ApiError(404, "Congé introuvable", "LEASE_NOTICE_NOT_FOUND");
  return conge;
}

async function urlDuDocument(valeur: string | null): Promise<string | null> {
  if (!valeur) return null;
  if (/^https?:\/\//i.test(valeur)) return valeur;
  try {
    return await getSignedUrl(valeur);
  } catch {
    return valeur;
  }
}

async function presenter(conge: typeof leaseNotices.$inferSelect) {
  return { ...conge, documentUrl: await urlDuDocument(conge.documentUrl) };
}

/** Les congés d'un bail, le plus récent d'abord, avec l'avancement de la sortie pour celui qui est en cours. */
export const listLeaseNotices = asyncHandler(async (req: Request, res: Response) => {
  const { contrat } = await bailDuGestionnaire(req);
  const conges = await db.select().from(leaseNotices).where(eq(leaseNotices.contractId, contrat.id)).orderBy(desc(leaseNotices.createdAt));
  const enCours = conges.find((c: { status: string }) => c.status === "ACTIVE");
  res.json({
    conges: await Promise.all(conges.map(presenter)),
    etapes: enCours ? await etapesDeSortie(contrat) : null,
    facturesApresSortie: enCours ? await facturesApresLaSortie(contrat.id, enCours.exitDate) : 0,
  });
});

export const createLeaseNotice = asyncHandler(async (req: Request, res: Response) => {
  const { contrat, bien } = await bailDuGestionnaire(req);
  const body = creationSchema.parse(req.body ?? {});

  if (contrat.status !== "ACTIVE") {
    throw new ApiError(409, "Un congé ne s'enregistre que sur un bail en cours.", "LEASE_NOTICE_CONTRACT_NOT_ACTIVE");
  }
  const exitDate = body.exitDate ?? calculerDateDeSortie(body.servedAt, body.periodValue, body.periodUnit);
  if (exitDate < body.servedAt) {
    throw new ApiError(400, "La date de sortie ne peut pas précéder la date de signification.", "LEASE_NOTICE_EXIT_BEFORE_SERVED");
  }

  let cree;
  try {
    [cree] = await db
      .insert(leaseNotices)
      .values({
        contractId: contrat.id,
        managerId: bien.managerId,
        givenBy: body.givenBy,
        deliveryMode: body.deliveryMode,
        servedAt: body.servedAt,
        periodValue: body.periodValue,
        periodUnit: body.periodUnit,
        exitDate,
        bailiffName: body.bailiffName ?? null,
        actReference: body.actReference ?? null,
        reason: body.reason ?? null,
        createdBy: req.user!.collaboratorId ?? req.user!.userId,
      })
      .returning();
  } catch (err) {
    // Index unique partiel : un seul congé en cours par bail (course entre deux requêtes comprise).
    if ((err as { code?: string; cause?: { code?: string } })?.code === "23505" || (err as { cause?: { code?: string } })?.cause?.code === "23505") {
      throw new ApiError(409, "Un congé est déjà en cours sur ce bail : retirez-le ou modifiez-le.", "LEASE_NOTICE_ALREADY_ACTIVE");
    }
    throw err;
  }

  const [locataire] = await db.select().from(tenants).where(eq(tenants.id, contrat.tenantId));
  await logActivity({
    req,
    managerId: bien.managerId,
    action: "contract.lease_notice",
    entityType: "contract",
    entityId: contrat.id,
    entityLabel: `${bien.title}${locataire ? ` — ${nomComplet(locataire)}` : ""}`,
    details: `Congé enregistré (${body.givenBy === "TENANT" ? "donné par le locataire" : "donné par le bailleur"}, ${body.deliveryMode}), sortie prévue le ${exitDate.toISOString().slice(0, 10)}.`,
  });

  res.status(201).json({ ...(await presenter(cree)), facturesApresSortie: await facturesApresLaSortie(contrat.id, exitDate) });
});

export const updateLeaseNotice = asyncHandler(async (req: Request, res: Response) => {
  const { contrat, bien } = await bailDuGestionnaire(req);
  const conge = await congeDuBail(contrat.id, req.params.noticeId);
  const body = modificationSchema.parse(req.body ?? {});
  if (conge.status !== "ACTIVE") {
    throw new ApiError(409, "Ce congé a été retiré : il ne peut plus être modifié.", "LEASE_NOTICE_NOT_ACTIVE");
  }

  const servedAt = body.servedAt ?? conge.servedAt;
  const periodValue = body.periodValue ?? conge.periodValue;
  const periodUnit = body.periodUnit ?? conge.periodUnit;
  // La date de sortie suit la signification et le préavis tant que le gestionnaire ne la fixe pas lui-même dans cette requête.
  const recalcul = body.servedAt !== undefined || body.periodValue !== undefined || body.periodUnit !== undefined;
  const exitDate = body.exitDate ?? (recalcul ? calculerDateDeSortie(servedAt, periodValue, periodUnit as "DAYS" | "MONTHS") : conge.exitDate);
  if (exitDate < servedAt) {
    throw new ApiError(400, "La date de sortie ne peut pas précéder la date de signification.", "LEASE_NOTICE_EXIT_BEFORE_SERVED");
  }

  const [modifie] = await db
    .update(leaseNotices)
    .set({
      givenBy: body.givenBy ?? conge.givenBy,
      deliveryMode: body.deliveryMode ?? conge.deliveryMode,
      servedAt,
      periodValue,
      periodUnit,
      exitDate,
      bailiffName: body.bailiffName !== undefined ? body.bailiffName : conge.bailiffName,
      actReference: body.actReference !== undefined ? body.actReference : conge.actReference,
      reason: body.reason !== undefined ? body.reason : conge.reason,
    })
    .where(eq(leaseNotices.id, conge.id))
    .returning();

  await logActivity({
    req,
    managerId: bien.managerId,
    action: "contract.lease_notice_update",
    entityType: "contract",
    entityId: contrat.id,
    entityLabel: bien.title,
    details: `Congé modifié, sortie prévue le ${exitDate.toISOString().slice(0, 10)}.`,
  });

  res.json({ ...(await presenter(modifie)), facturesApresSortie: await facturesApresLaSortie(contrat.id, exitDate) });
});

/** Retire le congé (le locataire reste) : il est conservé dans l'historique du bail, sans effet sur la facturation. */
export const withdrawLeaseNotice = asyncHandler(async (req: Request, res: Response) => {
  const { contrat, bien } = await bailDuGestionnaire(req);
  const conge = await congeDuBail(contrat.id, req.params.noticeId);
  if (conge.status !== "ACTIVE") {
    throw new ApiError(409, "Ce congé est déjà retiré.", "LEASE_NOTICE_NOT_ACTIVE");
  }
  const [retire] = await db
    .update(leaseNotices)
    .set({ status: "WITHDRAWN", withdrawnAt: new Date() })
    .where(and(eq(leaseNotices.id, conge.id), eq(leaseNotices.status, "ACTIVE")))
    .returning();
  if (!retire) throw new ApiError(409, "Ce congé est déjà retiré.", "LEASE_NOTICE_NOT_ACTIVE");

  await logActivity({
    req,
    managerId: bien.managerId,
    action: "contract.lease_notice_withdraw",
    entityType: "contract",
    entityId: contrat.id,
    entityLabel: bien.title,
    details: "Congé retiré : le bail se poursuit.",
  });

  res.json(await presenter(retire));
});

/** Joint (ou remplace) le scan du document remis au locataire : l'acte de l'huissier, la lettre ou son accusé de réception. */
export const uploadLeaseNoticeDocument = asyncHandler(async (req: Request, res: Response) => {
  const { contrat, bien } = await bailDuGestionnaire(req);
  const conge = await congeDuBail(contrat.id, req.params.noticeId);
  if (!req.file) throw new ApiError(400, "Aucun fichier fourni pour le document du congé.", "LEASE_NOTICE_DOCUMENT_REQUIRED");

  assertFileContentMatchesDeclaredType(req.file);
  const chemin = await uploadPrivateFile(req.file, "contracts");
  const [modifie] = await db.update(leaseNotices).set({ documentUrl: chemin }).where(eq(leaseNotices.id, conge.id)).returning();

  if (conge.documentUrl) await deleteStorageObjectBestEffort(conge.documentUrl).catch(() => undefined);

  await logActivity({
    req,
    managerId: bien.managerId,
    action: "contract.lease_notice_document",
    entityType: "contract",
    entityId: contrat.id,
    entityLabel: bien.title,
    details: "Document du congé joint (scan).",
  });

  res.json(await presenter(modifie));
});

/** Sorties à venir de l'agence : un congé en cours par bail, la plus proche d'abord, pour le tableau de bord. */
export const listUpcomingExits = asyncHandler(async (req: Request, res: Response) => {
  // Colonnes ciblées : un bail entier porte ses clauses et ses deux signatures en base64 ; la liste n'en montre rien.
  const lignes = await db
    .select({
      conge: { id: leaseNotices.id, givenBy: leaseNotices.givenBy, exitDate: leaseNotices.exitDate },
      contrat: { id: contracts.id, depositRefundedAt: contracts.depositRefundedAt },
      bien: { title: properties.title },
      locataire: { firstName: tenants.firstName, lastName: tenants.lastName },
    })
    .from(leaseNotices)
    .innerJoin(contracts, eq(leaseNotices.contractId, contracts.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .where(and(eq(properties.managerId, req.user!.userId), eq(leaseNotices.status, "ACTIVE"), eq(contracts.status, "ACTIVE")))
    .orderBy(asc(leaseNotices.exitDate));

  const sorties = await Promise.all(
    lignes.map(
      async (l: {
        conge: Pick<typeof leaseNotices.$inferSelect, "id" | "givenBy" | "exitDate">;
        contrat: Pick<typeof contracts.$inferSelect, "id" | "depositRefundedAt">;
        bien: Pick<typeof properties.$inferSelect, "title">;
        locataire: Pick<typeof tenants.$inferSelect, "firstName" | "lastName">;
      }) => ({
        noticeId: l.conge.id,
        contractId: l.contrat.id,
        propertyTitle: l.bien.title,
        tenantName: nomComplet(l.locataire),
        givenBy: l.conge.givenBy,
        exitDate: l.conge.exitDate,
        etapes: await etapesDeSortie(l.contrat),
      })
    )
  );
  res.json(sorties);
});
