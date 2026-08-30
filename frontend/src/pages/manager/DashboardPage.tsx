import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  FileText,
  Gauge,
  TrendingUp,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, apiErrorMessage } from "../../api/client";
import { Skeleton, StatCardSkeleton } from "../../components/Skeleton";
import StatCard from "../../components/StatCard";
import { useCurrency } from "../../context/CurrencyContext";
import type { DashboardStats, PropertyStatus } from "../../types";

const statusColors: Record<PropertyStatus, string> = {
  AVAILABLE: "#10b981",
  OCCUPIED: "#2563eb",
  MAINTENANCE: "#f59e0b",
};

export default function DashboardPage() {
  const { t } = useTranslation();
  const { formatMoney } = useCurrency();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const statusLabels: Record<PropertyStatus, string> = {
    AVAILABLE: t("common.status.AVAILABLE"),
    OCCUPIED: t("common.status.OCCUPIED"),
    MAINTENANCE: t("common.status.MAINTENANCE"),
  };

  useEffect(() => {
    setLoading(true);
    api
      .get<DashboardStats>("/dashboard/stats")
      .then((res) => {
        setStats(res.data);
        setError(null);
      })
      .catch((err) => {
        setError(apiErrorMessage(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 p-6 rounded-2xl">
        <h3 className="font-bold text-base mb-1">{t("manager.dashboard.errorTitle")}</h3>
        <p className="text-sm">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-4 py-2 rounded-xl"
        >
          {t("common.actions.retry")}
        </button>
      </div>
    );
  }

  if (loading || !stats) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{t("manager.dashboard.title")}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("manager.dashboard.loadingHint")}</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
          <Skeleton className="h-5 w-56 mb-4" />
          <Skeleton className="h-[260px] w-full rounded-xl" />
        </div>
      </div>
    );
  }

  const revenueByMonth = stats.revenueByMonth ?? {};
  const expensesByMonth = stats.expensesByMonth ?? {};
  const propertiesByStatus = stats.propertiesByStatus ?? {
    AVAILABLE: 0,
    OCCUPIED: 0,
    MAINTENANCE: 0,
  };

  // Combine revenus et dépenses par mois pour le graphique
  const allMonths = Array.from(
    new Set([...Object.keys(revenueByMonth), ...Object.keys(expensesByMonth)])
  ).sort((a, b) => a.localeCompare(b));

  const comparisonChartData =
    allMonths.length > 0
      ? allMonths.map((month) => ({
          month,
          revenue: Number(revenueByMonth[month] ?? 0),
          expense: Number(expensesByMonth[month] ?? 0),
        }))
      : [
          {
            month: t("manager.dashboard.charts.currentMonth"),
            revenue: Number(stats.monthlyRevenue ?? 0),
            expense: 0,
          },
        ];

  const donutData = (Object.keys(statusLabels) as PropertyStatus[])
    .map((status) => ({
      status,
      value: Number(propertiesByStatus[status] ?? 0),
    }))
    .filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span>{t("manager.dashboard.title")}</span>
            <span className="text-xs bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 font-semibold px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
              <CheckCircle2 size={12} /> {t("manager.dashboard.liveSystem")}
            </span>
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("manager.dashboard.overviewSubtitle")}</p>
        </div>
      </div>

      {/* Grille des 8 indicateurs clés */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Building2}
          label={t("manager.dashboard.stats.properties")}
          value={stats.totalProperties ?? 0}
          hint={t("manager.dashboard.stats.propertiesHint", { count: propertiesByStatus.AVAILABLE ?? 0 })}
          accent="blue"
        />
        <StatCard
          icon={Gauge}
          label={t("manager.dashboard.stats.occupancy")}
          value={`${stats.occupancyRate ?? 0}%`}
          hint={t("manager.dashboard.stats.occupancyHint", { count: propertiesByStatus.OCCUPIED ?? 0 })}
          accent="green"
        />
        <StatCard
          icon={Users}
          label={t("manager.dashboard.stats.tenants")}
          value={stats.totalTenants ?? 0}
          hint={t("manager.dashboard.stats.tenantsHint")}
          accent="blue"
        />
        <StatCard
          icon={FileText}
          label={t("manager.dashboard.stats.contracts")}
          value={stats.activeContracts ?? 0}
          hint={t("manager.dashboard.stats.contractsHint")}
          accent="blue"
        />
        <StatCard
          icon={Wallet}
          label={t("manager.dashboard.stats.revenue")}
          value={formatMoney(stats.monthlyRevenue ?? 0)}
          hint={t("manager.dashboard.stats.revenueHint", { amount: formatMoney(stats.monthlyExpected ?? 0) })}
          accent="green"
        />
        <StatCard
          icon={AlertTriangle}
          label={t("manager.dashboard.stats.lateInvoices")}
          value={stats.lateInvoices ?? 0}
          hint={stats.lateInvoices > 0 ? t("manager.dashboard.stats.lateInvoicesHintYes") : t("manager.dashboard.stats.lateInvoicesHintNo")}
          accent={stats.lateInvoices > 0 ? "red" : "green"}
        />
        <StatCard
          icon={Wrench}
          label={t("manager.dashboard.stats.openIssues")}
          value={stats.openIssues ?? 0}
          hint={stats.openIssues > 0 ? t("manager.dashboard.stats.openIssuesHintYes") : t("manager.dashboard.stats.openIssuesHintNo")}
          accent={stats.openIssues > 0 ? "amber" : "green"}
        />
        <StatCard
          icon={TrendingUp}
          label={t("manager.dashboard.stats.maintenance")}
          value={propertiesByStatus.MAINTENANCE ?? 0}
          hint={t("manager.dashboard.stats.maintenanceHint")}
          accent="amber"
        />
      </div>

      {/* Graphiques */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Graphique Barres Comparatif Revenus vs Dépenses */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">{t("manager.dashboard.charts.revenueVsExpenses")}</h3>
          </div>
          {comparisonChartData.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 py-16 text-center">
              {t("manager.dashboard.charts.noRevenueData")}
            </p>
          ) : (
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparisonChartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-slate-100 dark:stroke-slate-700" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: "currentColor" }} className="text-slate-500 dark:text-slate-400" />
                  <YAxis tick={{ fontSize: 12, fill: "currentColor" }} className="text-slate-500 dark:text-slate-400" />
                  <Tooltip
                    formatter={(value: any, name: any) => [
                      formatMoney(Number(value)),
                      name === "revenue" ? t("manager.dashboard.charts.tooltipRevenue") : t("manager.dashboard.charts.tooltipExpense"),
                    ]}
                    contentStyle={{
                      borderRadius: "12px",
                      fontSize: "12px",
                      boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)",
                      border: "1px solid #e2e8f0",
                    }}
                  />
                  <Legend
                    formatter={(value) => (value === "revenue" ? t("manager.dashboard.charts.legendRevenue") : t("manager.dashboard.charts.legendExpense"))}
                    wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
                  />
                  <Bar dataKey="revenue" name="revenue" fill="#2563eb" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="expense" name="expense" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Camembert Statut du parc immobilier */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col justify-between">
          <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base mb-4">{t("manager.dashboard.charts.statusChart")}</h3>
          {donutData.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 py-16 text-center">{t("manager.dashboard.charts.noProperties")}</p>
          ) : (
            <>
              <div className="h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      nameKey="status"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={4}
                    >
                      {donutData.map((entry) => (
                        <Cell key={entry.status} fill={statusColors[entry.status]} stroke="none" />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: any, _name: any, item: any) => [
                        t("manager.dashboard.charts.propertiesCount", { count: value }),
                        statusLabels[item.payload.status as PropertyStatus],
                      ]}
                      contentStyle={{
                        borderRadius: "12px",
                        fontSize: "12px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap justify-center gap-3 mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                {donutData.map((entry) => (
                  <div key={entry.status} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 font-medium">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: statusColors[entry.status] }}
                    />
                    {statusLabels[entry.status]} ({entry.value})
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
