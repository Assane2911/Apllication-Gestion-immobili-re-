import { desc, eq, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { contracts, expenses, invoices, properties } from "../db/schema";
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
    .orderBy(desc(expenses.expenseDate));

  if (propertyId) {
    rows = rows.filter((r) => r.expense.propertyId === String(propertyId));
  }

  res.json(
    rows.map((r) => ({
      ...r.expense,
      property: r.property,
    }))
  );
});

export const createExpense = asyncHandler(async (req: Request, res: Response) => {
  const body = createExpenseSchema.parse(req.body);

  const [prop] = await db.select().from(properties).where(eq(properties.id, body.propertyId));
  if (!prop) throw new ApiError(404, "Bien introuvable");

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
  const [existing] = await db.select().from(expenses).where(eq(expenses.id, req.params.id));
  if (!existing) throw new ApiError(404, "Dépense introuvable");

  await db.delete(expenses).where(eq(expenses.id, req.params.id));
  res.json({ success: true, message: "Dépense supprimée" });
});

export const getFinancialSummary = asyncHandler(async (_req: Request, res: Response) => {
  // Total des loyers payés
  const paidInvoices = await db.select().from(invoices).where(eq(invoices.status, "PAID"));
  const totalRevenue = paidInvoices.reduce((acc, inv) => acc + inv.amount, 0);

  // Total des dépenses
  const allExpenses = await db.select().from(expenses);
  const totalExpenses = allExpenses.reduce((acc, exp) => acc + exp.amount, 0);

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
