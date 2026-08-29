import { AlertTriangle, Building2, FileText, Gauge, Users, Wallet, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
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

const statusLabels: Record<PropertyStatus, string> = {
  AVAILABLE: "Disponible",
  OCCUPIED: "Occupé",
  MAINTENANCE: "Maintenance",
};

export default function DashboardPage() {
  const { formatMoney } = useCurrency();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<DashboardStats>("/dashboard/stats")
      .then((res) => setStats(res.data))
      .catch((err) => setError(apiErrorMessage(err)));
  }, []);

  if (error) return <p className="text-red-600 text-sm">{error}</p>;

  if (!stats) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Tableau de bord</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Vue d'ensemble de votre parc immobilier</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
          <Skeleton className="h-4 w-56 mb-4" />
          <Skeleton className="h-[260px] w-full" />
        </div>
      </div>
    );
  }

  // Combine revenus et dépenses par mois (union des clés) pour le graphique comparatif.
  const allMonths = Array.from(
    new Set([...Object.keys(stats.revenueByMonth), ...Object.keys(stats.expensesByMonth)])
  ).sort((a, b) => a.localeCompare(b));
  const comparisonChartData = allMonths.map((month) => ({
    month,
    revenue: stats.revenueByMonth[month] ?? 0,
    expense: stats.expensesByMonth[month] ?? 0,
  }));

  const donutData = (Object.keys(statusLabels) as PropertyStatus[])
    .map((status) => ({ status, value: stats.propertiesByStatus[status] ?? 0 }))
    .filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold bg-gradient-to-r from-slate-900 to-brand-700 dark:from-white dark:to-brand-400 bg-clip-text text-transparent">
          Tableau de bord
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Vue d'ensemble de votre parc immobilier</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Building2}
          label="Biens immobiliers"
          value={stats.totalProperties}
          hint={`${stats.propertiesByStatus.AVAILABLE} disponible(s)`}
        />
        <StatCard icon={Gauge} label="Taux d'occupation" value={`${stats.occupancyRate}%`} accent="green" />
        <StatCard icon={Users} label="Locataires" value={stats.totalTenants} accent="blue" />
        <StatCard icon={FileText} label="Contrats actifs" value={stats.activeContracts} accent="blue" />
        <StatCard
          icon={Wallet}
          label="Revenus du mois"
          value={formatMoney(stats.monthlyRevenue)}
          hint={`Attendu : ${formatMoney(stats.monthlyExpected)}`}
          accent="green"
        />
        <StatCard icon={AlertTriangle} label="Factures en retard" value={stats.lateInvoices} accent="red" />
        <StatCard icon={Wrench} label="Incidents ouverts" value={stats.openIssues} accent="amber" />
        <StatCard
          icon={Building2}
          label="Biens en maintenance"
          value={stats.propertiesByStatus.MAINTENANCE}
          accent="amber"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
          <h3 className="font-medium text-slate-900 dark:text-slate-100 mb-4">
            Revenus vs Dépenses (6 derniers mois)
          </h3>
          {comparisonChartData.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">
              Pas encore de paiements ou de dépenses enregistrés sur cette période.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={comparisonChartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: "currentColor" }} className="text-slate-500 dark:text-slate-400" />
                <YAxis tick={{ fontSize: 12, fill: "currentColor" }} className="text-slate-500 dark:text-slate-400" />
                <Tooltip
                  formatter={(value: number, name) => [formatMoney(Number(value)), name === "revenue" ? "Revenus" : "Dépenses"]}
                  contentStyle={{ borderRadius: 8, fontSize: 12 }}
                />
                <Legend
                  formatter={(value) => (value === "revenue" ? "Revenus" : "Dépenses")}
                  wrapperStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="revenue" name="revenue" fill="#2563eb" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expense" name="expense" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
          <h3 className="font-medium text-slate-900 dark:text-slate-100 mb-4">Statut du parc immobilier</h3>
          {donutData.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">Aucun bien enregistré pour l'instant.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={donutData}
                    dataKey="value"
                    nameKey="status"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={3}
                  >
                    {donutData.map((entry) => (
                      <Cell key={entry.status} fill={statusColors[entry.status]} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number, _name, item) => [value, statusLabels[item.payload.status as PropertyStatus]]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap justify-center gap-3 mt-2">
                {donutData.map((entry) => (
                  <div key={entry.status} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: statusColors[entry.status] }} />
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
