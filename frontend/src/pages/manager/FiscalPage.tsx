import { BookText, FileSpreadsheet, Landmark, Scale, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../../api/client";
import { GraphiqueComparaisonFiscale } from "../../components/graphiques/graphiquesALaDemande";
import { Skeleton, StatCardSkeleton } from "../../components/Skeleton";
import StatCard from "../../components/StatCard";
import { useCurrency } from "../../context/currency";
import type { AnnualFiscalSynthesis, ExpenseCategory } from "../../types";
import { devisesPresentes, formatByCurrency, formatDeduction } from "../../utils/currencyFormat";
import { moisCourt } from "../../utils/moisDuGraphique";
import Bulle from "../../components/Bulle";
import { NomDuBien } from "../../components/PlanLogement";

// Couleurs de la charte (celles des étiquettes de la page Dépenses) : orange d'annotation, rose, bleu de plan, vert, gris-bleu.
const categoryDotColors: Record<ExpenseCategory, string> = {
  MAINTENANCE: "#d9480f",
  TAX: "#be123c",
  INSURANCE: "#124a73",
  SYNDIC: "#2b8a6e",
  OTHER: "#8ca0aa",
};

/** Vrai si le résultat net est positif ou nul dans TOUTES les devises. */
function allPositive(byCurrency: Record<string, number>): boolean {
  const values = Object.values(byCurrency);
  return values.length === 0 || values.every((amount) => amount >= 0);
}

/** Intitulé de section façon feuille de plan (comme le tableau de bord) : numéro, libellé, filet jusqu'au bord. */
function IntituleSection({ numero, libelle }: { numero: string; libelle: string }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="font-mono text-[11px] text-orange-700">{numero}</span>
      <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">{libelle}</h3>
      <div aria-hidden="true" className="h-px flex-1 bg-slate-300" />
    </div>
  );
}

export default function FiscalPage() {
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [synthesis, setSynthesis] = useState<AnnualFiscalSynthesis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadingFEC, setDownloadingFEC] = useState(false);
  const [downloadingSyscohada, setDownloadingSyscohada] = useState(false);

  const categoryLabels: Record<ExpenseCategory, string> = {
    MAINTENANCE: t("manager.expenses.categories.MAINTENANCE"),
    TAX: t("manager.expenses.categories.TAX"),
    INSURANCE: t("manager.expenses.categories.INSURANCE"),
    SYNDIC: t("manager.expenses.categories.SYNDIC"),
    OTHER: t("manager.expenses.categories.OTHER"),
  };

  const loadData = useCallback((selectedYear: number) => {
    setLoading(true);
    api
      .get<AnnualFiscalSynthesis>("/fiscal/synthese", { params: { year: selectedYear } })
      .then((res) => {
        setSynthesis(res.data);
        setError(null);
      })
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadData(year);
  }, [loadData, year]);

  async function downloadGrandLivre() {
    setDownloading(true);
    try {
      const res = await api.get(`/fiscal/grand-livre`, { params: { year }, responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `grand-livre-${year}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(apiErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  async function downloadFEC() {
    setDownloadingFEC(true);
    try {
      const res = await api.get(`/fiscal/fec`, { params: { year }, responseType: "blob" });
      // Le nom de fichier réglementaire (SIREN + "FEC" + date de clôture) est
      // décidé par le serveur (voir exportFEC, fiscal.controller.ts) : un nom
      // générique ici romprait la convention attendue par un contrôleur.
      const disposition = res.headers?.["content-disposition"] as string | undefined;
      const filename = disposition?.match(/filename="([^"]+)"/)?.[1] ?? `fec-${year}.txt`;
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(apiErrorMessage(err));
    } finally {
      setDownloadingFEC(false);
    }
  }

  async function downloadSyscohada() {
    setDownloadingSyscohada(true);
    try {
      const res = await api.get(`/fiscal/syscohada`, { params: { year }, responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `syscohada-${year}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(apiErrorMessage(err));
    } finally {
      setDownloadingSyscohada(false);
    }
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 p-6 rounded-2xl">
        <h3 className="font-bold text-base mb-1">{t("manager.fiscal.errorTitle")}</h3>
        <p className="text-sm">{error}</p>
        <button
          onClick={() => loadData(year)}
          className="mt-4 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-4 py-2 rounded-xl"
        >
          {t("common.actions.retry")}
        </button>
      </div>
    );
  }

  if (loading || !synthesis) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{t("manager.fiscal.title")}</h2>
          <p className="text-sm text-slate-600 mt-1">{t("manager.fiscal.subtitle")}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
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

  const allMonths = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);

  const monthlyCurrencies = Array.from(
    new Set([
      ...allMonths.flatMap((m) => Object.keys(synthesis.revenueByMonth[m] ?? {})),
      ...allMonths.flatMap((m) => Object.keys(synthesis.expensesByMonth[m] ?? {})),
    ])
  ).sort();

  const hasMonthlyData = monthlyCurrencies.length > 0;

  const monthLabel = (m: string) => {
    const [, mm] = m.split("-");
    return moisCourt(year, Number(mm), i18n.language);
  };

  const comparisonChartData = allMonths.map((month) => {
    const row: Record<string, string | number> = { month: monthLabel(month) };
    for (const currency of monthlyCurrencies) {
      row[`revenue_${currency}`] = Number(synthesis.revenueByMonth[month]?.[currency] ?? 0);
      row[`expense_${currency}`] = Number(synthesis.expensesByMonth[month]?.[currency] ?? 0);
    }
    return row;
  });

  const categoryEntries = Object.entries(synthesis.expensesByCategory) as [ExpenseCategory, Record<string, number>][];

  // Même raison que sur l'écran des dépenses : les trois totaux d'un même
  // bilan doivent s'exprimer dans les mêmes monnaies.
  const devisesDeLEcran = synthesis
    ? devisesPresentes(synthesis.totalRevenueByCurrency, synthesis.totalExpensesByCurrency, synthesis.netResultByCurrency)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{t("manager.fiscal.title")}</h2>
          <p className="text-sm text-slate-600 mt-1">{t("manager.fiscal.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label htmlFor="fiscal-year-select" className="font-mono text-[11px] uppercase tracking-wider font-semibold text-slate-700">
            {t("manager.fiscal.yearLabel")}
          </label>
          <select
            id="fiscal-year-select"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="text-xs border border-slate-300 rounded-lg px-3 py-1.5 bg-slate-50 text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-brand-500"
          >
            {synthesis.availableYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <Bulle texte={t("manager.tips.fiscalGrandLivre")}>
          <button
            onClick={downloadGrandLivre}
            disabled={downloading}
            className="bg-ink-900 hover:bg-brand-600 disabled:opacity-60 text-white text-xs font-semibold px-3.5 py-2.5 border border-ink-900 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <BookText size={13} aria-hidden="true" /> {downloading ? t("manager.fiscal.downloadingGrandLivre") : t("manager.fiscal.downloadGrandLivre")}
          </button>
          </Bulle>
          <Bulle texte={t("manager.tips.fiscalFEC")}>
          <button
            onClick={downloadFEC}
            disabled={downloadingFEC}
            className="border border-slate-400 bg-white text-slate-800 hover:border-ink-900 hover:bg-slate-100 disabled:opacity-60 text-xs font-semibold px-3.5 py-2.5 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <FileSpreadsheet size={13} aria-hidden="true" /> {downloadingFEC ? t("manager.fiscal.downloadingFEC") : t("manager.fiscal.downloadFEC")}
          </button>
          </Bulle>
          <Bulle texte={t("manager.tips.fiscalSyscohada")}>
          <button
            onClick={downloadSyscohada}
            disabled={downloadingSyscohada}
            className="border border-slate-400 bg-white text-slate-800 hover:border-ink-900 hover:bg-slate-100 disabled:opacity-60 text-xs font-semibold px-3.5 py-2.5 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Scale size={13} aria-hidden="true" /> {downloadingSyscohada ? t("manager.fiscal.downloadingSyscohada") : t("manager.fiscal.downloadSyscohada")}
          </button>
          </Bulle>
        </div>
      </div>

      <IntituleSection numero="01" libelle={t("manager.fiscal.sections.summary")} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={Wallet}
          label={t("manager.fiscal.stats.totalRevenue")}
          value={formatByCurrency(synthesis.totalRevenueByCurrency, formatMoney, devisesDeLEcran)}
          hint={t("manager.fiscal.stats.totalRevenueHint", { year })}
          accent="green"
        />
        <StatCard
          icon={TrendingDown}
          label={t("manager.fiscal.stats.totalExpenses")}
          value={formatByCurrency(synthesis.totalExpensesByCurrency, formatMoney, devisesDeLEcran)}
          hint={t("manager.fiscal.stats.totalExpensesHint")}
          accent="red"
        />
        <StatCard
          icon={TrendingUp}
          label={t("manager.fiscal.stats.netResult")}
          value={formatByCurrency(synthesis.netResultByCurrency, formatMoney, devisesDeLEcran)}
          hint={allPositive(synthesis.netResultByCurrency) ? t("manager.fiscal.stats.netResultPositive") : t("manager.fiscal.stats.netResultNegative")}
          accent={allPositive(synthesis.netResultByCurrency) ? "green" : "red"}
        />
      </div>

      <IntituleSection numero="02" libelle={t("manager.fiscal.sections.analysis")} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-contour-200 p-6 shadow-sm">
          <h3 className="font-bold text-slate-900 text-base mb-4">
            {t("manager.fiscal.charts.revenueVsExpenses", { year })}
          </h3>
          {!hasMonthlyData ? (
            <p className="text-sm text-slate-600 py-16 text-center">{t("manager.fiscal.charts.noData")}</p>
          ) : (
            <div className="h-[280px] w-full">
              <Suspense fallback={<Skeleton className="h-full w-full" />}>
                <GraphiqueComparaisonFiscale data={comparisonChartData} devises={monthlyCurrencies} />
              </Suspense>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-contour-200 p-6 shadow-sm">
          <h3 className="font-bold text-slate-900 text-base mb-4">{t("manager.fiscal.charts.categoryBreakdown")}</h3>
          {categoryEntries.length === 0 ? (
            <p className="text-sm text-slate-600 py-16 text-center">{t("manager.fiscal.charts.noCategoryData")}</p>
          ) : (
            <ul className="space-y-4">
              {categoryEntries.map(([category, byCurrency]) => {
                // Part de la catégorie dans le total, seulement quand toutes les dépenses sont dans la même devise.
                const devisesUtilisees = new Set(categoryEntries.flatMap(([, montants]) => Object.keys(montants)));
                const devise = devisesUtilisees.size === 1 ? [...devisesUtilisees][0] : null;
                const total = devise ? categoryEntries.reduce((somme, [, montants]) => somme + Number(montants[devise] ?? 0), 0) : 0;
                const part = devise && total > 0 ? Math.round((Number(byCurrency[devise] ?? 0) / total) * 100) : null;
                return (
                  <li key={category}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-sm text-slate-700">
                        <span className="w-2.5 h-2.5 shrink-0" style={{ backgroundColor: categoryDotColors[category] }} />
                        {categoryLabels[category] ?? category}
                      </span>
                      <span className="text-sm font-semibold text-slate-900 tabular-nums">
                        {formatByCurrency(byCurrency, formatMoney)}
                      </span>
                    </div>
                    {part !== null && (
                      <div className="mt-1.5 flex items-center gap-2" aria-hidden="true">
                        <div className="h-1.5 flex-1 bg-slate-200">
                          <div className="h-full" style={{ width: `${part}%`, backgroundColor: categoryDotColors[category] }} />
                        </div>
                        <span className="w-9 text-right font-mono text-[10px] text-slate-600">{part} %</span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <IntituleSection numero="03" libelle={t("manager.fiscal.sections.perProperty")} />
      <div className="bg-white rounded-xl border border-contour-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-contour-100 flex items-center gap-2">
          <Landmark size={16} className="text-slate-600" />
          <div>
            <h3 className="font-bold text-slate-900 text-sm">{t("manager.fiscal.bilanParBien.title")}</h3>
            <p className="text-xs text-slate-600">{t("manager.fiscal.bilanParBien.subtitle")}</p>
          </div>
        </div>
        {/* Zone défilante : focalisable au clavier pour qu'on puisse la faire défiler sans souris. */}
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("manager.fiscal.bilanParBien.title")}>
          <table className="w-full text-sm">
            <thead className="bg-slate-200/70 text-slate-700 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">{t("manager.fiscal.bilanParBien.table.property")}</th>
                <th className="px-4 py-3 font-semibold">{t("manager.fiscal.bilanParBien.table.currency")}</th>
                <th className="px-4 py-3 font-semibold">{t("manager.fiscal.bilanParBien.table.revenue")}</th>
                <th className="px-4 py-3 font-semibold">{t("manager.fiscal.bilanParBien.table.expense")}</th>
                <th className="px-4 py-3 font-semibold">{t("manager.fiscal.bilanParBien.table.net")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-contour-100">
              {synthesis.bilanParBien.map((row) => (
                <tr key={`${row.propertyId}-${row.currency}`} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-900"><NomDuBien titre={row.propertyTitle} id={row.propertyId} /></td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{row.currency}</td>
                  <td className="px-4 py-3 text-emerald-700 font-semibold tabular-nums">
                    {formatMoney(row.revenue, row.currency)}
                  </td>
                  <td className="px-4 py-3 text-red-600 font-semibold tabular-nums">
                    {formatDeduction(row.expense, row.currency, formatMoney)}
                  </td>
                  <td
                    className={`px-4 py-3 font-bold tabular-nums ${row.net >= 0 ? "text-emerald-700" : "text-red-700"}`}
                  >
                    {formatMoney(row.net, row.currency)}
                  </td>
                </tr>
              ))}
              {synthesis.bilanParBien.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-slate-600 py-8 text-sm">
                    {t("manager.fiscal.bilanParBien.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
