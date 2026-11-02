import { AlertTriangle, Hourglass } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../context/auth";

/** Durée de l'essai gratuit : 15 jours (voir les tarifs). La jauge montre ce qu'il en reste. */
const DUREE_ESSAI_JOURS = 15;

export default function TrialBanner() {
  const { t } = useTranslation();
  const { user } = useAuth();

  if (!user || user.role !== "MANAGER" || !user.subscription) {
    return null;
  }

  const { status, trialDaysRemaining, isTrialActive, isExpired, plan } = user.subscription;

  if (isExpired) {
    return (
      <div className="surface-sombre mb-6 flex flex-wrap items-center justify-between gap-3 border border-rose-700 bg-rose-700 px-4 py-3 text-white shadow-[inset_4px_0_0_var(--color-orange-700)]">
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
          className="border border-white bg-white px-4 py-2 text-xs font-bold text-rose-800 transition-colors hover:bg-rose-50"
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
      ? "bg-orange-700"
      : isWarning
      ? "bg-brand-700"
      : "";

    return (
      <div
        className={`${
          bgGradient
            ? `surface-sombre ${bgGradient} text-white border border-ink-900`
            : "bg-white text-slate-900 border-2 border-ink-900"
        } mb-6 flex flex-wrap items-center justify-between gap-3 px-4 py-3`}
      >
        <div className="flex items-center gap-3">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center border ${bgGradient ? "border-white/60" : "border-ink-900"}`}>
            <Hourglass size={15} aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={`${bgGradient ? "border border-white/60 text-white" : "border border-ink-900 text-ink-900"} px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider`}>
                {t("components.trialBanner.trialBadge")}
              </span>
              <span className={`text-xs font-medium ${bgGradient ? "text-white/90" : "text-slate-800"}`}>
                {trialDaysRemaining === 0
                  ? t("components.trialBanner.lastDay")
                  : trialDaysRemaining === 1
                  ? t("components.trialBanner.oneDayLeft")
                  : t("components.trialBanner.daysLeft", { count: trialDaysRemaining })}
              </span>
            </div>
            <p className={`text-xs ${bgGradient ? "text-white/80" : "text-slate-700"} mt-0.5`}>
              {t("components.trialBanner.trialDesc")}
            </p>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={DUREE_ESSAI_JOURS}
              aria-valuenow={Math.min(DUREE_ESSAI_JOURS, Math.max(0, trialDaysRemaining))}
              aria-label={t("components.trialBanner.progress")}
              className={`mt-2 h-1.5 w-48 max-w-full border ${bgGradient ? "border-white/60" : "border-slate-400"}`}
            >
              <div className={`h-full ${bgGradient ? "bg-white" : "bg-orange-700"}`} style={{ width: `${Math.round((Math.min(DUREE_ESSAI_JOURS, Math.max(0, trialDaysRemaining)) / DUREE_ESSAI_JOURS) * 100)}%` }} />
            </div>
          </div>
        </div>
        <Link
          to="/subscription"
          className={`${bgGradient ? "border border-white bg-white text-slate-900 hover:bg-slate-100" : "border border-ink-900 bg-ink-900 text-white hover:bg-brand-600"} shrink-0 px-3.5 py-1.5 text-xs font-semibold transition-colors`}
        >
          {t("components.trialBanner.chooseOfferCta")}
        </Link>
      </div>
    );
  }

  if (status === "ACTIVE") {
    return (
      <div className="bg-white border border-slate-300 text-slate-800 px-4 py-2 mb-6 shadow-[inset_3px_0_0_var(--color-ink-900)] flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-ink-900"></span>
          <span>
            <Trans i18nKey="components.trialBanner.activePlan" values={{ plan: t(`common.plans.${plan}`, { defaultValue: plan }) }} components={{ 1: <strong /> }} />
          </span>
        </div>
        <Link to="/subscription" className="text-ink-900 hover:text-orange-700 hover:underline font-medium">
          {t("components.trialBanner.manageSubscription")}
        </Link>
      </div>
    );
  }

  return null;
}
