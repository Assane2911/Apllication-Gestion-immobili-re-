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
import { Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../../api/client";
import DemarrageAgence from "../../components/DemarrageAgence";
import { COULEURS_STATUT } from "../../components/graphiques/couleurs";
import { GraphiqueParc, GraphiqueRevenusDepenses } from "../../components/graphiques/graphiquesALaDemande";
import { Skeleton, StatCardSkeleton } from "../../components/Skeleton";
import StatCard from "../../components/StatCard";
import { useCurrency } from "../../context/currency";
import type { DashboardStats, PropertyStatus } from "../../types";
import { formatByCurrency } from "../../utils/currencyFormat";
import { fenetreDesMois, libelleDuMois } from "../../utils/moisDuGraphique";

/** Intitulé de section façon feuille de plan : numéro en police technique, libellé, puis un filet qui court jusqu'au bord. */
function IntituleSection({ numero, libelle }: { numero: string; libelle: string }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="font-mono text-[11px] text-orange-700">{numero}</span>
      <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">{libelle}</h3>
      <div aria-hidden="true" className="h-px flex-1 bg-slate-300" />
    </div>
  );
}

export default function DashboardPage() {
  const { t, i18n } = useTranslation();
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
      <div className="bg-red-50 border border-red-200 text-red-700 p-6 rounded-2xl">
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
          <h2 className="text-2xl font-bold text-slate-900">{t("manager.dashboard.title")}</h2>
          <p className="text-sm text-slate-600 mt-1">{t("manager.dashboard.loadingHint")}</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
        <div className="bg-white rounded-2xl border border-contour-200 p-6 shadow-sm">
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

  // Axe des mois : toujours les six derniers (vides compris), voir moisDuGraphique.ts.
  const allMonths = fenetreDesMois(new Date(), [...Object.keys(revenueByMonth), ...Object.keys(expensesByMonth)]);

  // Plateforme multi-devises : chaque mois est { devise -> montant } côté API
  // (voir dashboard.controller.ts) plutôt qu'un seul nombre déjà additionné à
  // travers des devises différentes. On trace un graphique PAR devise : sur un
  // axe commun, 600 € disparaissaient à côté de 450 000 FCFA, alors que les
  // deux sommes sont du même ordre de grandeur réel. Un gestionnaire
  // mono-devise (le cas courant) voit un seul graphique, comme avant.
  const devisesDesMois = Array.from(
    new Set([
      ...allMonths.flatMap((m) => Object.keys(revenueByMonth[m] ?? {})),
      ...allMonths.flatMap((m) => Object.keys(expensesByMonth[m] ?? {})),
    ])
  ).sort();
  // Aucun mouvement sur la période mais un loyer attendu ce mois-ci : on trace quand même la devise du compte.
  const monthlyCurrencies = devisesDesMois.length > 0 ? devisesDesMois : Object.keys(stats.monthlyRevenueByCurrency ?? {});

  const chartsByCurrency = monthlyCurrencies.map((currency) => ({
    currency,
    data: allMonths.map((month) => ({
      month: libelleDuMois(month, i18n.language),
      revenue: Number(revenueByMonth[month]?.[currency] ?? 0),
      expense: Number(expensesByMonth[month]?.[currency] ?? 0),
    })),
  }));

  // Part du loyer attendu déjà encaissée : seulement quand il n'y a qu'une devise, sinon la division n'a pas de sens.
  const devisesAttendues = Object.keys(stats.monthlyExpectedByCurrency ?? {});
  const partEncaissee =
    devisesAttendues.length === 1 && Number(stats.monthlyExpectedByCurrency[devisesAttendues[0]]) > 0
      ? Math.round((Number(stats.monthlyRevenueByCurrency?.[devisesAttendues[0]] ?? 0) / Number(stats.monthlyExpectedByCurrency[devisesAttendues[0]])) * 100)
      : undefined;

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
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <span>{t("manager.dashboard.title")}</span>
            <span className="text-xs bg-emerald-100 text-emerald-800 font-semibold px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
              <CheckCircle2 size={12} /> {t("manager.dashboard.liveSystem")}
            </span>
          </h2>
          <p className="text-sm text-slate-600 mt-1">{t("manager.dashboard.overviewSubtitle")}</p>
        </div>
      </div>

      <DemarrageAgence
        stats={{ totalProperties: stats.totalProperties ?? 0, totalTenants: stats.totalTenants ?? 0, activeContracts: stats.activeContracts ?? 0 }}
      />

      {/* Grille des 8 indicateurs clés */}
      <IntituleSection numero="01" libelle={t("manager.dashboard.sections.kpis")} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Building2}
          label={t("manager.dashboard.stats.properties")}
          to="/properties"
          value={stats.totalProperties ?? 0}
          hint={t("manager.dashboard.stats.propertiesHint", { count: propertiesByStatus.AVAILABLE ?? 0 })}
          accent="blue"
        />
        <StatCard
          icon={Gauge}
          label={t("manager.dashboard.stats.occupancy")}
          to="/properties"
          progress={stats.occupancyRate ?? 0}
          value={`${stats.occupancyRate ?? 0}%`}
          hint={t("manager.dashboard.stats.occupancyHint", { count: propertiesByStatus.OCCUPIED ?? 0 })}
          accent="green"
        />
        <StatCard
          icon={Users}
          label={t("manager.dashboard.stats.tenants")}
          to="/tenants"
          value={stats.totalTenants ?? 0}
          hint={t("manager.dashboard.stats.tenantsHint")}
          accent="blue"
        />
        <StatCard
          icon={FileText}
          label={t("manager.dashboard.stats.contracts")}
          to="/contracts"
          value={stats.activeContracts ?? 0}
          hint={t("manager.dashboard.stats.contractsHint")}
          accent="blue"
        />
        <StatCard
          icon={Wallet}
          label={t("manager.dashboard.stats.revenue")}
          to="/invoices"
          value={formatByCurrency(stats.monthlyRevenueByCurrency, formatMoney)}
          progress={partEncaissee}
          hint={t("manager.dashboard.stats.revenueHint", { amount: formatByCurrency(stats.monthlyExpectedByCurrency, formatMoney) })}
          accent="green"
        />
        <StatCard
          icon={AlertTriangle}
          label={t("manager.dashboard.stats.lateInvoices")}
          to="/invoices"
          value={stats.lateInvoices ?? 0}
          hint={stats.lateInvoices > 0 ? t("manager.dashboard.stats.lateInvoicesHintYes") : t("manager.dashboard.stats.lateInvoicesHintNo")}
          accent={stats.lateInvoices > 0 ? "red" : "green"}
        />
        <StatCard
          icon={Wrench}
          label={t("manager.dashboard.stats.openIssues")}
          to="/issues"
          value={stats.openIssues ?? 0}
          hint={stats.openIssues > 0 ? t("manager.dashboard.stats.openIssuesHintYes") : t("manager.dashboard.stats.openIssuesHintNo")}
          accent={stats.openIssues > 0 ? "amber" : "green"}
        />
        <StatCard
          icon={TrendingUp}
          label={t("manager.dashboard.stats.maintenance")}
          to="/properties"
          value={propertiesByStatus.MAINTENANCE ?? 0}
          hint={t("manager.dashboard.stats.maintenanceHint")}
          accent="amber"
        />
      </div>

      {/* Graphiques */}
      <IntituleSection numero="02" libelle={t("manager.dashboard.sections.analysis")} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Graphique Barres Comparatif Revenus vs Dépenses */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-contour-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-900 text-base">{t("manager.dashboard.charts.revenueVsExpenses")}</h3>
          </div>
          {chartsByCurrency.length === 0 ? (
            <p className="text-sm text-slate-600 py-16 text-center">
              {t("manager.dashboard.charts.noRevenueData")}
            </p>
          ) : (
            <div className="space-y-6">
              {chartsByCurrency.map(({ currency, data }) => (
                <div
                  key={currency}
                  role={chartsByCurrency.length > 1 ? "group" : undefined}
                  aria-label={chartsByCurrency.length > 1 ? t("manager.dashboard.charts.chartForCurrency", { currency }) : undefined}
                >
                  {chartsByCurrency.length > 1 && (
                    <p className="text-xs font-semibold text-slate-600 mb-2">{currency}</p>
                  )}
                  <div className={chartsByCurrency.length > 1 ? "h-[220px] w-full" : "h-[280px] w-full"}>
                    <Suspense fallback={<Skeleton className="h-full w-full" />}>
                      <GraphiqueRevenusDepenses data={data} currency={currency} />
                    </Suspense>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Camembert Statut du parc immobilier */}
        <div className="bg-white rounded-2xl border border-contour-200 p-6 shadow-sm flex flex-col justify-between">
          <h3 className="font-bold text-slate-900 text-base mb-4">{t("manager.dashboard.charts.statusChart")}</h3>
          {donutData.length === 0 ? (
            <p className="text-sm text-slate-600 py-16 text-center">{t("manager.dashboard.charts.noProperties")}</p>
          ) : (
            <>
              <div className="relative h-[200px] w-full">
                <Suspense fallback={<Skeleton className="h-full w-full rounded-full" />}>
                  <GraphiqueParc data={donutData} libelles={statusLabels} />
                </Suspense>
                {/* Total des biens au centre de l'anneau. */}
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold leading-none text-slate-900">{donutData.reduce((somme, d) => somme + d.value, 0)}</span>
                  <span className="mt-1.5 font-mono text-[11px] uppercase tracking-wider text-slate-600">{t("manager.dashboard.charts.centerLabel")}</span>
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-3 mt-4 pt-4 border-t border-contour-100">
                {donutData.map((entry) => (
                  <div key={entry.status} className="flex items-center gap-1.5 text-xs text-slate-600 font-medium">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: COULEURS_STATUT[entry.status] }}
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
