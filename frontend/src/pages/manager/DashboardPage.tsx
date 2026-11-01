import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Download,
  FileText,
  Gauge,
  RefreshCw,
  TrendingUp,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, apiErrorMessage } from "../../api/client";
import DemarrageAgence from "../../components/DemarrageAgence";
import { COULEURS_STATUT } from "../../components/graphiques/couleurs";
import { GraphiqueParc, GraphiqueRevenusDepenses } from "../../components/graphiques/graphiquesALaDemande";
import SectionReglage from "../../components/SectionReglage";
import { Skeleton, StatCardSkeleton } from "../../components/Skeleton";
import StatCard from "../../components/StatCard";
import { useCurrency } from "../../context/currency";
import type { DashboardStats, PropertyStatus } from "../../types";
import { formatByCurrency } from "../../utils/currencyFormat";
import { fenetreDesMois, libelleDuMois } from "../../utils/moisDuGraphique";
import { actionsATraiter, csvSixMois, resteAEncaisser, syntheseDuMois, type CleAction } from "../../utils/syntheseGestionnaire";

const ETIQUETTE = "font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600";

const RACCOURCIS = [
  { cle: "addProperty", to: "/properties", icone: Building2 },
  { cle: "addTenant", to: "/tenants", icone: Users },
  { cle: "newContract", to: "/contracts", icone: FileText },
  { cle: "invoices", to: "/invoices", icone: Wallet },
  { cle: "expense", to: "/expenses", icone: TrendingUp },
  { cle: "crg", to: "/proprietaires", icone: Gauge },
] as const;

export default function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Rechargement à la demande : les chiffres restent affichés pendant qu'ils se mettent à jour.
  const [actualisation, setActualisation] = useState(false);
  const [misAJour, setMisAJour] = useState<Date | null>(null);
  const [vue, setVue] = useState<"graphique" | "tableau">("graphique");

  const statusLabels: Record<PropertyStatus, string> = {
    AVAILABLE: t("common.status.AVAILABLE"),
    OCCUPIED: t("common.status.OCCUPIED"),
    MAINTENANCE: t("common.status.MAINTENANCE"),
  };

  const charger = useCallback((silencieux = false) => {
    if (silencieux) setActualisation(true);
    else setLoading(true);
    api
      .get<DashboardStats>("/dashboard/stats")
      .then((res) => {
        setStats(res.data);
        setError(null);
        setMisAJour(new Date());
      })
      .catch((err) => {
        setError(apiErrorMessage(err));
      })
      .finally(() => {
        setLoading(false);
        setActualisation(false);
      });
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  if (error) {
    return (
      <div className="border border-rose-200 bg-rose-50 p-6 text-rose-700">
        <h3 className="mb-1 text-base font-bold">{t("manager.dashboard.errorTitle")}</h3>
        <p className="text-sm">{error}</p>
        <button
          onClick={() => charger()}
          className="mt-4 cursor-pointer bg-rose-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-700"
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
          <h2 className="text-2xl font-semibold text-slate-900">{t("manager.dashboard.title")}</h2>
          <p className="mt-1 text-sm text-slate-600">{t("manager.dashboard.loadingHint")}</p>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
        <div className="border border-slate-300 bg-white p-6">
          <Skeleton className="mb-4 h-5 w-56" />
          <Skeleton className="h-[260px] w-full" />
        </div>
      </div>
    );
  }

  const maintenant = new Date();
  const revenueByMonth = stats.revenueByMonth ?? {};
  const expensesByMonth = stats.expensesByMonth ?? {};
  const propertiesByStatus = stats.propertiesByStatus ?? {
    AVAILABLE: 0,
    OCCUPIED: 0,
    MAINTENANCE: 0,
  };

  // Axe des mois : toujours les six derniers (vides compris), voir moisDuGraphique.ts.
  const allMonths = fenetreDesMois(maintenant, [...Object.keys(revenueByMonth), ...Object.keys(expensesByMonth)]);

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
      cle: month,
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

  const actions = actionsATraiter(stats);
  const reste = resteAEncaisser(stats);
  const moisEnCours = syntheseDuMois(stats, maintenant);
  const jour = maintenant.toLocaleDateString(i18n.language, { weekday: "long", day: "numeric", month: "long" });

  function texteAction(cle: CleAction, compte: number): string {
    return cle === "remaining"
      ? t("manager.dashboard.todo.remaining", { amount: formatByCurrency(reste, formatMoney) })
      : t(`manager.dashboard.todo.${cle}`, { count: compte });
  }

  function exporterCsv() {
    const contenu = csvSixMois(
      chartsByCurrency.flatMap(({ currency, data }) => data.map((d) => ({ month: d.cle, currency, revenue: d.revenue, expense: d.expense }))),
      {
        month: t("manager.dashboard.analysisView.month"),
        currency: t("owner.dashboard.currency"),
        revenue: t("manager.dashboard.analysisView.revenue"),
        expense: t("manager.dashboard.analysisView.expense"),
        net: t("manager.dashboard.analysisView.result"),
      }
    );
    const url = URL.createObjectURL(new Blob([contenu], { type: "text/csv;charset=utf-8;" }));
    const lien = document.createElement("a");
    lien.href = url;
    lien.download = `tableau-de-bord-${maintenant.toISOString().split("T")[0]}.csv`;
    lien.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex flex-wrap items-center gap-3 text-2xl font-semibold text-slate-900">
            <span>{t("manager.dashboard.title")}</span>
            <span className="inline-flex items-center gap-1.5 border border-ink-900 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-900">
              <span aria-hidden="true" className="size-1.5 bg-orange-700" />
              {t("manager.dashboard.liveSystem")}
            </span>
          </h2>
          <p className="mt-1 text-sm text-slate-600">{t("manager.dashboard.overviewSubtitle")}</p>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-slate-600">
            {jour}
            {misAJour && ` · ${t("manager.dashboard.updatedAt", { time: misAJour.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" }) })}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => charger(true)}
          disabled={actualisation}
          className="inline-flex cursor-pointer items-center gap-1.5 border border-slate-400 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900 disabled:cursor-wait disabled:opacity-60"
        >
          <RefreshCw size={13} aria-hidden="true" className={actualisation ? "animate-spin motion-reduce:animate-none" : ""} />
          {actualisation ? t("manager.dashboard.refreshing") : t("manager.dashboard.refresh")}
        </button>
      </div>

      <DemarrageAgence
        stats={{ totalProperties: stats.totalProperties ?? 0, totalTenants: stats.totalTenants ?? 0, activeContracts: stats.activeContracts ?? 0 }}
      />

      {/* 01 — Ce qui demande une action aujourd'hui, du plus pressant au moins pressant. */}
      <SectionReglage id="a-traiter" numero="01" titre={t("manager.dashboard.sections.todo")}>
        {actions.length === 0 ? (
          <p className="border-l-2 border-ink-900 pl-3 text-sm text-slate-700">{t("manager.dashboard.todo.allClear")}</p>
        ) : (
          <ul className="divide-y divide-slate-200 border border-slate-300">
            {actions.map((a) => (
              <li key={a.cle} className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${a.urgent ? "shadow-[inset_3px_0_0_var(--color-orange-700)]" : "shadow-[inset_3px_0_0_var(--color-ink-900)]"}`}>
                <div className="flex flex-wrap items-center gap-3">
                  {a.urgent && (
                    <span className="border border-orange-300 bg-orange-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-orange-900">
                      {t("manager.dashboard.todo.urgent")}
                    </span>
                  )}
                  <p className="text-sm font-semibold text-slate-900">{texteAction(a.cle, a.compte)}</p>
                </div>
                <Link to={a.lien} className="group inline-flex items-center gap-1.5 border-b border-ink-900/40 pb-0.5 text-xs font-semibold text-ink-900 hover:border-orange-700 hover:text-orange-700">
                  {t(`manager.dashboard.todo.${a.cle}Cta`)}
                  <ArrowRight size={13} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionReglage>

      {/* 02 — Grille des 8 indicateurs clés */}
      <SectionReglage id="indicateurs" numero="02" titre={t("manager.dashboard.sections.kpis")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
      </SectionReglage>

      {/* 03 — Le mois en cours, devise par devise : encaissé, attendu, dépenses et résultat net. */}
      <SectionReglage id="ce-mois" numero="03" titre={t("manager.dashboard.sections.month")}>
        {moisEnCours.length === 0 ? (
          <p className="text-xs text-slate-600">{t("manager.dashboard.month.noData")}</p>
        ) : (
          <ul className="space-y-6">
            {moisEnCours.map((m) => (
              <li key={m.currency} aria-label={moisEnCours.length > 1 ? m.currency : undefined}>
                {moisEnCours.length > 1 && <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-800">{m.currency}</p>}
                <dl className="grid grid-cols-2 gap-px border border-slate-300 bg-slate-300 lg:grid-cols-5">
                  <div className="bg-white p-4">
                    <dt className={ETIQUETTE}>{t("manager.dashboard.month.collected")}</dt>
                    <dd className="mt-1.5 text-lg font-bold tabular-nums text-ink-900">{formatMoney(m.encaisse, m.currency)}</dd>
                    {m.variation !== null && (
                      <dd className="mt-1 font-mono text-[11px] tabular-nums text-slate-600">{`${m.variation > 0 ? "+" : ""}${m.variation} % ${t("manager.dashboard.month.vsPrevious")}`}</dd>
                    )}
                  </div>
                  <div className="bg-white p-4">
                    <dt className={ETIQUETTE}>{t("manager.dashboard.month.expected")}</dt>
                    <dd className="mt-1.5 text-lg font-bold tabular-nums text-slate-900">{formatMoney(m.attendu, m.currency)}</dd>
                  </div>
                  <div className="bg-white p-4">
                    <dt className={ETIQUETTE}>{t("manager.dashboard.month.remaining")}</dt>
                    <dd className={`mt-1.5 text-lg font-bold tabular-nums ${m.reste > 0 ? "text-orange-700" : "text-slate-500"}`}>{formatMoney(m.reste, m.currency)}</dd>
                  </div>
                  <div className="bg-white p-4">
                    <dt className={ETIQUETTE}>{t("manager.dashboard.month.expenses")}</dt>
                    <dd className="mt-1.5 text-lg font-bold tabular-nums text-slate-900">{formatMoney(m.depenses, m.currency)}</dd>
                  </div>
                  <div className="col-span-2 bg-white p-4 lg:col-span-1">
                    <dt className={ETIQUETTE}>{t("manager.dashboard.month.net")}</dt>
                    <dd className={`mt-1.5 text-lg font-bold tabular-nums ${m.net < 0 ? "text-orange-700" : "text-ink-900"}`}>{formatMoney(m.net, m.currency)}</dd>
                  </div>
                </dl>
                {m.taux !== null && (
                  <div className="mt-3">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-800">{t("manager.dashboard.month.rate", { pct: m.taux })}</p>
                    <div
                      role="progressbar"
                      aria-label={t("manager.dashboard.month.rateLabel", { currency: m.currency })}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.min(100, m.taux)}
                      className="mt-1.5 h-2 bg-slate-200"
                    >
                      <div className="h-full bg-ink-900" style={{ width: `${Math.min(100, m.taux)}%` }} />
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionReglage>

      {/* 04 — Les six derniers mois (graphique ou tableau, avec export) et la répartition du parc. */}
      <SectionReglage id="analyse" numero="04" titre={t("manager.dashboard.sections.analysis")}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h4 className="text-base font-bold text-slate-900">{t("manager.dashboard.charts.revenueVsExpenses")}</h4>
              <div className="flex flex-wrap items-center gap-2">
                <div role="group" aria-label={t("manager.dashboard.analysisView.label")} className="inline-flex border border-slate-400">
                  {(["graphique", "tableau"] as const).map((choix) => (
                    <button
                      key={choix}
                      type="button"
                      aria-pressed={vue === choix}
                      onClick={() => setVue(choix)}
                      className={`cursor-pointer border-r border-slate-400 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider last:border-r-0 ${
                        vue === choix ? "bg-ink-900 text-white" : "bg-white text-slate-800 hover:bg-slate-100"
                      }`}
                    >
                      {t(choix === "graphique" ? "manager.dashboard.analysisView.chart" : "manager.dashboard.analysisView.table")}
                    </button>
                  ))}
                </div>
                {chartsByCurrency.length > 0 && (
                  <button
                    type="button"
                    onClick={exporterCsv}
                    className="inline-flex cursor-pointer items-center gap-1.5 border border-slate-400 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900"
                  >
                    <Download size={13} aria-hidden="true" />
                    {t("manager.dashboard.analysisView.exportCsv")}
                  </button>
                )}
              </div>
            </div>
            {chartsByCurrency.length === 0 ? (
              <p className="py-16 text-center text-sm text-slate-600">{t("manager.dashboard.charts.noRevenueData")}</p>
            ) : (
              <div className="space-y-6">
                {chartsByCurrency.map(({ currency, data }) => (
                  <div
                    key={currency}
                    role={chartsByCurrency.length > 1 ? "group" : undefined}
                    aria-label={chartsByCurrency.length > 1 ? t("manager.dashboard.charts.chartForCurrency", { currency }) : undefined}
                  >
                    {chartsByCurrency.length > 1 && <p className="mb-2 text-xs font-semibold text-slate-600">{currency}</p>}
                    {vue === "graphique" ? (
                      <div className={chartsByCurrency.length > 1 ? "h-[220px] w-full" : "h-[280px] w-full"}>
                        <Suspense fallback={<Skeleton className="h-full w-full" />}>
                          <GraphiqueRevenusDepenses data={data} currency={currency} />
                        </Suspense>
                      </div>
                    ) : (
                      <div className="relative overflow-x-auto border border-slate-300">
                        <table className="w-full text-sm">
                          <caption className="sr-only">{t("manager.dashboard.analysisView.tableFor", { currency })}</caption>
                          <thead>
                            <tr className="text-left">
                              <th scope="col" className="px-4 py-2.5 font-semibold">{t("manager.dashboard.analysisView.month")}</th>
                              <th scope="col" className="px-4 py-2.5 text-right font-semibold">{t("manager.dashboard.analysisView.revenue")}</th>
                              <th scope="col" className="px-4 py-2.5 text-right font-semibold">{t("manager.dashboard.analysisView.expense")}</th>
                              <th scope="col" className="px-4 py-2.5 text-right font-semibold">{t("manager.dashboard.analysisView.result")}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {data.map((d) => (
                              <tr key={d.cle} className="hover:bg-slate-50">
                                <th scope="row" className="px-4 py-2.5 text-left text-xs font-medium capitalize text-slate-700">{d.month}</th>
                                <td className="px-4 py-2.5 text-right font-bold tabular-nums text-ink-900">{formatMoney(d.revenue, currency)}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{formatMoney(d.expense, currency)}</td>
                                <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${d.revenue - d.expense < 0 ? "text-orange-700" : "text-slate-900"}`}>{formatMoney(d.revenue - d.expense, currency)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Répartition du parc par statut */}
          <div className="flex flex-col justify-between border border-slate-300 p-5">
            <h4 className="mb-4 text-base font-bold text-slate-900">{t("manager.dashboard.charts.statusChart")}</h4>
            {donutData.length === 0 ? (
              <p className="py-16 text-center text-sm text-slate-600">{t("manager.dashboard.charts.noProperties")}</p>
            ) : (
              <>
                <div className="relative h-[200px] w-full">
                  <Suspense fallback={<Skeleton className="h-full w-full" />}>
                    <GraphiqueParc data={donutData} libelles={statusLabels} />
                  </Suspense>
                  {/* Total des biens au centre de l'anneau. */}
                  <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-bold leading-none text-slate-900">{donutData.reduce((somme, d) => somme + d.value, 0)}</span>
                    <span className="mt-1.5 font-mono text-[11px] uppercase tracking-wider text-slate-600">{t("manager.dashboard.charts.centerLabel")}</span>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap justify-center gap-3 border-t border-slate-200 pt-4">
                  {donutData.map((entry) => (
                    <div key={entry.status} className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                      <span className="size-3 shrink-0" style={{ backgroundColor: COULEURS_STATUT[entry.status] }} />
                      {statusLabels[entry.status]} ({entry.value})
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </SectionReglage>

      {/* 05 — Les gestes les plus fréquents, à un clic. */}
      <SectionReglage id="acces-rapides" numero="05" titre={t("manager.dashboard.sections.shortcuts")}>
        <ul className="grid grid-cols-1 gap-px border border-slate-300 bg-slate-300 sm:grid-cols-2 lg:grid-cols-3">
          {RACCOURCIS.map(({ cle, to, icone: Icone }) => (
            <li key={cle} className="bg-white">
              <Link to={to} className="group flex items-center justify-between gap-3 px-4 py-3.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-slate-50 hover:text-orange-700">
                <span className="flex items-center gap-3">
                  <Icone size={16} aria-hidden="true" />
                  {t(`manager.dashboard.shortcuts.${cle}`)}
                </span>
                <ArrowRight size={14} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      </SectionReglage>
    </div>
  );
}
