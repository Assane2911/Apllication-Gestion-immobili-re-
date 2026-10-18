import { and, eq, gt, gte, inArray, ne, or, sql } from "drizzle-orm";
import { Request, Response } from "express";
import { db } from "../db/client";
import { expenses, invoices, issueReports, properties, contracts as contractsTable, tenants } from "../db/schema";
import { developperFactures } from "../services/encaissements.service";
import { asyncHandler } from "../utils/asyncHandler";

export const getDashboardStats = asyncHandler(async (req: Request, res: Response) => {
  const managerId = req.user!.userId;
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const allProperties = await db.select().from(properties).where(eq(properties.managerId, managerId));
  const totalProperties = allProperties.length;
  const propertyIds = allProperties.map((p: typeof properties.$inferSelect) => p.id);
  const statusCounts = { AVAILABLE: 0, OCCUPIED: 0, MAINTENANCE: 0 } as Record<string, number>;
  for (const p of allProperties) statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;

  // Comptage porté par SQL : charger chaque fiche locataire (identité, coordonnées…) pour n'en lire que la longueur.
  const [{ count: totalTenants }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tenants)
    .where(eq(tenants.managerId, managerId));

  const managerContractRows =
    propertyIds.length > 0
      ? await db
          .select({ contract: contractsTable })
          .from(contractsTable)
          .where(inArray(contractsTable.propertyId, propertyIds))
      : [];
  const managerContracts = managerContractRows.map((r: { contract: typeof contractsTable.$inferSelect }) => r.contract);
  const managerContractIds = managerContracts.map((c: typeof contractsTable.$inferSelect) => c.id);
  const activeContracts = managerContracts.filter((c: typeof contractsTable.$inferSelect) => c.status === "ACTIVE").length;

  const sixMonthsAgo = new Date(year, month - 6, 1);

  // Optimisation SQL : au lieu de charger tout l'historique complet des factures
  // en mémoire pour filtrer en JS, on cible précisément en base les factures
  // du mois, les factures en retard et les règlements récents.
  const [monthlyInvoices, lateInvoicesRows, recentPaidInvoices] =
    managerContractIds.length > 0
      ? await Promise.all([
          db
            .select()
            .from(invoices)
            .where(
              and(
                inArray(invoices.contractId, managerContractIds),
                eq(invoices.periodMonth, month),
                eq(invoices.periodYear, year),
                // Une facture annulée n'est plus due : elle ne fait pas partie du loyer « attendu ».
                ne(invoices.status, "CANCELLED")
              )
            ),
          db
            .select({ id: invoices.id })
            .from(invoices)
            .where(and(inArray(invoices.contractId, managerContractIds), eq(invoices.status, "LATE"))),
          db
            .select()
            .from(invoices)
            .where(
              and(
                inArray(invoices.contractId, managerContractIds),
                // Réglées récemment, OU ayant reçu au moins un acompte (le tri par
                // date se fait ensuite, paiement par paiement).
                or(and(eq(invoices.status, "PAID"), gte(invoices.paidAt, sixMonthsAgo)), gt(invoices.amountPaid, 0))
              )
            ),
        ])
      : [[], [], []];

  // Plateforme multi-devises (EUR/XOF/...) : une simple somme de invoice.amount
  // à travers des factures de devises différentes produirait un nombre sans
  // signification (ex: 100 EUR + 50 000 XOF = "50 100", affiché avec le
  // symbole de la devise préférée du gestionnaire, comme si c'était homogène).
  // On regroupe donc chaque total par devise plutôt que de les additionner.
  // ENCAISSEMENTS des six derniers mois, un par paiement (voir
  // encaissements.service.ts) : « revenus encaissés » compte l'argent REÇU, à la
  // date où il est arrivé — même base que le bilan fiscal et le compte-rendu de
  // gestion. « Attendu » reste, lui, le loyer DÛ pour la période du mois.
  const encaissements = (await developperFactures(recentPaidInvoices)).filter(
    (inv) => inv.paidAt && new Date(inv.paidAt) >= sixMonthsAgo
  );
  const monthlyRevenueByCurrency: Record<string, number> = {};
  const monthlyExpectedByCurrency: Record<string, number> = {};
  for (const inv of monthlyInvoices) {
    const currency = inv.currency || "EUR";
    monthlyExpectedByCurrency[currency] = (monthlyExpectedByCurrency[currency] ?? 0) + inv.amount;
  }
  for (const inv of encaissements) {
    const date = new Date(inv.paidAt!);
    if (date.getFullYear() === year && date.getMonth() + 1 === month) {
      const currency = inv.currency || "EUR";
      monthlyRevenueByCurrency[currency] = (monthlyRevenueByCurrency[currency] ?? 0) + inv.amount;
    }
  }
  const occupancyRate = totalProperties > 0 ? Math.round((statusCounts.OCCUPIED / totalProperties) * 100) : 0;

  const openIssues =
    managerContractIds.length > 0
      ? (
          await db
            .select({ count: sql<number>`count(*)::int` })
            .from(issueReports)
            .where(and(inArray(issueReports.status, ["OPEN", "IN_PROGRESS"]), inArray(issueReports.contractId, managerContractIds)))
        )[0].count
      : 0;
  const lateInvoices = lateInvoicesRows.length;

  // Même principe que ci-dessus : regroupé par devise (mois -> devise -> montant)
  // plutôt que sommé à travers des devises différentes.
  const revenueByMonth: Record<string, Record<string, number>> = {};
  for (const inv of encaissements) {
    // Mois de l'ENCAISSEMENT (et non de la période louée).
    const date = new Date(inv.paidAt!);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const currency = inv.currency || "EUR";
    revenueByMonth[key] = revenueByMonth[key] ?? {};
    revenueByMonth[key][currency] = (revenueByMonth[key][currency] ?? 0) + inv.amount;
  }

  // Dépenses des 6 derniers mois pour confronter visuellement dépenses vs revenus.
  const recentExpenses =
    propertyIds.length > 0
      ? await db
          .select()
          .from(expenses)
          .where(and(gte(expenses.expenseDate, sixMonthsAgo), inArray(expenses.propertyId, propertyIds)))
      : [];
  const expensesByMonth: Record<string, Record<string, number>> = {};
  for (const exp of recentExpenses) {
    const d = new Date(exp.expenseDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const currency = exp.currency || "EUR";
    expensesByMonth[key] = expensesByMonth[key] ?? {};
    expensesByMonth[key][currency] = (expensesByMonth[key][currency] ?? 0) + exp.amount;
  }

  res.json({
    totalProperties,
    propertiesByStatus: statusCounts,
    totalTenants,
    activeContracts,
    occupancyRate,
    monthlyRevenueByCurrency,
    monthlyExpectedByCurrency,
    openIssues,
    lateInvoices,
    revenueByMonth,
    expensesByMonth,
  });
});
