import { AlertTriangle, Building2, FileText, Gauge, Users, Wallet, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, apiErrorMessage } from "../../api/client";
import { Skeleton, StatCardSkeleton } from "../../components/Skeleton";
import StatCard from "../../components/StatCard";
import { useCurrency } from "../../context/CurrencyContext";
import type { DashboardStats } from "../../types";

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
          <h2 className="text-2xl font-semibold text-slate-900">Tableau de bord</h2>
          <p className="text-sm text-slate-500 mt-1">Vue d'ensemble de votre parc immobilier</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <Skeleton className="h-4 w-56 mb-4" />
          <Skeleton className="h-[260px] w-full" />
        </div>
      </div>
    );
  }

  const chartData = Object.entries(stats.revenueByMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, revenue]) => ({ month, revenue }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Tableau de bord</h2>
        <p className="text-sm text-slate-500 mt-1">Vue d'ensemble de votre parc immobilier</p>
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

      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h3 className="font-medium text-slate-900 mb-4">Revenus encaissés (6 derniers mois)</h3>
        {chartData.length === 0 ? (
          <p className="text-sm text-slate-400">Pas encore de paiements enregistrés sur cette période.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value) => formatMoney(Number(value))} />
              <Bar dataKey="revenue" fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
