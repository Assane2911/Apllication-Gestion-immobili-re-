import { and, desc, eq, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { contracts, expenses, invoices, properties, tenants } from "../db/schema";
import { ApiError, asyncHandler } from "../utils/asyncHandler";

const createExpenseSchema = z.object({
  propertyId: z.string().min(1),
  category: z.enum(["MAINTENANCE", "TAX", "INSURANCE", "SYNDIC", "OTHER"]).default("MAINTENANCE"),
  title: z.string().min(1),
  amount: z.coerce.number().positive(),
  currency: z.string().default("EUR"),
  expenseDate: z.string().optional(),
  notes: z.string().optional(),
});

export const listExpenses = asyncHandler(async (req: Request, res: Response) => {
  const { propertyId } = req.query;

  let rows = await db
    .select({
      expense: expenses,
      property: properties,
    })
    .from(expenses)
    .innerJoin(properties, eq(expenses.propertyId, properties.id))
    .where(eq(properties.managerId, req.user!.userId))
    .orderBy(desc(expenses.expenseDate));

  if (propertyId) {
    rows = rows.filter((r: { expense: typeof expenses.$inferSelect; property: typeof properties.$inferSelect }) => r.expense.propertyId === String(propertyId));
  }

  res.json(
    rows.map((r: { expense: typeof expenses.$inferSelect; property: typeof properties.$inferSelect }) => ({
      ...r.expense,
      property: r.property,
    }))
  );
});

export const createExpense = asyncHandler(async (req: Request, res: Response) => {
  const body = createExpenseSchema.parse(req.body);

  const [prop] = await db.select().from(properties).where(eq(properties.id, body.propertyId));
  if (!prop || prop.managerId !== req.user!.userId) throw new ApiError(404, "Bien introuvable");

  const [expense] = await db
    .insert(expenses)
    .values({
      propertyId: body.propertyId,
      category: body.category,
      title: body.title,
      amount: body.amount,
      currency: body.currency || prop.currency || "EUR",
      expenseDate: body.expenseDate ? new Date(body.expenseDate) : new Date(),
      notes: body.notes,
    })
    .returning();

  res.status(201).json(expense);
});

export const deleteExpense = asyncHandler(async (req: Request, res: Response) => {
  const [row] = await db
    .select({ expense: expenses, property: properties })
    .from(expenses)
    .innerJoin(properties, eq(expenses.propertyId, properties.id))
    .where(eq(expenses.id, req.params.id));
  if (!row || row.property.managerId !== req.user!.userId) throw new ApiError(404, "Dépense introuvable");

  await db.delete(expenses).where(eq(expenses.id, req.params.id));
  res.json({ success: true, message: "Dépense supprimée" });
});

export const getFinancialSummary = asyncHandler(async (req: Request, res: Response) => {
  const managerId = req.user!.userId;

  // Total des loyers payés (scopé aux biens du gestionnaire connecté)
  const paidInvoiceRows = await db
    .select({ invoice: invoices })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(and(eq(invoices.status, "PAID"), eq(properties.managerId, managerId)));
  const paidInvoices = paidInvoiceRows.map((r: { invoice: typeof invoices.$inferSelect }) => r.invoice);
  const totalRevenue = paidInvoices.reduce((acc: number, inv: typeof invoices.$inferSelect) => acc + inv.amount, 0);

  // Total des dépenses (scopé aux biens du gestionnaire connecté)
  const expenseRows = await db
    .select({ expense: expenses })
    .from(expenses)
    .innerJoin(properties, eq(expenses.propertyId, properties.id))
    .where(eq(properties.managerId, managerId));
  const allExpenses = expenseRows.map((r: { expense: typeof expenses.$inferSelect }) => r.expense);
  const totalExpenses = allExpenses.reduce((acc: number, exp: typeof expenses.$inferSelect) => acc + exp.amount, 0);

  // Ventilation par catégorie
  const expensesByCategory: Record<string, number> = {};
  for (const exp of allExpenses) {
    expensesByCategory[exp.category] = (expensesByCategory[exp.category] || 0) + exp.amount;
  }

  const netCashFlow = totalRevenue - totalExpenses;

  res.json({
    totalRevenue,
    totalExpenses,
    netCashFlow,
    expensesByCategory,
    expenseCount: allExpenses.length,
    paidInvoiceCount: paidInvoices.length,
  });
});

function csvEscape(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

/**
 * Rapport financier complet (revenus + dépenses + résultat net par bien),
 * exporté en CSV — utile pour la comptabilité/fiscalité du gestionnaire.
 * Filtrable sur une période via ?from=YYYY-MM-DD&to=YYYY-MM-DD.
 */
export const exportFinancialReport = asyncHandler(async (req: Request, res: Response) => {
  const managerId = req.user!.userId;
  const { from, to } = req.query as { from?: string; to?: string };
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(`${to}T23:59:59`) : null;

  const paidInvoiceRows = await db
    .select({ invoice: invoices, contract: contracts, tenant: tenants, property: properties })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(and(eq(invoices.status, "PAID"), eq(properties.managerId, managerId)));

  const expenseRows = await db
    .select({ expense: expenses, property: properties })
    .from(expenses)
    .innerJoin(properties, eq(expenses.propertyId, properties.id))
    .where(eq(properties.managerId, managerId));

  type PaidInvoiceRow = {
    invoice: typeof invoices.$inferSelect;
    contract: typeof contracts.$inferSelect;
    tenant: typeof tenants.$inferSelect;
    property: typeof properties.$inferSelect;
  };
  type ExpenseRow = { expense: typeof expenses.$inferSelect; property: typeof properties.$inferSelect };

  const inRange = (d: Date) => (!fromDate || d >= fromDate) && (!toDate || d <= toDate);

  const filteredInvoices = (paidInvoiceRows as PaidInvoiceRow[]).filter((r) =>
    inRange(new Date(r.invoice.paidAt ?? r.invoice.dueDate))
  );
  const filteredExpenses = (expenseRows as ExpenseRow[]).filter((r) => inRange(new Date(r.expense.expenseDate)));

  const lines: string[] = [];
  lines.push(["Type", "Date", "Bien", "Détail", "Description", "Montant", "Devise"].join(";"));

  for (const r of filteredInvoices) {
    const d = r.invoice.paidAt ?? r.invoice.dueDate;
    lines.push(
      [
        "Revenu",
        new Date(d).toLocaleDateString("fr-FR"),
        csvEscape(r.property.title),
        csvEscape(`${r.tenant.firstName} ${r.tenant.lastName}`),
        csvEscape(`Loyer ${r.invoice.periodMonth}/${r.invoice.periodYear}`),
        r.invoice.amount,
        r.invoice.currency || "EUR",
      ].join(";")
    );
  }

  for (const r of filteredExpenses) {
    lines.push(
      [
        "Dépense",
        new Date(r.expense.expenseDate).toLocaleDateString("fr-FR"),
        csvEscape(r.property.title),
        csvEscape(r.expense.category),
        csvEscape(r.expense.title),
        -r.expense.amount,
        r.expense.currency || "EUR",
      ].join(";")
    );
  }

  lines.push("");
  lines.push(["--- Résumé par bien ---"].join(";"));
  lines.push(["Bien", "Revenus", "Dépenses", "Résultat net"].join(";"));

  const byProperty = new Map<string, { title: string; revenue: number; expense: number }>();
  for (const r of filteredInvoices) {
    const entry = byProperty.get(r.property.id) ?? { title: r.property.title, revenue: 0, expense: 0 };
    entry.revenue += r.invoice.amount;
    byProperty.set(r.property.id, entry);
  }
  for (const r of filteredExpenses) {
    const entry = byProperty.get(r.property.id) ?? { title: r.property.title, revenue: 0, expense: 0 };
    entry.expense += r.expense.amount;
    byProperty.set(r.property.id, entry);
  }
  for (const entry of byProperty.values()) {
    lines.push([csvEscape(entry.title), entry.revenue, entry.expense, entry.revenue - entry.expense].join(";"));
  }

  const csvContent = "﻿" + lines.join("\n");
  const filename = `rapport-financier-${new Date().toISOString().split("T")[0]}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csvContent);
});
