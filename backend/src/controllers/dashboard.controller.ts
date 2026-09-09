import { and, eq, gte, inArray } from "drizzle-orm";
import { Request, Response } from "express";
import { db } from "../db/client";
import { expenses, invoices, issueReports, properties, contracts as contractsTable, tenants } from "../db/schema";
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

  const totalTenants = (await db.select().from(tenants).where(eq(tenants.managerId, managerId))).length;

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

  const managerInvoices =
    managerContractIds.length > 0
      ? await db.select().from(invoices).where(inArray(invoices.contractId, managerContractIds))
      : [];

  const monthlyInvoices = managerInvoices.filter(
    (i: typeof invoices.$inferSelect) => i.periodMonth === month && i.periodYear === year
  );

  // Plateforme multi-devises (EUR/XOF/...) : une simple somme de invoice.amount
  // à travers des factures de devises différentes produirait un nombre sans
  // signification (ex: 100 EUR + 50 000 XOF = "50 100", affiché avec le
  // symbole de la devise préférée du gestionnaire, comme si c'était homogène).
  // On regroupe donc chaque total par devise plutôt que de les additionner.
  const monthlyRevenueByCurrency: Record<string, number> = {};
  const monthlyExpectedByCurrency: Record<string, number> = {};
  for (const inv of monthlyInvoices) {
    const currency = inv.currency || "EUR";
    monthlyExpectedByCurrency[currency] = (monthlyExpectedByCurrency[currency] ?? 0) + inv.amount;
    if (inv.status === "PAID") {
      monthlyRevenueByCurrency[currency] = (monthlyRevenueByCurrency[currency] ?? 0) + inv.amount;
    }
  }
  const occupancyRate = totalProperties > 0 ? Math.round((statusCounts.OCCUPIED / totalProperties) * 100) : 0;

  const openIssues =
    managerContractIds.length > 0
      ? (
          await db
            .select()
            .from(issueReports)
            .where(and(inArray(issueReports.status, ["OPEN", "IN_PROGRESS"]), inArray(issueReports.contractId, managerContractIds)))
        ).length
      : 0;
  const lateInvoices = managerInvoices.filter((i: typeof invoices.$inferSelect) => i.status === "LATE").length;

  // Revenus des 6 derniers mois (paiements encaissés) pour un mini graphique.
  const sixMonthsAgo = new Date(year, month - 6, 1);
  const recentPaidInvoices = managerInvoices.filter(
    (i: typeof invoices.$inferSelect) => i.status === "PAID" && i.paidAt && new Date(i.paidAt) >= sixMonthsAgo
  );

  // Même principe que ci-dessus : regroupé par devise (mois -> devise -> montant)
  // plutôt que sommé à travers des devises différentes.
  const revenueByMonth: Record<string, Record<string, number>> = {};
  for (const inv of recentPaidInvoices) {
    const key = `${inv.periodYear}-${String(inv.periodMonth).padStart(2, "0")}`;
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
