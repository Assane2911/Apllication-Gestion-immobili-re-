import { AlertTriangle, Hourglass } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../context/auth";

export default function TrialBanner() {
  const { t } = useTranslation();
  const { user } = useAuth();

  if (!user || user.role !== "MANAGER" || !user.subscription) {
    return null;
  }

  const { status, trialDaysRemaining, isTrialActive, isExpired, plan } = user.subscription;

  if (isExpired) {
    return (
      <div className="surface-sombre bg-linear-to-r from-red-600 to-rose-700 text-white px-4 py-3 rounded-xl shadow-sm mb-6 flex flex-wrap items-center justify-between gap-3 animate-pulse">
        <div className="flex items-center gap-2">
          <AlertTriangle size={20} className="shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold text-sm">{t("components.trialBanner.expiredTitle")}</p>
            <p className="text-xs text-red-100">
              {t("components.trialBanner.expiredDesc")}
            </p>
          </div>
        </div>
        <Link
          to="/subscription"
          className="bg-white text-red-700 hover:bg-red-50 text-xs font-bold px-4 py-2 rounded-lg shadow-sm transition-transform hover:scale-105"
        >
          {t("components.trialBanner.unlockCta")}
        </Link>
      </div>
    );
  }

  if (isTrialActive) {
    const isUrgent = trialDaysRemaining <= 3;
    const isWarning = trialDaysRemaining <= 7;

    const bgGradient = isUrgent
      ? "from-amber-600 to-orange-700"
      : isWarning
      ? "from-brand-600 to-brand-800"
      : "";

    return (
      <div
        className={`${
          bgGradient
            ? `surface-sombre bg-linear-to-r ${bgGradient} text-white border border-white/10`
            : "bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-2 border-ink-900 dark:border-slate-300/50"
        } px-4 py-3 rounded-md shadow-sm mb-6 flex flex-wrap items-center justify-between gap-3`}
      >
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full ${bgGradient ? "bg-white/20" : "bg-ocre/40"} flex items-center justify-center shrink-0`}>
            <Hourglass size={15} aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={`${bgGradient ? "bg-white/20 text-white" : "bg-ocre/30 text-slate-900 dark:text-white"} text-[11px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider`}>
                {t("components.trialBanner.trialBadge")}
              </span>
              <span className={`text-xs font-medium ${bgGradient ? "text-white/90" : "text-slate-800 dark:text-white/90"}`}>
                {trialDaysRemaining === 0
                  ? t("components.trialBanner.lastDay")
                  : trialDaysRemaining === 1
                  ? t("components.trialBanner.oneDayLeft")
                  : t("components.trialBanner.daysLeft", { count: trialDaysRemaining })}
              </span>
            </div>
            <p className={`text-xs ${bgGradient ? "text-white/80" : "text-slate-700 dark:text-white/80"} mt-0.5`}>
              {t("components.trialBanner.trialDesc")}
            </p>
          </div>
        </div>
        <Link
          to="/subscription"
          className={`${bgGradient ? "bg-white text-slate-900 hover:bg-slate-100" : "bg-brand-600 text-white hover:bg-brand-700"} text-xs font-semibold px-3.5 py-1.5 rounded-md shadow-sm transition-colors shrink-0`}
        >
          {t("components.trialBanner.chooseOfferCta")}
        </Link>
      </div>
    );
  }

  if (status === "ACTIVE") {
    return (
      <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 px-4 py-2 rounded-xl mb-6 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>
            <Trans i18nKey="components.trialBanner.activePlan" values={{ plan: t(`common.plans.${plan}`, { defaultValue: plan }) }} components={{ 1: <strong /> }} />
          </span>
        </div>
        <Link to="/subscription" className="text-emerald-700 dark:text-emerald-400 hover:underline font-medium">
          {t("components.trialBanner.manageSubscription")}
        </Link>
      </div>
    );
  }

  return null;
}
