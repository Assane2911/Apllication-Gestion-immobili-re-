import { and, desc, eq, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { buildPaginatedResult, parsePagination } from "../utils/pagination";
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

/**
 * Même garde que sur listInvoices (invoice.controller.ts) : un paramètre de
 * requête répété (`?propertyId=a&propertyId=b`) devient un tableau via
 * Express/qs, et `String([...])` produisait silencieusement une valeur
 * (`"a,b"`) qui ne correspond à aucun bien réel — la requête renvoyait 200
 * avec une liste vide plutôt qu'un 400 signalant une requête mal formée.
 */
const listExpensesQuerySchema = z.object({
  propertyId: z.string().min(1).optional(),
});

export const listExpenses = asyncHandler(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);
  const { propertyId } = listExpensesQuerySchema.parse(req.query);

  const conditions = [eq(properties.managerId, req.user!.userId)];
  if (propertyId) conditions.push(eq(expenses.propertyId, propertyId));
  const whereClause = and(...conditions);

  type ExpenseRow = { expense: typeof expenses.$inferSelect; property: typeof properties.$inferSelect };

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({ expense: expenses, property: properties })
      .from(expenses)
      .innerJoin(properties, eq(expenses.propertyId, properties.id))
      .where(whereClause)
      .orderBy(desc(expenses.expenseDate))
      .limit(pagination.pageSize)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(expenses)
      .innerJoin(properties, eq(expenses.propertyId, properties.id))
      .where(whereClause),
  ]);

  res.json(
    buildPaginatedResult(
      rows.map((r: ExpenseRow) => ({ ...r.expense, property: r.property })),
      count,
      pagination
    )
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

  // Total des dépenses (scopé aux biens du gestionnaire connecté)
  const expenseRows = await db
    .select({ expense: expenses })
    .from(expenses)
    .innerJoin(properties, eq(expenses.propertyId, properties.id))
    .where(eq(properties.managerId, managerId));
  const allExpenses = expenseRows.map((r: { expense: typeof expenses.$inferSelect }) => r.expense);

  // Régression corrigée : plateforme multi-devises (EUR/XOF/...) — un
  // gestionnaire peut avoir des biens réglés dans des devises différentes.
  // Une simple somme de invoice.amount/expense.amount à travers des devises
  // différentes produisait un nombre sans signification (ex: 100 EUR +
  // 50 000 XOF affiché "50 100", comme si c'était homogène). Même principe
  // déjà appliqué à dashboard.controller.ts et admin.controller.ts : on
  // regroupe chaque total par devise plutôt que de les additionner.
  const totalRevenueByCurrency: Record<string, number> = {};
  for (const inv of paidInvoices) {
    const currency = inv.currency || "EUR";
    totalRevenueByCurrency[currency] = (totalRevenueByCurrency[currency] ?? 0) + inv.amount;
  }

  const totalExpensesByCurrency: Record<string, number> = {};
  // Ventilation par catégorie, elle aussi groupée par devise pour la même raison.
  const expensesByCategory: Record<string, Record<string, number>> = {};
  for (const exp of allExpenses) {
    const currency = exp.currency || "EUR";
    totalExpensesByCurrency[currency] = (totalExpensesByCurrency[currency] ?? 0) + exp.amount;
    expensesByCategory[exp.category] = expensesByCategory[exp.category] ?? {};
    expensesByCategory[exp.category][currency] = (expensesByCategory[exp.category][currency] ?? 0) + exp.amount;
  }

  const netCashFlowByCurrency: Record<string, number> = {};
  for (const currency of new Set([...Object.keys(totalRevenueByCurrency), ...Object.keys(totalExpensesByCurrency)])) {
    netCashFlowByCurrency[currency] = (totalRevenueByCurrency[currency] ?? 0) - (totalExpensesByCurrency[currency] ?? 0);
  }

  res.json({
    totalRevenueByCurrency,
    totalExpensesByCurrency,
    netCashFlowByCurrency,
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
/**
 * Periode de l'export : deux dates AAAA-MM-JJ, toutes deux facultatives.
 *
 * Le format ne suffit pas a faire une date : « 2026-13-45 » a la bonne forme
 * et n'existe pas. On verifie donc AUSSI que le calendrier la reconnait, en
 * comparant la date reconstruite a ce qui a ete saisi — sans quoi le 31 juin
 * glisserait au 1er juillet sans prevenir, et l'export couvrirait une periode
 * que personne n'a demandee.
 */
const jourIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date attendu : AAAA-MM-JJ")
  .refine((v) => {
    // Date.toISOString() leve sur une date invalide : sans ce garde-fou, un
    // « 2026-13-45 » ne donnerait pas un 400 mais une erreur 500.
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
  }, "Cette date n'existe pas");

const periodeExportSchema = z.object({
  from: jourIso.optional(),
  to: jourIso.optional(),
});

export const exportFinancialReport = asyncHandler(async (req: Request, res: Response) => {
  const managerId = req.user!.userId;
  // Une date illisible donnait un Invalid Date, et toute comparaison avec un
  // Invalid Date est FAUSSE : le filtre ne rejetait pas la requete, il
  // excluait silencieusement chaque ligne. Une faute de frappe dans une URL
  // produisait donc un rapport comptable vide, impossible a distinguer d'un
  // trimestre sans activite — le pire resultat possible pour un export sur
  // lequel on fonde une declaration.
  const { from, to } = periodeExportSchema.parse(req.query);
  const fromDate = from ? new Date(`${from}T00:00:00`) : null;
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
