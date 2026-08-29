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

  const monthlyRevenue = monthlyInvoices.filter((i: typeof invoices.$inferSelect) => i.status === "PAID").reduce((sum: number, i: typeof invoices.$inferSelect) => sum + i.amount, 0);
  const monthlyExpected = monthlyInvoices.reduce((sum: number, i: typeof invoices.$inferSelect) => sum + i.amount, 0);
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

  const revenueByMonth: Record<string, number> = {};
  for (const inv of recentPaidInvoices) {
    const key = `${inv.periodYear}-${String(inv.periodMonth).padStart(2, "0")}`;
    revenueByMonth[key] = (revenueByMonth[key] ?? 0) + inv.amount;
  }

  // Dépenses des 6 derniers mois pour confronter visuellement dépenses vs revenus.
  const recentExpenses =
    propertyIds.length > 0
      ? await db
          .select()
          .from(expenses)
          .where(and(gte(expenses.expenseDate, sixMonthsAgo), inArray(expenses.propertyId, propertyIds)))
      : [];
  const expensesByMonth: Record<string, number> = {};
  for (const exp of recentExpenses) {
    const d = new Date(exp.expenseDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    expensesByMonth[key] = (expensesByMonth[key] ?? 0) + exp.amount;
  }

  res.json({
    totalProperties,
    propertiesByStatus: statusCounts,
    totalTenants,
    activeContracts,
    occupancyRate,
    monthlyRevenue,
    monthlyExpected,
    openIssues,
    lateInvoices,
    revenueByMonth,
    expensesByMonth,
  });
});
