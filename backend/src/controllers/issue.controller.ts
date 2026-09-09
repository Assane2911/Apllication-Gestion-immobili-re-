import { and, desc, eq, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { db } from "../db/client";
import { contracts, issueReports, issueStatusEnum, properties, tenants } from "../db/schema";
import { logActivity } from "../services/activity.service";
import { issueStatusUpdateEmail, sendEmail } from "../services/email.service";
import { getSignedUrl, uploadPrivateFile } from "../services/storage.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { buildPaginatedResult, parsePagination } from "../utils/pagination";

function isIssueStatus(value: unknown): value is (typeof issueStatusEnum.enumValues)[number] {
  return typeof value === "string" && (issueStatusEnum.enumValues as readonly string[]).includes(value);
}

/**
 * Remplace un chemin d'objet du bucket privé par une URL signée temporaire.
 * Compatibilité ascendante : les photos uploadées AVANT ce correctif sont
 * déjà des URLs publiques complètes (ancien bucket public-uploads) — on les
 * laisse telles quelles plutôt que de les casser, `getSignedUrl` n'ayant de
 * sens que pour un chemin d'objet du bucket privé.
 */
async function resolvePhotoUrl(value: string | null | undefined): Promise<string | null | undefined> {
  if (!value) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return getSignedUrl(value);
}

/** Signe `photoUrl` et chaque entrée de `additionalPhotos` (JSON stringifié) avant de renvoyer un incident au client. */
async function withSignedPhotos<T extends { photoUrl: string; additionalPhotos?: string | null }>(
  issue: T
): Promise<T> {
  const photoUrl = (await resolvePhotoUrl(issue.photoUrl)) as string;

  let additionalPhotos = issue.additionalPhotos ?? null;
  if (additionalPhotos) {
    try {
      const paths: string[] = JSON.parse(additionalPhotos);
      const signed = await Promise.all(paths.map((p) => resolvePhotoUrl(p)));
      additionalPhotos = JSON.stringify(signed);
    } catch {
      // Champ illisible : on le laisse tel quel plutôt que de faire échouer la réponse.
    }
  }

  return { ...issue, photoUrl, additionalPhotos };
}

/** Le gestionnaire voit tous les signalements (avec photo) de tous les locataires. */
export const listIssues = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);

  const conditions = [eq(properties.managerId, req.user!.userId)];
  if (isIssueStatus(req.query.status)) conditions.push(eq(issueReports.status, req.query.status));
  const whereClause = and(...conditions);

  type IssueRow = {
    issue: typeof issueReports.$inferSelect;
    tenant: typeof tenants.$inferSelect;
    contract: typeof contracts.$inferSelect;
    property: typeof properties.$inferSelect;
  };

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({ issue: issueReports, tenant: tenants, contract: contracts, property: properties })
      .from(issueReports)
      .innerJoin(tenants, eq(issueReports.tenantId, tenants.id))
      .innerJoin(contracts, eq(issueReports.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(whereClause)
      .orderBy(desc(issueReports.createdAt))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(issueReports)
      .innerJoin(contracts, eq(issueReports.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(whereClause),
  ]);

  const signedIssues = await Promise.all(
    rows.map(async (r: IssueRow) => ({
      ...(await withSignedPhotos(r.issue)),
      tenant: r.tenant,
      contract: { ...r.contract, property: r.property },
    }))
  );

  res.json(buildPaginatedResult(signedIssues, count, pagination));
});

const updateIssueSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "REJECTED"]),
  managerNote: z.string().optional(),
});

export const updateIssueStatus = asyncHandler(async (req: Request, res: Response) => {
  const body = updateIssueSchema.parse(req.body);
  const [owned] = await db
    .select({ issue: issueReports, property: properties })
    .from(issueReports)
    .innerJoin(contracts, eq(issueReports.contractId, contracts.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(eq(issueReports.id, req.params.id));
  if (!owned || owned.property.managerId !== req.user!.userId) {
    throw new ApiError(404, "Signalement introuvable");
  }

  const [updated] = await db
    .update(issueReports)
    .set({ status: body.status, managerNote: body.managerNote })
    .where(eq(issueReports.id, req.params.id))
    .returning();

  // Notifie le locataire par email de la mise à jour de son signalement —
  // ne doit jamais faire échouer la réponse si l'envoi échoue.
  const [row] = await db
    .select({ tenant: tenants, contract: contracts, property: properties })
    .from(contracts)
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(eq(contracts.id, updated.contractId));

  if (row?.tenant?.email) {
    const { subject, html } = issueStatusUpdateEmail({
      tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
      issueTitle: updated.title,
      propertyTitle: row.property.title,
      status: updated.status,
      managerNote: updated.managerNote,
      frontendUrl: env.frontendUrl,
    });
    await sendEmail(row.tenant.email, subject, html).catch((err) =>
      console.error("[issue] Échec de l'envoi de la notification de statut:", err)
    );
  }

  await logActivity({
    req,
    managerId: owned.property.managerId,
    action: "issue.update_status",
    entityType: "issue",
    entityId: updated.id,
    entityLabel: updated.title,
    details: `Statut de l'incident « ${updated.title} » changé en ${updated.status}`,
  });

  res.json(await withSignedPhotos(updated));
});

/** Signalements du locataire connecté (portail locataire). */
export const myIssues = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.tenantId) throw new ApiError(403, "Réservé aux locataires");
  const rows = await db
    .select({ issue: issueReports, contract: contracts, property: properties })
    .from(issueReports)
    .innerJoin(contracts, eq(issueReports.contractId, contracts.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(eq(issueReports.tenantId, req.user.tenantId))
    .orderBy(desc(issueReports.createdAt));

  const signed = await Promise.all(
    rows.map(async (r: { issue: typeof issueReports.$inferSelect; contract: typeof contracts.$inferSelect; property: typeof properties.$inferSelect }) => ({
      ...(await withSignedPhotos(r.issue)),
      contract: { ...r.contract, property: r.property },
    }))
  );
  res.json(signed);
});

const createIssueSchema = z.object({
  contractId: z.string().min(1),
  title: z.string().min(2),
  description: z.string().min(2),
});

/** Le locataire connecté signale un problème avec une photo prise/uploadée. */
export const createIssue = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.tenantId) throw new ApiError(403, "Réservé aux locataires");
  const body = createIssueSchema.parse(req.body);
  if (!req.file) throw new ApiError(400, "Une photo du problème est requise");

  const [contract] = await db.select().from(contracts).where(eq(contracts.id, body.contractId));
  if (!contract) throw new ApiError(404, "Contrat introuvable");
  if (contract.tenantId !== req.user.tenantId) throw new ApiError(403, "Accès refusé");

  const photoUrl = await uploadPrivateFile(req.file, "issues");

  const [issue] = await db
    .insert(issueReports)
    .values({
      contractId: body.contractId,
      tenantId: req.user.tenantId,
      title: body.title,
      description: body.description,
      photoUrl,
    })
    .returning();
  res.status(201).json(await withSignedPhotos(issue));
});

/** Le locataire ou le gestionnaire ajoute une nouvelle photo à un incident déjà signalé. */
export const addPhotoToIssue = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentification requise");
  if (!req.file) throw new ApiError(400, "Une photo est requise");

  const [row] = await db
    .select({ issue: issueReports, property: properties })
    .from(issueReports)
    .innerJoin(contracts, eq(issueReports.contractId, contracts.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(eq(issueReports.id, req.params.id));
  if (!row) throw new ApiError(404, "Signalement introuvable");
  const { issue } = row;

  if (req.user.role === "TENANT" && issue.tenantId !== req.user.tenantId) {
    throw new ApiError(403, "Accès refusé");
  }
  if (req.user.role === "MANAGER" && row.property.managerId !== req.user.userId) {
    throw new ApiError(403, "Accès refusé");
  }

  const newPhotoUrl = await uploadPrivateFile(req.file, "issues");

  let existingPhotos: string[] = [];
  try {
    if (issue.additionalPhotos) {
      existingPhotos = JSON.parse(issue.additionalPhotos);
    }
  } catch {}

  const updatedPhotos = [...existingPhotos, newPhotoUrl];

  const [updated] = await db
    .update(issueReports)
    .set({
      additionalPhotos: JSON.stringify(updatedPhotos),
      updatedAt: new Date(),
    })
    .where(eq(issueReports.id, req.params.id))
    .returning();

  res.json(await withSignedPhotos(updated));
});

