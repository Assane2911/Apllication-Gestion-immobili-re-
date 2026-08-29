import bcrypt from "bcryptjs";
import { desc, eq } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { contracts, issueReports, properties, tenants, users } from "../db/schema";
import { getSignedUrl, uploadPrivateFile } from "../services/storage.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";

const tenantSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().min(6),
  email: z.string().email(),
});

export const listTenants = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await db.select().from(tenants).orderBy(desc(tenants.createdAt));
  res.json(rows);
});

export const getTenant = asyncHandler(async (req: Request, res: Response) => {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, req.params.id));
  if (!tenant) throw new ApiError(404, "Locataire introuvable");

  const tenantContracts = await db
    .select({ contract: contracts, property: properties })
    .from(contracts)
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(eq(contracts.tenantId, tenant.id));

  const issues = await db.select().from(issueReports).where(eq(issueReports.tenantId, tenant.id));

  res.json({
    ...tenant,
    contracts: tenantContracts.map((r) => ({ ...r.contract, property: r.property })),
    issues,
  });
});

export const createTenant = asyncHandler(async (req: Request, res: Response) => {
  const body = tenantSchema.parse(req.body);
  const idDocument = req.file ? await uploadPrivateFile(req.file, "tenants") : undefined;

  const [existing] = await db.select().from(tenants).where(eq(tenants.email, body.email));
  if (existing) throw new ApiError(409, "Un locataire avec cet email existe déjà");

  const [tenant] = await db
    .insert(tenants)
    .values({ ...body, idDocument })
    .returning();
  res.status(201).json(tenant);
});

export const updateTenant = asyncHandler(async (req: Request, res: Response) => {
  const body = tenantSchema.partial().parse(req.body);
  const idDocument = req.file ? await uploadPrivateFile(req.file, "tenants") : undefined;

  const [existing] = await db.select().from(tenants).where(eq(tenants.id, req.params.id));
  if (!existing) throw new ApiError(404, "Locataire introuvable");

  const [tenant] = await db
    .update(tenants)
    .set({ ...body, ...(idDocument ? { idDocument } : {}) })
    .where(eq(tenants.id, req.params.id))
    .returning();
  res.json(tenant);
});

export const deleteTenant = asyncHandler(async (req: Request, res: Response) => {
  const [existing] = await db.select().from(tenants).where(eq(tenants.id, req.params.id));
  if (!existing) throw new ApiError(404, "Locataire introuvable");

  const tenantContracts = await db.select().from(contracts).where(eq(contracts.tenantId, req.params.id));
  if (tenantContracts.some((c) => c.status === "ACTIVE")) {
    throw new ApiError(409, "Impossible de supprimer un locataire ayant un contrat actif");
  }

  await db.delete(tenants).where(eq(tenants.id, req.params.id));
  res.status(204).send();
});

/** Génère une URL signée temporaire pour consulter la pièce d'identité d'un locataire (bucket privé). */
export const getTenantIdDocumentUrl = asyncHandler(async (req: Request, res: Response) => {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, req.params.id));
  if (!tenant) throw new ApiError(404, "Locataire introuvable");
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
  if (!tenant) throw new ApiError(404, "Locataire introuvable");

  const [existingUser] = await db.select().from(users).where(eq(users.email, tenant.email));
  if (existingUser) throw new ApiError(409, "Un compte existe déjà pour cet email");

  const passwordHash = await bcrypt.hash(body.password, 10);
  const [user] = await db
    .insert(users)
    .values({ email: tenant.email, passwordHash, role: "TENANT" })
    .returning();

  await db.update(tenants).set({ userId: user.id }).where(eq(tenants.id, tenant.id));

  res.status(201).json({ message: "Accès portail créé", userId: user.id, email: user.email });
});
