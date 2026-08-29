import { desc, eq } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { contracts, issueReports, properties, tenants } from "../db/schema";
import { uploadPublicFile } from "../services/storage.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";

/** Le gestionnaire voit tous les signalements (avec photo) de tous les locataires. */
export const listIssues = asyncHandler(async (req: Request, res: Response) => {
  let rows = await db
    .select({ issue: issueReports, tenant: tenants, contract: contracts, property: properties })
    .from(issueReports)
    .innerJoin(tenants, eq(issueReports.tenantId, tenants.id))
    .innerJoin(contracts, eq(issueReports.contractId, contracts.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .orderBy(desc(issueReports.createdAt));

  if (req.query.status) rows = rows.filter((r) => r.issue.status === String(req.query.status));

  res.json(
    rows.map((r) => ({
      ...r.issue,
      tenant: r.tenant,
      contract: { ...r.contract, property: r.property },
    }))
  );
});

const updateIssueSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "REJECTED"]),
  managerNote: z.string().optional(),
});

export const updateIssueStatus = asyncHandler(async (req: Request, res: Response) => {
  const body = updateIssueSchema.parse(req.body);
  const [issue] = await db.select().from(issueReports).where(eq(issueReports.id, req.params.id));
  if (!issue) throw new ApiError(404, "Signalement introuvable");

  const [updated] = await db
    .update(issueReports)
    .set({ status: body.status, managerNote: body.managerNote })
    .where(eq(issueReports.id, req.params.id))
    .returning();
  res.json(updated);
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

  res.json(rows.map((r) => ({ ...r.issue, contract: { ...r.contract, property: r.property } })));
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

  const photoUrl = await uploadPublicFile(req.file, "issues");

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
  res.status(201).json(issue);
});
