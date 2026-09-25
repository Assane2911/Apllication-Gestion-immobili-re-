import { FileText, Landmark, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
 * CRG (Compte-Rendu de Gestion) mensuel du propriétaire connecté (Espace
 * propriétaire) — même contenu que CrgPage.tsx côté gestionnaire (statistiques,
 * détail par bien, export HTML), scopé automatiquement à "/crg/mine" plutôt
 * qu'à un :ownerId choisi, plus les coordonnées bancaires du propriétaire
 * (à qui le net sera reversé), absentes côté gestionnaire pour ne pas
 * ré-afficher une donnée qu'il a lui-même saisie sur la fiche propriétaire.
 */
export default function OwnerCrgPage() {
  const { t, i18n } = useTranslation();
  const { formatMoney } = useCurrency();
  const now = new Date();
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [crg, setCrg] = useState<CrgSynthesis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showExport, setShowExport] = useState(false);

  const loadData = useCallback((selectedMonth: number, selectedYear: number) => {
    setLoading(true);
    api
      .get<CrgSynthesis>("/crg/mine", { params: { month: selectedMonth, year: selectedYear } })
      .then((res) => {
        setCrg(res.data);
        setError(null);
      })
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

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
      <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 p-6 rounded-2xl shadow-xs">
        <p className="text-sm">{error}</p>
        <button
          onClick={() => loadData(month, year)}
          className="mt-4 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors cursor-pointer"
        >
          {t("common.actions.retry")}
        </button>
      </div>
    );
  }

  if (loading || !crg) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
      {/* Bandeau d'accueil — même style que OwnerDashboardPage.tsx */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-brand-950 to-slate-900 text-white p-6 sm:p-7 shadow-md border border-slate-800">
        <div className="absolute -right-8 -bottom-8 w-44 h-44 rounded-full bg-brand-500/15 blur-2xl pointer-events-none" />
        <div className="relative z-10">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight">{t("owner.crg.title")}</h2>
          <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-xl">{t("owner.crg.subtitle")}</p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 flex-wrap">
        <label htmlFor="owner-crg-month-select" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          {t("owner.crg.monthLabel")}
        </label>
        <select
          id="owner-crg-month-select"
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
        <label htmlFor="owner-crg-year-select" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          {t("owner.crg.yearLabel")}
        </label>
        <select
          id="owner-crg-year-select"
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
        <Bulle texte={t("owner.tips.crgExport")}>
        <button
          onClick={() => setShowExport(true)}
          className="bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-3.5 py-2.5 rounded-lg shadow-sm flex items-center gap-1.5 transition-colors"
        >
          <FileText size={13} aria-hidden="true" /> {t("owner.crg.exportHtml")}
        </button>
        </Bulle>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Wallet} label={t("owner.crg.stats.totalLoyers")} value={formatByCurrency(crg.totalLoyersByCurrency, formatMoney)} accent="green" />
        <StatCard icon={TrendingDown} label={t("owner.crg.stats.totalCharges")} value={formatByCurrency(crg.totalChargesByCurrency, formatMoney)} accent="red" />
        <StatCard
          icon={Landmark}
          label={t("owner.crg.stats.totalCommission")}
          value={formatByCurrency(crg.totalCommissionByCurrency, formatMoney)}
          hint={t("owner.crg.feeRateHint", { rate: crg.managementFeeRate })}
          accent="amber"
        />
        <StatCard
          icon={TrendingUp}
          label={t("owner.crg.stats.totalNet")}
          value={formatByCurrency(crg.totalNetByCurrency, formatMoney)}
          accent={allNonNegative(crg.totalNetByCurrency) ? "green" : "red"}
        />
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t("owner.crg.table.title")}</h3>
        </div>
        {crg.properties.length === 0 ? (
          <p className="p-4 sm:p-5 text-xs text-slate-500 dark:text-slate-400">{t("owner.crg.empty")}</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {crg.properties.map((row) => (
              <div key={`${row.propertyId}-${row.currency}`} className="p-4 sm:p-5 flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{row.propertyTitle}</p>
                <div className="flex items-center gap-4 text-xs">
                  <div className="text-right">
                    <p className="text-slate-400 dark:text-slate-500">{t("owner.crg.table.loyers")}</p>
                    <p className="font-bold text-emerald-600 dark:text-emerald-400">{formatMoney(row.loyersEncaisses, row.currency)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-400 dark:text-slate-500">{t("owner.crg.table.charges")}</p>
                    <p className="font-bold text-red-600 dark:text-red-400">-{formatMoney(row.chargesDeduites, row.currency)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-400 dark:text-slate-500">{t("owner.crg.table.commission")}</p>
                    <p className="font-bold text-amber-600 dark:text-amber-400">-{formatMoney(row.commission, row.currency)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-400 dark:text-slate-500">{t("owner.crg.table.net")}</p>
                    <p className={`font-bold ${row.netAReverser >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>
                      {formatMoney(row.netAReverser, row.currency)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 p-4 sm:p-5 shadow-xs">
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-2">{t("owner.crg.bankDetailsTitle")}</h3>
        {crg.iban ? (
          <p className="text-xs text-slate-600 dark:text-slate-400">
            IBAN : <span className="font-mono">{crg.iban}</span>
            {crg.bic && (
              <>
                {" "}
                — BIC : <span className="font-mono">{crg.bic}</span>
              </>
            )}
          </p>
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-500">{t("owner.crg.noBankDetails")}</p>
        )}
      </div>

      {showExport && (
        <DocumentModal
          title={t("owner.crg.title")}
          docUrl={`/crg/mine/export?month=${month}&year=${year}`}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}
