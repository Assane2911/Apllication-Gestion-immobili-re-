import bcrypt from "bcryptjs";
import { and, desc, eq, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db, Transaction } from "../db/client";
import { buildPaginatedResult, parsePagination } from "../utils/pagination";
import { contracts, issueReports, properties, tenants, users } from "../db/schema";
import { logActivity } from "../services/activity.service";
import { getSignedUrl, uploadPrivateFile } from "../services/storage.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";

const tenantSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().min(6),
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
});

export const listTenants = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);
  const whereClause = eq(tenants.managerId, req.user!.userId);

  const [rows, [{ count }]] = await Promise.all([
    db
      .select()
      .from(tenants)
      .where(whereClause)
      .orderBy(desc(tenants.createdAt))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(tenants).where(whereClause),
  ]);

  res.json(buildPaginatedResult(rows, count, pagination));
});

export const getTenant = asyncHandler(async (req: Request, res: Response) => {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, req.params.id));
  if (!tenant || tenant.managerId !== req.user!.userId) throw new ApiError(404, "Locataire introuvable");

  const tenantContracts = await db
    .select({ contract: contracts, property: properties })
    .from(contracts)
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(eq(contracts.tenantId, tenant.id));

  const issues = await db.select().from(issueReports).where(eq(issueReports.tenantId, tenant.id));

  res.json({
    ...tenant,
    contracts: tenantContracts.map((r: { contract: typeof contracts.$inferSelect; property: typeof properties.$inferSelect }) => ({ ...r.contract, property: r.property })),
    issues,
  });
});

export const createTenant = asyncHandler(async (req: Request, res: Response) => {
  const body = tenantSchema.parse(req.body);
  const idDocument = req.file ? await uploadPrivateFile(req.file, "tenants") : undefined;

  const [existing] = await db
    .select()
    .from(tenants)
    .where(and(eq(tenants.managerId, req.user!.userId), eq(tenants.email, body.email)));
  if (existing) throw new ApiError(409, "Un locataire avec cet email existe déjà");

  const [tenant] = await db
    .insert(tenants)
    .values({ ...body, idDocument, managerId: req.user!.userId })
    .returning();

  await logActivity({
    req,
    managerId: tenant.managerId,
    action: "tenant.create",
    entityType: "tenant",
    entityId: tenant.id,
    entityLabel: `${tenant.firstName} ${tenant.lastName}`,
    details: `Locataire ajouté : ${tenant.firstName} ${tenant.lastName} (${tenant.email})`,
  });

  res.status(201).json(tenant);
});

export const updateTenant = asyncHandler(async (req: Request, res: Response) => {
  const body = tenantSchema.partial().parse(req.body);
  const idDocument = req.file ? await uploadPrivateFile(req.file, "tenants") : undefined;

  const [existing] = await db.select().from(tenants).where(eq(tenants.id, req.params.id));
  if (!existing || existing.managerId !== req.user!.userId) throw new ApiError(404, "Locataire introuvable");

  const [tenant] = await db
    .update(tenants)
    .set({ ...body, ...(idDocument ? { idDocument } : {}) })
    .where(eq(tenants.id, req.params.id))
    .returning();

  await logActivity({
    req,
    managerId: tenant.managerId,
    action: "tenant.update",
    entityType: "tenant",
    entityId: tenant.id,
    entityLabel: `${tenant.firstName} ${tenant.lastName}`,
    details: `Locataire modifié : ${tenant.firstName} ${tenant.lastName}`,
  });

  res.json(tenant);
});

export const deleteTenant = asyncHandler(async (req: Request, res: Response) => {
  const [existing] = await db.select().from(tenants).where(eq(tenants.id, req.params.id));
  if (!existing || existing.managerId !== req.user!.userId) throw new ApiError(404, "Locataire introuvable");

  const [tenantContracts, tenantIssues] = await Promise.all([
    db.select().from(contracts).where(eq(contracts.tenantId, req.params.id)),
    db.select().from(issueReports).where(eq(issueReports.tenantId, req.params.id)),
  ]);

  if (tenantContracts.some((c: typeof contracts.$inferSelect) => c.status === "ACTIVE")) {
    throw new ApiError(409, "Impossible de supprimer un locataire ayant un contrat actif");
  }
  if (tenantContracts.length > 0) {
    throw new ApiError(
      409,
      "Impossible de supprimer un locataire associé à un historique de contrats. Veuillez d'abord supprimer les contrats associés."
    );
  }
  if (tenantIssues.length > 0) {
    throw new ApiError(
      409,
      "Impossible de supprimer un locataire ayant des signalements d'incidents enregistrés."
    );
  }

  await db.delete(tenants).where(eq(tenants.id, req.params.id));

  await logActivity({
    req,
    managerId: existing.managerId,
    action: "tenant.delete",
    entityType: "tenant",
    entityId: existing.id,
    entityLabel: `${existing.firstName} ${existing.lastName}`,
    details: `Locataire supprimé : ${existing.firstName} ${existing.lastName}`,
  });

  res.status(204).send();
});

/** Génère une URL signée temporaire pour consulter la pièce d'identité d'un locataire (bucket privé). */
export const getTenantIdDocumentUrl = asyncHandler(async (req: Request, res: Response) => {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, req.params.id));
  if (!tenant || tenant.managerId !== req.user!.userId) throw new ApiError(404, "Locataire introuvable");
  if (!tenant.idDocument) throw new ApiError(404, "Aucune pièce d'identité enregistrée pour ce locataire");

  const url = await getSignedUrl(tenant.idDocument);
  res.json({ url });
});

const createPortalAccountSchema = z.object({
  password: z.string().min(8),
});

/** Le gestionnaire crée l'accès au portail (email/mot de passe) d'un locataire. */
export const createTenantPortalAccount = asyncHandler(async (req: Request, res: Response) => {
  const body = createPortalAccountSchema.parse(req.body);
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, req.params.id));
  if (!tenant || tenant.managerId !== req.user!.userId) throw new ApiError(404, "Locataire introuvable");

  const [existingUser] = await db.select().from(users).where(eq(users.email, tenant.email));
  if (existingUser) throw new ApiError(409, "Un compte existe déjà pour cet email");

  const passwordHash = await bcrypt.hash(body.password, 10);

  // Les deux écritures doivent réussir ensemble : sans transaction, un échec
  // de la seconde laissait un compte de connexion valide mais jamais relié
  // à aucun locataire (userId manquant sur tenants).
  const user = await db.transaction(async (tx: Transaction) => {
    const [created] = await tx
      .insert(users)
      .values({ email: tenant.email, passwordHash, role: "TENANT" })
      .returning();
    await tx.update(tenants).set({ userId: created.id }).where(eq(tenants.id, tenant.id));
    return created;
  });

  res.status(201).json({ message: "Accès portail créé", userId: user.id, email: user.email });
});
