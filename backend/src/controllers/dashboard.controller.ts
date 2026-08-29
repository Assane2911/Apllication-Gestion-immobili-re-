import { and, eq, gte, inArray } from "drizzle-orm";
import { Request, Response } from "express";
import { db } from "../db/client";
import { invoices, issueReports, properties, contracts as contractsTable, tenants } from "../db/schema";
import { asyncHandler } from "../utils/asyncHandler";

export const getDashboardStats = asyncHandler(async (_req: Request, res: Response) => {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const allProperties = await db.select().from(properties);
  const totalProperties = allProperties.length;
  const statusCounts = { AVAILABLE: 0, OCCUPIED: 0, MAINTENANCE: 0 } as Record<string, number>;
  for (const p of allProperties) statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;

  const totalTenants = (await db.select().from(tenants)).length;
  const activeContracts = (
    await db.select().from(contractsTable).where(eq(contractsTable.status, "ACTIVE"))
  ).length;

  const monthlyInvoices = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.periodMonth, month), eq(invoices.periodYear, year)));

  const monthlyRevenue = monthlyInvoices.filter((i) => i.status === "PAID").reduce((sum, i) => sum + i.amount, 0);
  const monthlyExpected = monthlyInvoices.reduce((sum, i) => sum + i.amount, 0);
  const occupancyRate = totalProperties > 0 ? Math.round((statusCounts.OCCUPIED / totalProperties) * 100) : 0;

  const openIssues = (
    await db.select().from(issueReports).where(inArray(issueReports.status, ["OPEN", "IN_PROGRESS"]))
  ).length;
  const lateInvoices = (await db.select().from(invoices).where(eq(invoices.status, "LATE"))).length;

  // Revenus des 6 derniers mois (paiements encaissés) pour un mini graphique.
  const sixMonthsAgo = new Date(year, month - 6, 1);
  const recentPaidInvoices = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.status, "PAID"), gte(invoices.paidAt, sixMonthsAgo)));

  const revenueByMonth: Record<string, number> = {};
  for (const inv of recentPaidInvoices) {
    const key = `${inv.periodYear}-${String(inv.periodMonth).padStart(2, "0")}`;
    revenueByMonth[key] = (revenueByMonth[key] ?? 0) + inv.amount;
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
  });
});
