import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../../api/client";
import { useCurrency } from "../../context/currency";
import type { OwnerDashboard } from "../../types";

/**
 * Résumé financier en lecture seule (Espace propriétaire) — même pattern de
 * chargement (load/état loading-erreur-vide-données) que TenantDashboardPage,
 * mais un contenu volontairement plus léger : le périmètre validé avec
 * l'utilisateur est "résumé financier seulement", pas un portail complet.
 */
export default function OwnerDashboardPage() {
  const { t } = useTranslation();
  const { formatMoney } = useCurrency();
  const [data, setData] = useState<OwnerDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .get<OwnerDashboard>("/owners/mine/dashboard")
      .then((res) => {
        setData(res.data);
        setError(null);
      })
      .catch((err) => setError(apiErrorMessage(err)));
  }

  useEffect(() => {
    load();
  }, []);

  if (error) {
    return (
      <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 p-6 rounded-2xl shadow-xs">
        <p className="text-sm">{error}</p>
        <button
          onClick={load}
          className="mt-4 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors cursor-pointer"
        >
          {t("common.actions.retry")}
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <span className="w-8 h-8 border-[3px] border-slate-200 dark:border-slate-700 border-t-brand-500 rounded-full animate-spin" />
      </div>
    );
  }

  const collectedCurrencies = Object.keys(data.collectedThisMonthByCurrency);
  const pendingCurrencies = Object.keys(data.pendingThisMonthByCurrency);
  const historyMonths = Object.keys(data.revenueByMonth).sort();

  return (
    <div className="space-y-6">
      {/* Bandeau d'accueil */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-brand-950 to-slate-900 text-white p-6 sm:p-7 shadow-md border border-slate-800">
        <div className="absolute -right-8 -bottom-8 w-44 h-44 rounded-full bg-brand-500/15 blur-2xl pointer-events-none" />
        <div className="relative z-10">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight">{t("owner.dashboard.title")}</h2>
          <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-xl">{t("owner.dashboard.subtitle")}</p>
        </div>
      </div>

      {/* Totaux du mois */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 p-5 shadow-xs">
          <p className="text-xs text-slate-400 dark:text-slate-500 mb-1.5">{t("owner.dashboard.collectedThisMonth")}</p>
          {collectedCurrencies.length === 0 ? (
            <p className="text-lg font-bold text-slate-400 dark:text-slate-600">{formatMoney(0)}</p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {collectedCurrencies.map((currency) => (
                <p key={currency} className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                  {formatMoney(data.collectedThisMonthByCurrency[currency], currency)}
                </p>
              ))}
            </div>
          )}
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 p-5 shadow-xs">
          <p className="text-xs text-slate-400 dark:text-slate-500 mb-1.5">{t("owner.dashboard.pendingThisMonth")}</p>
          {pendingCurrencies.length === 0 ? (
            <p className="text-lg font-bold text-slate-400 dark:text-slate-600">{formatMoney(0)}</p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {pendingCurrencies.map((currency) => (
                <p key={currency} className="text-lg font-bold text-amber-600 dark:text-amber-400">
                  {formatMoney(data.pendingThisMonthByCurrency[currency], currency)}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 p-4 sm:p-5 shadow-xs flex items-center justify-between gap-3 flex-wrap">
        <span className="text-xs text-slate-500 dark:text-slate-400">{t("owner.dashboard.managementFeeRate")}</span>
        <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{data.managementFeeRate}%</span>
      </div>

      {/* Détail par bien */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t("owner.dashboard.propertiesTitle")}</h3>
        </div>
        {data.properties.length === 0 ? (
          <p className="p-4 sm:p-5 text-xs text-slate-500 dark:text-slate-400">{t("owner.dashboard.noProperties")}</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.properties.map((p) => (
              <div key={p.propertyId} className="p-4 sm:p-5 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{p.title}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{p.address}</p>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <div className="text-right">
                    <p className="text-slate-400 dark:text-slate-500">{t("owner.dashboard.collected")}</p>
                    <p className="font-bold text-emerald-600 dark:text-emerald-400">{formatMoney(p.collected, p.currency)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-400 dark:text-slate-500">{t("owner.dashboard.pending")}</p>
                    <p className="font-bold text-amber-600 dark:text-amber-400">{formatMoney(p.pending, p.currency)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Historique 6 mois */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t("owner.dashboard.historyTitle")}</h3>
        </div>
        {historyMonths.length === 0 ? (
          <p className="p-4 sm:p-5 text-xs text-slate-500 dark:text-slate-400">{t("owner.dashboard.noHistory")}</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {historyMonths.map((month) => (
              <div key={month} className="p-4 sm:p-5 flex items-center justify-between gap-3 flex-wrap">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{month}</span>
                <div className="flex items-center gap-3 text-xs font-bold text-slate-900 dark:text-slate-100">
                  {Object.entries(data.revenueByMonth[month]).map(([currency, amount]) => (
                    <span key={currency}>{formatMoney(amount, currency)}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
