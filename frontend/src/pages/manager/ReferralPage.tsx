import { Check, Copy, Gift, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../../api/client";
import { Skeleton } from "../../components/Skeleton";
import type { ReferralInfo } from "../../types";

export default function ReferralPage() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  function load() {
    setLoadError(null);
    api
      .get<ReferralInfo>("/referral")
      .then((res) => setInfo(res.data))
      .catch((err) => setLoadError(apiErrorMessage(err)));
  }

  useEffect(load, []);

  async function copier(champ: "code" | "link", valeur: string) {
    try {
      await navigator.clipboard.writeText(valeur);
      setCopied(champ);
      setTimeout(() => setCopied((c) => (c === champ ? null : c)), 1500);
    } catch {
      // Environnement sans presse-papiers (permission refusée, contexte non
      // sécurisé) : le code reste affiché et copiable à la main.
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Gift className="text-brand-600 dark:text-brand-400" size={22} aria-hidden="true" />
          {t("manager.referral.title")}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          {info ? t("manager.referral.subtitle", { days: info.rewardDays }) : t("manager.referral.subtitleGeneric")}
        </p>
      </div>

      {loadError && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 px-4 py-3 rounded-xl text-xs flex items-center justify-between gap-3">
          <span>{loadError}</span>
          <button onClick={load} className="underline font-semibold shrink-0 whitespace-nowrap">
            {t("common.actions.retry")}
          </button>
        </div>
      )}

      {!info && !loadError && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
      )}

      {info && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 space-y-5 shadow-sm">
            <div>
              <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                {t("manager.referral.codeLabel")}
              </p>
              <div className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3">
                <span className="font-mono text-xl font-bold tracking-widest text-slate-900 dark:text-slate-100">
                  {info.referralCode}
                </span>
                <button
                  onClick={() => copier("code", info.referralCode)}
                  className="shrink-0 text-xs font-semibold text-brand-700 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-brand-50 dark:hover:bg-brand-500/10"
                >
                  {copied === "code" ? <Check size={14} /> : <Copy size={14} />}
                  {copied === "code" ? t("common.actions.copied") : t("common.actions.copy")}
                </button>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                {t("manager.referral.linkLabel")}
              </p>
              <div className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3">
                <span className="text-xs text-slate-700 dark:text-slate-300 truncate">{info.referralUrl}</span>
                <button
                  onClick={() => copier("link", info.referralUrl)}
                  className="shrink-0 text-xs font-semibold text-brand-700 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-brand-50 dark:hover:bg-brand-500/10"
                >
                  {copied === "link" ? <Check size={14} /> : <Copy size={14} />}
                  {copied === "link" ? t("common.actions.copied") : t("common.actions.copy")}
                </button>
              </div>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-500">{t("manager.referral.explanation", { days: info.rewardDays })}</p>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 flex flex-col items-center justify-center text-center shadow-sm">
            <div className="w-11 h-11 rounded-full bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400 flex items-center justify-center mb-3">
              <Users size={20} aria-hidden="true" />
            </div>
            <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{info.totalReferred}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{t("manager.referral.totalReferred")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
