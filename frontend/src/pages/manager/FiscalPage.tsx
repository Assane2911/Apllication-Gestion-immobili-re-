import { Landmark, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, apiErrorMessage } from "../../api/client";
import { Skeleton, StatCardSkeleton } from "../../components/Skeleton";
import StatCard from "../../components/StatCard";
import { useCurrency } from "../../context/currency";
import type { AnnualFiscalSynthesis, ExpenseCategory } from "../../types";
import { formatByCurrency } from "../../utils/currencyFormat";

// Mêmes couleurs que DashboardPage.tsx (revenus/dépenses par mois), pour que
// le module Bilan Fiscal reste visuellement cohérent avec le tableau de bord.
const REVENUE_COLORS = ["#2563eb", "#0891b2", "#7c3aed", "#be185d"];
const EXPENSE_COLORS = ["#f59e0b", "#ea580c", "#65a30d", "#a16207"];

const categoryDotColors: Record<ExpenseCategory, string> = {
  MAINTENANCE: "#f59e0b",
  TAX: "#dc2626",
  INSURANCE: "#2563eb",
  SYNDIC: "#7c3aed",
  OTHER: "#64748b",
};

/** Vrai si le résultat net est positif ou nul dans TOUTES les devises. */
function allPositive(byCurrency: Record<string, number>): boolean {
  const values = Object.values(byCurrency);
  return values.length === 0 || values.every((amount) => amount >= 0);
}

export default function FiscalPage() {
  const { t } = useTranslation();
  const { formatMoney } = useCurrency();
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [synthesis, setSynthesis] = useState<AnnualFiscalSynthesis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

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

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 p-6 rounded-2xl">
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
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{t("manager.fiscal.title")}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("manager.fiscal.subtitle")}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
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
    return new Date(year, Number(mm) - 1, 1).toLocaleDateString(undefined, { month: "short" });
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{t("manager.fiscal.title")}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("manager.fiscal.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="fiscal-year-select" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            {t("manager.fiscal.yearLabel")}
          </label>
          <select
            id="fiscal-year-select"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {synthesis.availableYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button
            onClick={downloadGrandLivre}
            disabled={downloading}
            className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-xs font-semibold px-3.5 py-2.5 rounded-lg shadow-sm flex items-center gap-1.5 transition-colors"
          >
            <span>📒</span> {downloading ? t("manager.fiscal.downloadingGrandLivre") : t("manager.fiscal.downloadGrandLivre")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={Wallet}
          label={t("manager.fiscal.stats.totalRevenue")}
          value={formatByCurrency(synthesis.totalRevenueByCurrency, formatMoney)}
          hint={t("manager.fiscal.stats.totalRevenueHint", { year })}
          accent="green"
        />
        <StatCard
          icon={TrendingDown}
          label={t("manager.fiscal.stats.totalExpenses")}
          value={formatByCurrency(synthesis.totalExpensesByCurrency, formatMoney)}
          hint={t("manager.fiscal.stats.totalExpensesHint")}
          accent="red"
        />
        <StatCard
          icon={TrendingUp}
          label={t("manager.fiscal.stats.netResult")}
          value={formatByCurrency(synthesis.netResultByCurrency, formatMoney)}
          hint={allPositive(synthesis.netResultByCurrency) ? t("manager.fiscal.stats.netResultPositive") : t("manager.fiscal.stats.netResultNegative")}
          accent={allPositive(synthesis.netResultByCurrency) ? "green" : "red"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
          <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base mb-4">
            {t("manager.fiscal.charts.revenueVsExpenses", { year })}
          </h3>
          {!hasMonthlyData ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 py-16 text-center">{t("manager.fiscal.charts.noData")}</p>
          ) : (
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparisonChartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-slate-100 dark:stroke-slate-700" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: "currentColor" }} className="text-slate-500 dark:text-slate-400" />
                  <YAxis tick={{ fontSize: 12, fill: "currentColor" }} className="text-slate-500 dark:text-slate-400" />
                  <Tooltip
                    formatter={(value: number | string, name: string) => {
                      const [kind, currency] = String(name).split("_");
                      const label = kind === "revenue" ? t("manager.fiscal.charts.tooltipRevenue") : t("manager.fiscal.charts.tooltipExpense");
                      return [formatMoney(Number(value), currency), monthlyCurrencies.length > 1 ? `${label} (${currency})` : label];
                    }}
                    contentStyle={{
                      borderRadius: "14px",
                      fontSize: "12px",
                      boxShadow: "0 10px 25px -5px rgba(0,0,0,0.15)",
                      backgroundColor: "#0f172a",
                      color: "#f8fafc",
                      border: "1px solid rgba(255,255,255,0.1)",
                      padding: "10px 14px",
                    }}
                    itemStyle={{ color: "#f8fafc" }}
                  />
                  <Legend
                    formatter={(value) => {
                      const [kind, currency] = String(value).split("_");
                      const label = kind === "revenue" ? t("manager.fiscal.charts.legendRevenue") : t("manager.fiscal.charts.legendExpense");
                      return monthlyCurrencies.length > 1 ? `${label} (${currency})` : label;
                    }}
                    wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
                  />
                  {monthlyCurrencies.map((currency, idx) => (
                    <Fragment key={currency}>
                      <Bar
                        dataKey={`revenue_${currency}`}
                        name={`revenue_${currency}`}
                        fill={REVENUE_COLORS[idx % REVENUE_COLORS.length]}
                        radius={[6, 6, 0, 0]}
                      />
                      <Bar
                        dataKey={`expense_${currency}`}
                        name={`expense_${currency}`}
                        fill={EXPENSE_COLORS[idx % EXPENSE_COLORS.length]}
                        radius={[6, 6, 0, 0]}
                      />
                    </Fragment>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
          <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base mb-4">{t("manager.fiscal.charts.categoryBreakdown")}</h3>
          {categoryEntries.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 py-16 text-center">{t("manager.fiscal.charts.noCategoryData")}</p>
          ) : (
            <ul className="space-y-3">
              {categoryEntries.map(([category, byCurrency]) => (
                <li key={category} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: categoryDotColors[category] }} />
                    {categoryLabels[category] ?? category}
                  </span>
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                    {formatByCurrency(byCurrency, formatMoney)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <Landmark size={16} className="text-slate-400 dark:text-slate-500" />
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">{t("manager.fiscal.bilanParBien.title")}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t("manager.fiscal.bilanParBien.subtitle")}</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">{t("manager.fiscal.bilanParBien.table.property")}</th>
                <th className="px-4 py-3 font-medium">{t("manager.fiscal.bilanParBien.table.currency")}</th>
                <th className="px-4 py-3 font-medium">{t("manager.fiscal.bilanParBien.table.revenue")}</th>
                <th className="px-4 py-3 font-medium">{t("manager.fiscal.bilanParBien.table.expense")}</th>
                <th className="px-4 py-3 font-medium">{t("manager.fiscal.bilanParBien.table.net")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {synthesis.bilanParBien.map((row) => (
                <tr key={`${row.propertyId}-${row.currency}`} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{row.propertyTitle}</td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs">{row.currency}</td>
                  <td className="px-4 py-3 text-emerald-600 dark:text-emerald-400 font-semibold tabular-nums">
                    {formatMoney(row.revenue, row.currency)}
                  </td>
                  <td className="px-4 py-3 text-red-600 dark:text-red-400 font-semibold tabular-nums">
                    -{formatMoney(row.expense, row.currency)}
                  </td>
                  <td
                    className={`px-4 py-3 font-bold tabular-nums ${row.net >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}
                  >
                    {formatMoney(row.net, row.currency)}
                  </td>
                </tr>
              ))}
              {synthesis.bilanParBien.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-slate-400 dark:text-slate-500 py-8 text-sm">
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
