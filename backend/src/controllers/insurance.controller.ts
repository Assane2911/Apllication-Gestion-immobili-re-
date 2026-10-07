import { and, desc, eq, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { buildPaginatedResult, parsePagination } from "../utils/pagination";
import { insurancePolicies, properties } from "../db/schema";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { assertOwnership } from "../utils/authorization";
import { deviseSchema } from "../utils/devises";

const insurancePolicyBodySchema = z.object({
  propertyId: z.string().min(1),
  insurerName: z.string().min(1),
  policyNumber: z.string().min(1),
  premiumAmount: z.coerce.number().positive().optional(),
  currency: deviseSchema.optional(),
  startDate: z.coerce.date().optional(),
  expiryDate: z.coerce.date(),
  notes: z.string().optional(),
});

function assertDatesCoherentes(startDate: Date | undefined, expiryDate: Date) {
  if (startDate && expiryDate <= startDate) {
    throw new ApiError(400, "La date d'échéance doit être postérieure à la date de prise d'effet.");
  }
}

const listInsurancePoliciesQuerySchema = z.object({
  propertyId: z.string().min(1).optional(),
});

export const listInsurancePolicies = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);
  const { propertyId } = listInsurancePoliciesQuerySchema.parse(req.query);

  const conditions = [eq(properties.managerId, req.user!.userId)];
  if (propertyId) conditions.push(eq(insurancePolicies.propertyId, propertyId));
  const whereClause = and(...conditions);

  type PolicyRow = { policy: typeof insurancePolicies.$inferSelect; property: typeof properties.$inferSelect };

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({ policy: insurancePolicies, property: properties })
      .from(insurancePolicies)
      .innerJoin(properties, eq(insurancePolicies.propertyId, properties.id))
      .where(whereClause)
      .orderBy(desc(insurancePolicies.expiryDate))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(insurancePolicies)
      .innerJoin(properties, eq(insurancePolicies.propertyId, properties.id))
      .where(whereClause),
  ]);

  res.json(
    buildPaginatedResult(
      rows.map((r: PolicyRow) => ({ ...r.policy, property: r.property })),
      count,
      pagination
    )
  );
});

export const createInsurancePolicy = asyncHandler(async (req: Request, res: Response) => {
  const body = insurancePolicyBodySchema.parse(req.body);
  assertDatesCoherentes(body.startDate, body.expiryDate);

  const [prop] = await db.select().from(properties).where(eq(properties.id, body.propertyId));
  assertOwnership(prop, (p) => p.managerId, req.user!.userId, "Bien introuvable");

  const [policy] = await db
    .insert(insurancePolicies)
    .values({
      propertyId: body.propertyId,
      insurerName: body.insurerName,
      policyNumber: body.policyNumber,
      premiumAmount: body.premiumAmount,
      currency: body.currency || prop.currency || "EUR",
      startDate: body.startDate,
      expiryDate: body.expiryDate,
      notes: body.notes,
    })
    .returning();

  res.status(201).json(policy);
});

export const updateInsurancePolicy = asyncHandler(async (req: Request, res: Response) => {
  const body = insurancePolicyBodySchema.parse(req.body);
  assertDatesCoherentes(body.startDate, body.expiryDate);

  const [row] = await db
    .select({ policy: insurancePolicies, property: properties })
    .from(insurancePolicies)
    .innerJoin(properties, eq(insurancePolicies.propertyId, properties.id))
    .where(eq(insurancePolicies.id, req.params.id));
  assertOwnership(row, (r) => r.property.managerId, req.user!.userId, "Police d'assurance introuvable");

  const [prop] = await db.select().from(properties).where(eq(properties.id, body.propertyId));
  assertOwnership(prop, (p) => p.managerId, req.user!.userId, "Bien introuvable");

  // Un renouvellement (nouvelle échéance, strictement postérieure à
  // l'ancienne) doit pouvoir déclencher un nouveau rappel le moment venu —
  // sans cette remise à zéro, une police renouvelée chaque année ne
  // recevrait jamais plus qu'un seul rappel, le tout premier, pour toute sa
  // durée de vie (voir reminderSentAt, schema.ts).
  const estRenouvellement = body.expiryDate.getTime() > new Date(row.policy.expiryDate).getTime();

  const [updated] = await db
    .update(insurancePolicies)
    .set({
      propertyId: body.propertyId,
      insurerName: body.insurerName,
      policyNumber: body.policyNumber,
      premiumAmount: body.premiumAmount,
      currency: body.currency || prop.currency || "EUR",
      startDate: body.startDate,
      expiryDate: body.expiryDate,
      notes: body.notes,
      ...(estRenouvellement ? { reminderSentAt: null } : {}),
    })
    .where(eq(insurancePolicies.id, req.params.id))
    .returning();

  res.json(updated);
});

export const deleteInsurancePolicy = asyncHandler(async (req: Request, res: Response) => {
  const [row] = await db
    .select({ policy: insurancePolicies, property: properties })
    .from(insurancePolicies)
    .innerJoin(properties, eq(insurancePolicies.propertyId, properties.id))
    .where(eq(insurancePolicies.id, req.params.id));
  assertOwnership(row, (r) => r.property.managerId, req.user!.userId, "Police d'assurance introuvable");

  await db.delete(insurancePolicies).where(eq(insurancePolicies.id, req.params.id));
  res.json({ success: true, message: "Police d'assurance supprimée" });
});
