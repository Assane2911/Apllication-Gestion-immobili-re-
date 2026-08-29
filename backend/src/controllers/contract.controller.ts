import { desc, eq } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { contracts, invoices, issueReports, properties, tenants } from "../db/schema";
import { generateInvoicesForContract } from "../services/invoice.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";

const contractSchema = z.object({
  propertyId: z.string().min(1),
  tenantId: z.string().min(1),
  rent: z.coerce.number().positive(),
  deposit: z.coerce.number().nonnegative(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  status: z.enum(["ACTIVE", "ENDED", "TERMINATED"]).optional(),
});

async function withRelations(contractId: string) {
  const [row] = await db
    .select({ contract: contracts, property: properties, tenant: tenants })
    .from(contracts)
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .where(eq(contracts.id, contractId));
  if (!row) return null;
  const contractInvoices = await db
    .select()
    .from(invoices)
    .where(eq(invoices.contractId, contractId))
    .orderBy(desc(invoices.periodYear), desc(invoices.periodMonth));
  return { ...row.contract, property: row.property, tenant: row.tenant, invoices: contractInvoices };
}

export const listContracts = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await db
    .select({ contract: contracts, property: properties, tenant: tenants })
    .from(contracts)
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .orderBy(desc(contracts.createdAt));

  res.json(rows.map((r) => ({ ...r.contract, property: r.property, tenant: r.tenant })));
});

export const getContract = asyncHandler(async (req: Request, res: Response) => {
  const full = await withRelations(req.params.id);
  if (!full) throw new ApiError(404, "Contrat introuvable");
  res.json(full);
});

export const createContract = asyncHandler(async (req: Request, res: Response) => {
  const body = contractSchema.parse(req.body);

  if (body.endDate <= body.startDate) {
    throw new ApiError(400, "La date de fin doit être postérieure à la date de début");
  }

  const [property] = await db.select().from(properties).where(eq(properties.id, body.propertyId));
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, body.tenantId));
  if (!property) throw new ApiError(404, "Bien introuvable");
  if (!tenant) throw new ApiError(404, "Locataire introuvable");

  const [contract] = await db.insert(contracts).values(body).returning();

  await db.update(properties).set({ status: "OCCUPIED" }).where(eq(properties.id, body.propertyId));
  await generateInvoicesForContract(contract);

  res.status(201).json(await withRelations(contract.id));
});

export const updateContract = asyncHandler(async (req: Request, res: Response) => {
  const body = contractSchema.partial().parse(req.body);

  const [existing] = await db.select().from(contracts).where(eq(contracts.id, req.params.id));
  if (!existing) throw new ApiError(404, "Contrat introuvable");

  const [contract] = await db.update(contracts).set(body).where(eq(contracts.id, req.params.id)).returning();

  if (body.status === "ENDED" || body.status === "TERMINATED") {
    const propertyContracts = await db.select().from(contracts).where(eq(contracts.propertyId, contract.propertyId));
    const stillActive = propertyContracts.filter((c) => c.status === "ACTIVE").length;
    if (stillActive === 0) {
      await db.update(properties).set({ status: "AVAILABLE" }).where(eq(properties.id, contract.propertyId));
    }
  }

  if (contract.status === "ACTIVE") {
    await generateInvoicesForContract(contract);
  }

  res.json(contract);
});

export const deleteContract = asyncHandler(async (req: Request, res: Response) => {
  const [existing] = await db.select().from(contracts).where(eq(contracts.id, req.params.id));
  if (!existing) throw new ApiError(404, "Contrat introuvable");

  await db.delete(invoices).where(eq(invoices.contractId, req.params.id));
  await db.delete(issueReports).where(eq(issueReports.contractId, req.params.id));
  await db.delete(contracts).where(eq(contracts.id, req.params.id));

  const propertyContracts = await db.select().from(contracts).where(eq(contracts.propertyId, existing.propertyId));
  const stillActive = propertyContracts.filter((c) => c.status === "ACTIVE").length;
  if (stillActive === 0) {
    await db.update(properties).set({ status: "AVAILABLE" }).where(eq(properties.id, existing.propertyId));
  }

  res.status(204).send();
});

/** Contrat(s) actif(s) du locataire connecté (portail locataire). */
export const myContracts = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.tenantId) throw new ApiError(403, "Réservé aux locataires");
  const rows = await db
    .select({ contract: contracts, property: properties })
    .from(contracts)
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(eq(contracts.tenantId, req.user.tenantId))
    .orderBy(desc(contracts.createdAt));

  const result = [];
  for (const row of rows) {
    const contractInvoices = await db
      .select()
      .from(invoices)
      .where(eq(invoices.contractId, row.contract.id))
      .orderBy(desc(invoices.periodYear), desc(invoices.periodMonth));
    result.push({ ...row.contract, property: row.property, invoices: contractInvoices });
  }
  res.json(result);
});
