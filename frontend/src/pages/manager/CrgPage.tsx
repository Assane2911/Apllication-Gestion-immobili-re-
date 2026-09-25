import { FileText, Landmark, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { api, apiErrorMessage } from "../../api/client";
import DocumentModal from "../../components/DocumentModal";
import { Skeleton, StatCardSkeleton } from "../../components/Skeleton";
import StatCard from "../../components/StatCard";
import { useCurrency } from "../../context/currency";
import type { CrgSynthesis } from "../../types";
import { formatByCurrency } from "../../utils/currencyFormat";
import Bulle from "../../components/Bulle";

/** Vrai si le montant est positif ou nul dans TOUTES les devises. */
function allNonNegative(byCurrency: Record<string, number>): boolean {
  const values = Object.values(byCurrency);
  return values.length === 0 || values.every((amount) => amount >= 0);
}

/**
 * CRG (Compte-Rendu de Gestion) mensuel d'UN propriétaire, côté gestionnaire
 * — accessible depuis un lien "CRG" sur la fiche du propriétaire
 * (OwnersPage.tsx). Contrairement à FiscalPage.tsx (toute l'agence, annuel),
 * cette page est scopée à un seul propriétaire (:ownerId) et mensuelle, avec
 * en plus la commission d'agence et le net à reverser.
 */
export default function CrgPage() {
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const { ownerId } = useParams<{ ownerId: string }>();
  const now = new Date();
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [crg, setCrg] = useState<CrgSynthesis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showExport, setShowExport] = useState(false);

  const loadData = useCallback(
    (selectedMonth: number, selectedYear: number) => {
      if (!ownerId) return;
      setLoading(true);
      api
        .get<CrgSynthesis>(`/crg/${ownerId}`, { params: { month: selectedMonth, year: selectedYear } })
        .then((res) => {
          setCrg(res.data);
          setError(null);
        })
        .catch((err) => setError(apiErrorMessage(err)))
        .finally(() => setLoading(false));
    },
    [ownerId]
  );

  useEffect(() => {
    loadData(month, year);
  }, [loadData, month, year]);

  const monthOptions = Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    label: new Date(2000, i, 1).toLocaleDateString(i18n.language, { month: "long" }),
  }));
  const yearOptions = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i);

  if (error) {
    return (
      <div className="space-y-4">
        <Link to="/proprietaires" className="text-xs text-brand-600 dark:text-brand-400 hover:underline">
          {t("manager.crg.backToOwners")}
        </Link>
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 p-6 rounded-2xl">
          <h3 className="font-bold text-base mb-1">{t("manager.crg.errorTitle")}</h3>
          <p className="text-sm">{error}</p>
          <button
            onClick={() => loadData(month, year)}
            className="mt-4 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-4 py-2 rounded-xl"
          >
            {t("common.actions.retry")}
          </button>
        </div>
      </div>
    );
  }

  if (loading || !crg) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{t("manager.crg.title")}</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
        <Skeleton className="h-[240px] w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/proprietaires" className="text-xs text-brand-600 dark:text-brand-400 hover:underline">
          {t("manager.crg.backToOwners")}
        </Link>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{t("manager.crg.title")}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {t("manager.crg.subtitle", { ownerName: crg.ownerName })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label htmlFor="crg-month-select" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            {t("manager.crg.monthLabel")}
          </label>
          <select
            id="crg-month-select"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500 capitalize"
          >
            {monthOptions.map((m) => (
              <option key={m.value} value={m.value} className="capitalize">
                {m.label}
              </option>
            ))}
          </select>
          <label htmlFor="crg-year-select" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            {t("manager.crg.yearLabel")}
          </label>
          <select
            id="crg-year-select"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <Bulle texte={t("manager.tips.crgExport")}>
          <button
            onClick={() => setShowExport(true)}
            className="bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-3.5 py-2.5 rounded-lg shadow-sm flex items-center gap-1.5 transition-colors"
          >
            <FileText size={13} aria-hidden="true" /> {t("manager.crg.exportHtml")}
          </button>
          </Bulle>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Wallet}
          label={t("manager.crg.stats.totalLoyers")}
          value={formatByCurrency(crg.totalLoyersByCurrency, formatMoney)}
          accent="green"
        />
        <StatCard
          icon={TrendingDown}
          label={t("manager.crg.stats.totalCharges")}
          value={formatByCurrency(crg.totalChargesByCurrency, formatMoney)}
          accent="red"
        />
        <StatCard
          icon={Landmark}
          label={t("manager.crg.stats.totalCommission")}
          value={formatByCurrency(crg.totalCommissionByCurrency, formatMoney)}
          hint={t("manager.crg.feeRateHint", { rate: crg.managementFeeRate })}
          accent="amber"
        />
        <StatCard
          icon={TrendingUp}
          label={t("manager.crg.stats.totalNet")}
          value={formatByCurrency(crg.totalNetByCurrency, formatMoney)}
          accent={allNonNegative(crg.totalNetByCurrency) ? "green" : "red"}
        />
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">{t("manager.crg.table.title")}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">{t("manager.crg.table.property")}</th>
                <th className="px-4 py-3 font-medium">{t("manager.crg.table.currency")}</th>
                <th className="px-4 py-3 font-medium">{t("manager.crg.table.loyers")}</th>
                <th className="px-4 py-3 font-medium">{t("manager.crg.table.charges")}</th>
                <th className="px-4 py-3 font-medium">{t("manager.crg.table.commission")}</th>
                <th className="px-4 py-3 font-medium">{t("manager.crg.table.net")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {crg.properties.map((row) => (
                <tr key={`${row.propertyId}-${row.currency}`} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{row.propertyTitle}</td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs">{row.currency}</td>
                  <td className="px-4 py-3 text-emerald-600 dark:text-emerald-400 font-semibold tabular-nums">
                    {formatMoney(row.loyersEncaisses, row.currency)}
                  </td>
                  <td className="px-4 py-3 text-red-600 dark:text-red-400 font-semibold tabular-nums">
                    -{formatMoney(row.chargesDeduites, row.currency)}
                  </td>
                  <td className="px-4 py-3 text-amber-600 dark:text-amber-400 font-semibold tabular-nums">
                    -{formatMoney(row.commission, row.currency)}
                  </td>
                  <td
                    className={`px-4 py-3 font-bold tabular-nums ${row.netAReverser >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}
                  >
                    {formatMoney(row.netAReverser, row.currency)}
                  </td>
                </tr>
              ))}
              {crg.properties.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-slate-400 dark:text-slate-500 py-8 text-sm">
                    {t("manager.crg.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showExport && ownerId && (
        <DocumentModal
          title={t("manager.crg.title") + " - " + crg.ownerName}
          docUrl={`/crg/${ownerId}/export?month=${month}&year=${year}`}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}
