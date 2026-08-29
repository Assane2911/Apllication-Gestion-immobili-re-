import { desc, eq } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { contracts, invoices, properties, tenants } from "../db/schema";
import { logActivity } from "../services/activity.service";
import { initiatePayment, PaymentMethodKey } from "../services/payment.service";
import { sendPaymentReceiptEmail } from "../services/receipt.service";
import { runRentDueReminders, sendSingleInvoiceReminder } from "../services/reminder.service";
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

  type InvoiceRow = {
    invoice: typeof invoices.$inferSelect;
    contract: typeof contracts.$inferSelect;
    tenant: typeof tenants.$inferSelect;
    property: typeof properties.$inferSelect;
  };

  if (contractId) rows = rows.filter((r: InvoiceRow) => r.invoice.contractId === String(contractId));
  if (req.query.status) rows = rows.filter((r: InvoiceRow) => r.invoice.status === String(req.query.status));

  res.json(
    rows.map((r: InvoiceRow) => ({
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

  // Envoi de la quittance PDF par email au locataire — ne doit jamais faire
  // échouer la réponse si l'email ne part pas (SMTP non configuré, etc.).
  sendPaymentReceiptEmail(updated.id).catch((err) =>
    console.error("[invoice] Échec de l'envoi automatique de la quittance:", err)
  );

  const [row] = await db
    .select({ contract: contracts, tenant: tenants, property: properties })
    .from(contracts)
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(eq(contracts.id, updated.contractId));
  await logActivity({
    req,
    action: "invoice.mark_paid",
    entityType: "invoice",
    entityId: updated.id,
    entityLabel: row ? `${row.tenant.firstName} ${row.tenant.lastName} — ${row.property.title}` : "Facture",
    details: `Facture ${updated.periodMonth}/${updated.periodYear} marquée réglée (${updated.amount} ${updated.currency ?? "EUR"})`,
  });

  res.json(updated);
});

export const cancelInvoice = asyncHandler(async (req: Request, res: Response) => {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, req.params.id));
  if (!invoice) throw new ApiError(404, "Facture introuvable");
  const [updated] = await db.update(invoices).set({ status: "CANCELLED" }).where(eq(invoices.id, req.params.id)).returning();

  await logActivity({
    req,
    action: "invoice.cancel",
    entityType: "invoice",
    entityId: updated.id,
    entityLabel: `Facture ${updated.periodMonth}/${updated.periodYear}`,
    details: `Facture ${updated.periodMonth}/${updated.periodYear} annulée`,
  });

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

  res.json(
    rows.map(
      (r: {
        invoice: typeof invoices.$inferSelect;
        contract: typeof contracts.$inferSelect;
        property: typeof properties.$inferSelect;
      }) => ({ ...r.invoice, contract: { ...r.contract, property: r.property } })
    )
  );
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

  if (updated.status === "PAID") {
    sendPaymentReceiptEmail(updated.id).catch((err) =>
      console.error("[invoice] Échec de l'envoi automatique de la quittance:", err)
    );
  }

  res.json({ invoice: updated, payment: result });
});

/** Déclenchement manuel des avis d'échéance du 1er du mois par le gestionnaire. */
export const sendMonthlyReminders = asyncHandler(async (_req: Request, res: Response) => {
  const result = await runRentDueReminders();
  res.json({
    success: true,
    message: `${result.sent} avis d'échéance envoyé(s) avec succès aux locataires.`,
    sent: result.sent,
    details: result.details,
  });
});

/** Envoi d'un rappel individuel pour une facture impayée. */
export const sendInvoiceReminder = asyncHandler(async (req: Request, res: Response) => {
  const result = await sendSingleInvoiceReminder(req.params.id);
  res.json({
    message: `Rappel d'échéance envoyé à ${result.tenantName} (${result.tenantEmail}).`,
    ...result,
  });
});

