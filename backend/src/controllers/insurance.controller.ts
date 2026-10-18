import { and, desc, eq, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { buildPaginatedResult, parsePagination } from "../utils/pagination";
import { insurancePolicies, properties } from "../db/schema";
import { logActivity } from "../services/activity.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";
import { assertOwnership } from "../utils/authorization";
import { deviseSchema } from "../utils/devises";

const insurancePolicyBodySchema = z.object({
  propertyId: z.string().min(1),
  insurerName: z.string().trim().min(1).max(200),
  policyNumber: z.string().trim().min(1).max(100),
  // .finite() : « 1e999 » est converti en Infinity par la coercition et passait `positive()`.
  premiumAmount: z.coerce.number().finite().positive().max(1_000_000_000_000).optional(),
  currency: deviseSchema.optional(),
  startDate: z.coerce.date().optional(),
  expiryDate: z.coerce.date(),
  notes: z.string().max(5000).optional(),
});

function assertDatesCoherentes(startDate: Date | undefined, expiryDate: Date) {
  if (startDate && expiryDate <= startDate) {
    throw new ApiError(400, "La date d'échéance doit être postérieure à la date de prise d'effet.");
  }
}

/** Une police d'assurance protège un bien et déclenche des rappels : qui l'a changée doit rester visible. */
async function tracer(
  req: Request,
  action: "insurance.create" | "insurance.update" | "insurance.delete",
  policy: { id: string; insurerName: string; policyNumber: string },
  titreBien: string,
  verbe: string
) {
  await logActivity({
    req,
    managerId: req.user!.userId,
    action,
    entityType: "insurance",
    entityId: policy.id,
    entityLabel: `${policy.insurerName} — ${policy.policyNumber}`,
    details: `Police d'assurance ${verbe} : ${policy.insurerName}, n° ${policy.policyNumber} (${titreBien})`,
  });
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

  await tracer(req, "insurance.create", policy, prop.title, "ajoutée");
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

  await tracer(req, "insurance.update", updated, prop.title, "modifiée");
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
  await tracer(req, "insurance.delete", row.policy, row.property.title, "supprimée");
  res.json({ success: true, message: "Police d'assurance supprimée" });
});
