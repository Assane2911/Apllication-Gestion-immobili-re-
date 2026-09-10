import { AlertTriangle, Building2, Clock3, CreditCard, FileText, Users, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../../api/client";
import EmptyState from "../../components/EmptyState";
import { Skeleton, StatCardSkeleton } from "../../components/Skeleton";
import StatCard from "../../components/StatCard";
import type { AdminDashboardStats } from "../../types";

/** Les abonnements SaaS de la plateforme sont toujours facturés en euros
 * (voir SUBSCRIPTION_PLANS côté backend) — on formate donc le MRR avec un
 * format numérique fixe (comme formatMoney dans CurrencyContext), indépendant
 * de la langue d'affichage de l'admin. */
function formatEuros(amount: number): string {
  return `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount)} €`;
}

const PLAN_ORDER = ["STARTER", "PRO", "ENTERPRISE"] as const;

export default function AdminDashboardPage() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    setError(null);
    api
      .get<AdminDashboardStats>("/admin/dashboard/stats")
      .then((res) => setStats(res.data))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 p-6 rounded-2xl">
        <h3 className="font-bold text-base mb-1">{t("admin.dashboard.errorTitle")}</h3>
        <p className="text-sm">{error}</p>
        <button
          onClick={load}
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
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72 mt-2" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  const { managers, trialsEndingSoon, mrr, usage } = stats;
  const maxPlanMrr = Math.max(1, ...PLAN_ORDER.map((plan) => mrr.byPlan[plan] ?? 0));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{t("admin.dashboard.title")}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("admin.dashboard.subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          icon={Users}
          label={t("admin.dashboard.stats.managers")}
          value={managers.total}
          hint={t("admin.dashboard.stats.managersHint", { trial: managers.trialActive, expired: managers.expired })}
          accent="blue"
        />
        <StatCard
          icon={CreditCard}
          label={t("admin.dashboard.stats.subscriptionActive")}
          value={managers.subscriptionActive}
          hint={t("admin.dashboard.stats.subscriptionActiveHint", { total: managers.total })}
          accent="green"
        />
        <StatCard
          icon={Wallet}
          label={t("admin.dashboard.stats.mrr")}
          value={formatEuros(mrr.total)}
          hint={t("admin.dashboard.stats.mrrHint", { count: mrr.contributors })}
          accent="green"
        />
        <StatCard
          icon={Building2}
          label={t("admin.dashboard.stats.properties")}
          value={usage.totalProperties}
          hint={t("admin.dashboard.stats.propertiesHint")}
          accent="blue"
        />
        <StatCard
          icon={Users}
          label={t("admin.dashboard.stats.tenants")}
          value={usage.totalTenants}
          hint={t("admin.dashboard.stats.tenantsHint")}
          accent="blue"
        />
        <StatCard
          icon={FileText}
          label={t("admin.dashboard.stats.activeContracts")}
          value={usage.activeContracts}
          hint={t("admin.dashboard.stats.activeContractsHint")}
          accent="blue"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
          <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base mb-4">{t("admin.dashboard.mrrByPlan.title")}</h3>
          {mrr.contributors === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 py-10 text-center">{t("admin.dashboard.mrrByPlan.empty")}</p>
          ) : (
            <div className="space-y-4">
              {PLAN_ORDER.map((plan) => {
                const amount = mrr.byPlan[plan] ?? 0;
                const widthPct = Math.round((amount / maxPlanMrr) * 100);
                return (
                  <div key={plan}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">{plan}</span>
                      <span className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        {formatEuros(amount)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-brand-600"
                        style={{ width: amount > 0 ? `${Math.max(widthPct, 4)}%` : "0%" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">{t("admin.dashboard.trialsEndingSoon.title")}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t("admin.dashboard.trialsEndingSoon.subtitle")}</p>
          </div>
          {trialsEndingSoon.length === 0 ? (
            <EmptyState icon={Clock3} title={t("admin.dashboard.trialsEndingSoon.empty")} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 uppercase text-[10px]">
                    <th className="py-2.5">{t("admin.dashboard.trialsEndingSoon.manager")}</th>
                    <th className="py-2.5 text-right" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {trialsEndingSoon.map((trial) => (
                    <tr key={trial.userId} className="text-slate-700 dark:text-slate-300">
                      <td className="py-3">
                        <p className="font-semibold">{trial.agencyName ?? t("admin.dashboard.trialsEndingSoon.noAgencyName")}</p>
                        <p className="text-slate-500 dark:text-slate-400">{trial.email}</p>
                      </td>
                      <td className="py-3 text-right">
                        <span
                          className={`inline-flex items-center gap-1 font-semibold px-2.5 py-1 rounded-full ${
                            trial.daysRemaining === 0
                              ? "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300"
                              : "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          }`}
                        >
                          <AlertTriangle size={12} />
                          {trial.daysRemaining === 0
                            ? t("admin.dashboard.trialsEndingSoon.lastDay")
                            : t("admin.dashboard.trialsEndingSoon.daysLeft", { count: trial.daysRemaining })}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
