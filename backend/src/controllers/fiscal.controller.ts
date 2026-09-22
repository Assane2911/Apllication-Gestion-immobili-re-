import { and, eq, gte, lte } from "drizzle-orm";
import { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db/client";
import { contracts, expenses, invoices, properties, tenants } from "../db/schema";
import { asyncHandler } from "../utils/asyncHandler";
import { csvEscape, csvMontant, CSV_BOM } from "../utils/csv";

/**
 * Module "Bilan Fiscal & Comptabilité" : synthèse annuelle (revenus/dépenses
 * par mois, ventilation par catégorie, bilan par bien) et export "Grand
 * Livre" (journal comptable chronologique de l'exercice), tous deux scopés
 * au gestionnaire connecté et à une année civile donnée.
 *
 * Choix délibéré de périmètre : contrairement au futur module "CRG"
 * (compte-rendu de gestion propriétaire, chantier séparé), rien ici ne
 * calcule de commission d'agence ni de reversement propriétaire — le bilan
 * par bien reste du point de vue du gestionnaire (revenus encaissés moins
 * charges), pas du propriétaire.
 *
 * Base de comptabilisation ("cash basis", cohérent avec exportFinancialReport
 * dans expense.controller.ts) : une facture compte l'année où elle a été
 * RÉELLEMENT ENCAISSÉE (paidAt), pas l'année de la période louée
 * (periodMonth/periodYear) ni de l'échéance (dueDate) — c'est la date qui
 * fait foi pour une déclaration de revenus fonciers en France (régime des
 * encaissements-décaissements). paidAt est normalement toujours renseigné
 * pour une facture PAID ; on retombe sur dueDate par précaution seulement.
 */
const yearQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

function yearBounds(year: number) {
  return {
    start: new Date(year, 0, 1, 0, 0, 0, 0),
    end: new Date(year, 11, 31, 23, 59, 59, 999),
  };
}

type PaidInvoiceRow = {
  invoice: typeof invoices.$inferSelect;
  contract: typeof contracts.$inferSelect;
  tenant: typeof tenants.$inferSelect;
  property: typeof properties.$inferSelect;
};
type ExpenseRow = { expense: typeof expenses.$inferSelect; property: typeof properties.$inferSelect };

async function loadYearData(managerId: string, year: number) {
  const { start, end } = yearBounds(year);

  // On ne peut pas filtrer paidAt directement en SQL de façon fiable ici :
  // paidAt est nullable (une facture PAID sans paidAt renseigné retombe sur
  // dueDate, voir le commentaire de tête) — le filtre est donc appliqué en
  // mémoire après avoir choisi la bonne date par ligne, exactement comme
  // exportFinancialReport (expense.controller.ts) le fait déjà.
  const [paidInvoiceRows, expenseRows] = await Promise.all([
    db
      .select({ invoice: invoices, contract: contracts, tenant: tenants, property: properties })
      .from(invoices)
      .innerJoin(contracts, eq(invoices.contractId, contracts.id))
      .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(and(eq(invoices.status, "PAID"), eq(properties.managerId, managerId))),
    db
      .select({ expense: expenses, property: properties })
      .from(expenses)
      .innerJoin(properties, eq(expenses.propertyId, properties.id))
      .where(and(eq(properties.managerId, managerId), gte(expenses.expenseDate, start), lte(expenses.expenseDate, end))),
  ]);

  const invoiceDate = (r: PaidInvoiceRow) => new Date(r.invoice.paidAt ?? r.invoice.dueDate);
  const filteredInvoices = (paidInvoiceRows as PaidInvoiceRow[]).filter((r) => {
    const d = invoiceDate(r);
    return d >= start && d <= end;
  });

  return { filteredInvoices, filteredExpenses: expenseRows as ExpenseRow[], invoiceDate };
}

/**
 * Années pour lesquelles le gestionnaire a au moins une facture payée ou une
 * dépense, pour peupler un sélecteur d'année côté frontend — sans jamais le
 * laisser vide même si le gestionnaire n'a encore aucune donnée sur l'année
 * en cours.
 */
async function availableYears(managerId: string): Promise<number[]> {
  const [paidInvoiceRows, expenseRows] = await Promise.all([
    db
      .select({ invoice: invoices })
      .from(invoices)
      .innerJoin(contracts, eq(invoices.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(and(eq(invoices.status, "PAID"), eq(properties.managerId, managerId))),
    db
      .select({ expense: expenses })
      .from(expenses)
      .innerJoin(properties, eq(expenses.propertyId, properties.id))
      .where(eq(properties.managerId, managerId)),
  ]);

  const years = new Set<number>([new Date().getFullYear()]);
  for (const r of paidInvoiceRows as { invoice: typeof invoices.$inferSelect }[]) {
    years.add(new Date(r.invoice.paidAt ?? r.invoice.dueDate).getFullYear());
  }
  for (const r of expenseRows as { expense: typeof expenses.$inferSelect }[]) {
    years.add(new Date(r.expense.expenseDate).getFullYear());
  }
  return Array.from(years).sort((a, b) => b - a);
}

export const getAnnualSynthesis = asyncHandler(async (req: Request, res: Response) => {
  const managerId = req.user!.userId;
  const { year: requestedYear } = yearQuerySchema.parse(req.query);
  const year = requestedYear ?? new Date().getFullYear();

  const { filteredInvoices, filteredExpenses, invoiceDate } = await loadYearData(managerId, year);

  // Plateforme multi-devises (EUR/XOF/...) : chaque total reste ventilé par
  // devise plutôt que sommé à travers des devises différentes, même
  // principe que dashboard.controller.ts / expense.controller.ts.
  const totalRevenueByCurrency: Record<string, number> = {};
  const revenueByMonth: Record<string, Record<string, number>> = {};
  for (const r of filteredInvoices) {
    const currency = r.invoice.currency || "EUR";
    totalRevenueByCurrency[currency] = (totalRevenueByCurrency[currency] ?? 0) + r.invoice.amount;
    const key = `${year}-${String(invoiceDate(r).getMonth() + 1).padStart(2, "0")}`;
    revenueByMonth[key] = revenueByMonth[key] ?? {};
    revenueByMonth[key][currency] = (revenueByMonth[key][currency] ?? 0) + r.invoice.amount;
  }

  const totalExpensesByCurrency: Record<string, number> = {};
  const expensesByMonth: Record<string, Record<string, number>> = {};
  const expensesByCategory: Record<string, Record<string, number>> = {};
  for (const r of filteredExpenses) {
    const currency = r.expense.currency || "EUR";
    totalExpensesByCurrency[currency] = (totalExpensesByCurrency[currency] ?? 0) + r.expense.amount;
    const key = `${year}-${String(new Date(r.expense.expenseDate).getMonth() + 1).padStart(2, "0")}`;
    expensesByMonth[key] = expensesByMonth[key] ?? {};
    expensesByMonth[key][currency] = (expensesByMonth[key][currency] ?? 0) + r.expense.amount;
    expensesByCategory[r.expense.category] = expensesByCategory[r.expense.category] ?? {};
    expensesByCategory[r.expense.category][currency] = (expensesByCategory[r.expense.category][currency] ?? 0) + r.expense.amount;
  }

  const netResultByCurrency: Record<string, number> = {};
  for (const currency of new Set([...Object.keys(totalRevenueByCurrency), ...Object.keys(totalExpensesByCurrency)])) {
    netResultByCurrency[currency] = (totalRevenueByCurrency[currency] ?? 0) - (totalExpensesByCurrency[currency] ?? 0);
  }

  // Bilan par bien, ventilé par devise (une clé propertyId+devise, et non
  // simplement propertyId comme le résumé par bien de exportFinancialReport)
  // : un bien a en pratique une seule devise, mais une dépense peut en
  // théorie être saisie dans une autre devise que celle du bien — mélanger
  // les deux sous une même ligne produirait un total sans signification.
  const byPropertyCurrency = new Map<
    string,
    { propertyId: string; propertyTitle: string; currency: string; revenue: number; expense: number }
  >();
  const keyFor = (propertyId: string, currency: string) => `${propertyId}::${currency}`;
  for (const r of filteredInvoices) {
    const currency = r.invoice.currency || "EUR";
    const key = keyFor(r.property.id, currency);
    const entry = byPropertyCurrency.get(key) ?? {
      propertyId: r.property.id,
      propertyTitle: r.property.title,
      currency,
      revenue: 0,
      expense: 0,
    };
    entry.revenue += r.invoice.amount;
    byPropertyCurrency.set(key, entry);
  }
  for (const r of filteredExpenses) {
    const currency = r.expense.currency || "EUR";
    const key = keyFor(r.property.id, currency);
    const entry = byPropertyCurrency.get(key) ?? {
      propertyId: r.property.id,
      propertyTitle: r.property.title,
      currency,
      revenue: 0,
      expense: 0,
    };
    entry.expense += r.expense.amount;
    byPropertyCurrency.set(key, entry);
  }
  const bilanParBien = Array.from(byPropertyCurrency.values())
    .map((entry) => ({ ...entry, net: entry.revenue - entry.expense }))
    .sort((a, b) => a.propertyTitle.localeCompare(b.propertyTitle) || a.currency.localeCompare(b.currency));

  res.json({
    year,
    availableYears: await availableYears(managerId),
    totalRevenueByCurrency,
    totalExpensesByCurrency,
    netResultByCurrency,
    revenueByMonth,
    expensesByMonth,
    expensesByCategory,
    bilanParBien,
  });
});

/**
 * Grand Livre : journal comptable chronologique de l'exercice (recettes et
 * dépenses mêlées, triées par date), avec un solde cumulé par devise —
 * contrairement à exportFinancialReport (revenus puis dépenses, groupés par
 * type), qui reste un rapport de synthèse et pas un journal chronologique.
 */
export const exportGrandLivre = asyncHandler(async (req: Request, res: Response) => {
  const managerId = req.user!.userId;
  const { year: requestedYear } = yearQuerySchema.parse(req.query);
  const year = requestedYear ?? new Date().getFullYear();

  const { filteredInvoices, filteredExpenses, invoiceDate } = await loadYearData(managerId, year);

  type JournalEntry = {
    date: Date;
    type: "Recette" | "Dépense";
    propertyTitle: string;
    categorie: string;
    libelle: string;
    montant: number;
    currency: string;
  };

  const entries: JournalEntry[] = [
    ...filteredInvoices.map(
      (r): JournalEntry => ({
        date: invoiceDate(r),
        type: "Recette",
        propertyTitle: r.property.title,
        categorie: "Loyer",
        libelle: `Loyer ${r.invoice.periodMonth}/${r.invoice.periodYear} - ${r.tenant.firstName} ${r.tenant.lastName}`,
        montant: r.invoice.amount,
        currency: r.invoice.currency || "EUR",
      })
    ),
    ...filteredExpenses.map(
      (r): JournalEntry => ({
        date: new Date(r.expense.expenseDate),
        type: "Dépense",
        propertyTitle: r.property.title,
        categorie: r.expense.category,
        libelle: r.expense.title,
        montant: r.expense.amount,
        currency: r.expense.currency || "EUR",
      })
    ),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  const lines: string[] = [];
  lines.push(`Grand Livre ${year}`);
  lines.push("");
  lines.push(["Date", "Bien", "Type", "Catégorie", "Libellé", "Recette", "Dépense", "Devise", "Solde cumulé"].join(";"));

  const runningBalanceByCurrency = new Map<string, number>();
  for (const entry of entries) {
    const previousBalance = runningBalanceByCurrency.get(entry.currency) ?? 0;
    const newBalance = entry.type === "Recette" ? previousBalance + entry.montant : previousBalance - entry.montant;
    runningBalanceByCurrency.set(entry.currency, newBalance);

    lines.push(
      [
        entry.date.toLocaleDateString("fr-FR"),
        csvEscape(entry.propertyTitle),
        entry.type,
        csvEscape(entry.categorie),
        csvEscape(entry.libelle),
        entry.type === "Recette" ? csvMontant(entry.montant) : "",
        entry.type === "Dépense" ? csvMontant(entry.montant) : "",
        entry.currency,
        csvMontant(newBalance),
      ].join(";")
    );
  }

  if (entries.length === 0) {
    lines.push(["Aucune écriture pour cet exercice"].join(";"));
  }

  const csvContent = CSV_BOM + lines.join("\n");
  const filename = `grand-livre-${year}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csvContent);
});
