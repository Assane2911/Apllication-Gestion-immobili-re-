import { desc, eq } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { contracts, invoices, properties, tenants } from "../db/schema";
import { initiatePayment, PaymentMethodKey } from "../services/payment.service";
import { ApiError, asyncHandler } from "../utils/asyncHandler";

export const listInvoices = asyncHandler(async (req: Request, res: Response) => {
  const { contractId } = req.query;

  let rows = await db
    .select({ invoice: invoices, contract: contracts, tenant: tenants, property: properties })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .orderBy(desc(invoices.periodYear), desc(invoices.periodMonth));

  if (contractId) rows = rows.filter((r) => r.invoice.contractId === String(contractId));
  if (req.query.status) rows = rows.filter((r) => r.invoice.status === String(req.query.status));

  res.json(
    rows.map((r) => ({
      ...r.invoice,
      contract: { ...r.contract, tenant: r.tenant, property: r.property },
    }))
  );
});

/** Le gestionnaire marque manuellement une facture comme réglée (ex: espèces). */
const markPaidSchema = z.object({
  paymentMethod: z.enum(["STRIPE", "MOBILE_MONEY", "BANK_TRANSFER", "DEMO"]).default("BANK_TRANSFER"),
  paymentRef: z.string().optional(),
});

export const markInvoicePaid = asyncHandler(async (req: Request, res: Response) => {
  const body = markPaidSchema.parse(req.body);
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, req.params.id));
  if (!invoice) throw new ApiError(404, "Facture introuvable");

  const [updated] = await db
    .update(invoices)
    .set({
      status: "PAID",
      paidAt: new Date(),
      paymentMethod: body.paymentMethod,
      paymentRef: body.paymentRef ?? `manuel_${Date.now()}`,
    })
    .where(eq(invoices.id, req.params.id))
    .returning();
  res.json(updated);
});

export const cancelInvoice = asyncHandler(async (req: Request, res: Response) => {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, req.params.id));
  if (!invoice) throw new ApiError(404, "Facture introuvable");
  const [updated] = await db.update(invoices).set({ status: "CANCELLED" }).where(eq(invoices.id, req.params.id)).returning();
  res.json(updated);
});

/** Factures du locataire connecté (portail locataire). */
export const myInvoices = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.tenantId) throw new ApiError(403, "Réservé aux locataires");
  const rows = await db
    .select({ invoice: invoices, contract: contracts, property: properties })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(eq(contracts.tenantId, req.user.tenantId))
    .orderBy(desc(invoices.periodYear), desc(invoices.periodMonth));

  res.json(rows.map((r) => ({ ...r.invoice, contract: { ...r.contract, property: r.property } })));
});

const paySchema = z.object({
  method: z.enum(["STRIPE", "MOBILE_MONEY", "BANK_TRANSFER", "DEMO"]),
  bankReference: z.string().optional(),
});

/** Le locataire connecté initie le paiement d'une de ses factures. */
export const payInvoice = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.tenantId) throw new ApiError(403, "Réservé aux locataires");
  const body = paySchema.parse(req.body);

  const [row] = await db
    .select({ invoice: invoices, contract: contracts, tenant: tenants })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .where(eq(invoices.id, req.params.id));

  if (!row) throw new ApiError(404, "Facture introuvable");
  if (row.contract.tenantId !== req.user.tenantId) throw new ApiError(403, "Accès refusé");
  if (row.invoice.status === "PAID") throw new ApiError(409, "Cette facture est déjà réglée");

  const result = await initiatePayment({
    method: body.method as PaymentMethodKey,
    amount: row.invoice.amount,
    invoiceId: row.invoice.id,
    payerEmail: row.tenant.email,
    bankReference: body.bankReference,
  });

  const [updated] = await db
    .update(invoices)
    .set({
      paymentMethod: result.method,
      paymentRef: result.reference,
      ...(result.status === "PAID" ? { status: "PAID" as const, paidAt: new Date() } : {}),
    })
    .where(eq(invoices.id, row.invoice.id))
    .returning();

  res.json({ invoice: updated, payment: result });
});
