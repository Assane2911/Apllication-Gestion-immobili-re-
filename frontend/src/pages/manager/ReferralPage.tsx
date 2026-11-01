import { Check, Copy, Gift } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage } from "../../api/client";
import BoutonPartager from "../../components/BoutonPartager";
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

  const plafondAtteint = info ? info.rewardedReferrals >= info.maxRewardedReferrals : false;
  const pctPlafond = info && info.maxRewardedReferrals > 0 ? Math.min(100, Math.round((info.rewardedReferrals / info.maxRewardedReferrals) * 100)) : 0;
  const BOUTON_COPIE =
    "inline-flex shrink-0 cursor-pointer items-center gap-1.5 border border-ink-900 bg-white px-3 py-1.5 text-xs font-semibold text-ink-900 transition-colors hover:bg-ink-900 hover:text-white";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
          <Gift className="text-orange-700" size={22} aria-hidden="true" />
          {t("manager.referral.title")}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {info ? t("manager.referral.subtitle", { days: info.rewardDays }) : t("manager.referral.subtitleGeneric")}
        </p>
      </div>

      {loadError && (
        <div className="flex items-center justify-between gap-3 border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          <span>{loadError}</span>
          <button onClick={load} className="shrink-0 cursor-pointer whitespace-nowrap font-semibold underline">
            {t("common.actions.retry")}
          </button>
        </div>
      )}

      {!info && !loadError && (
        <div className="space-y-3 border border-slate-300 bg-white p-6">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
      )}

      {info && (
        <>
          {/* Le coupon : le code à gauche, la récompense à droite, séparés par une ligne de découpe. */}
          <section className="grid grid-cols-1 border-2 border-ink-900 bg-white md:grid-cols-[1fr_15rem]">
            <div className="p-6">
              <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">{t("manager.referral.codeLabel")}</p>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-mono text-3xl font-bold tracking-[0.25em] text-ink-900 sm:text-4xl">{info.referralCode}</span>
                <button onClick={() => copier("code", info.referralCode)} className={BOUTON_COPIE}>
                  {copied === "code" ? <Check size={14} /> : <Copy size={14} />}
                  {copied === "code" ? t("common.actions.copied") : t("common.actions.copy")}
                </button>
              </div>

              <p className="mb-2 mt-6 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">{t("manager.referral.linkLabel")}</p>
              <div className="flex flex-wrap items-center gap-3 border border-slate-300 bg-slate-50 px-3 py-2.5">
                <span className="min-w-0 basis-full truncate font-mono text-xs text-slate-800 sm:flex-1 sm:basis-0">{info.referralUrl}</span>
                <BoutonPartager url={info.referralUrl} titre={t("common.appName")} texte={t("manager.referral.shareText")} />
                <button onClick={() => copier("link", info.referralUrl)} className={BOUTON_COPIE}>
                  {copied === "link" ? <Check size={14} /> : <Copy size={14} />}
                  {copied === "link" ? t("common.actions.copied") : t("common.actions.copy")}
                </button>
              </div>
            </div>

            <div className="relative flex flex-col items-center justify-center gap-1 border-t-2 border-dashed border-ink-900 bg-orange-700 px-6 py-6 text-center text-white md:border-l-2 md:border-t-0">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-white/90">{t("manager.referral.reward.label")}</p>
              <p className="text-5xl font-extrabold tabular-nums">+{info.rewardDays}</p>
              <p className="font-mono text-xs uppercase tracking-wider">{t("manager.referral.reward.days")}</p>
            </div>
          </section>

          <p className="text-xs leading-relaxed text-slate-600">{t("manager.referral.explanation", { days: info.rewardDays })}</p>

          {/* Le suivi : filleuls inscrits, filleuls récompensés (avec la jauge du plafond), jours gagnés. */}
          <section aria-label={t("manager.referral.stats.title")} className="grid grid-cols-1 divide-y divide-slate-300 border border-slate-300 bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="p-5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("manager.referral.totalReferred")}</p>
              <p className="mt-1.5 text-3xl font-bold tabular-nums text-slate-900">{info.totalReferred}</p>
            </div>
            <div className="p-5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("manager.referral.stats.rewarded")}</p>
              <p className="mt-1.5 text-3xl font-bold tabular-nums text-slate-900">
                {`${info.rewardedReferrals} / ${info.maxRewardedReferrals}`}
              </p>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={info.maxRewardedReferrals}
                aria-valuenow={info.rewardedReferrals}
                aria-label={t("manager.referral.stats.rewarded")}
                className="mt-2 h-2 border border-slate-400 bg-white"
              >
                <div className={`h-full ${plafondAtteint ? "bg-orange-700" : "bg-ink-900"}`} style={{ width: `${pctPlafond}%` }} />
              </div>
            </div>
            <div className="p-5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("manager.referral.stats.daysEarned")}</p>
              <p className="mt-1.5 text-3xl font-bold tabular-nums text-ink-900">
                {info.rewardedReferrals * info.rewardDays}
                <span className="text-base font-medium text-slate-600"> {t("manager.referral.stats.daysShort")}</span>
              </p>
            </div>
          </section>

          <p
            className={`border-l-2 px-3 py-2 text-xs ${
              plafondAtteint ? "border-orange-700 bg-orange-50 font-semibold text-orange-900" : "border-slate-400 bg-white text-slate-700"
            }`}
          >
            {plafondAtteint
              ? t("manager.referral.rewardCapReached")
              : t("manager.referral.rewardCap", { used: info.rewardedReferrals, max: info.maxRewardedReferrals })}
          </p>

          {/* Comment ça marche : trois étapes numérotées. */}
          <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {(["share", "signup", "reward"] as const).map((etape, i) => (
              <li key={etape} className="border border-slate-300 bg-white p-4">
                <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-orange-700">{String(i + 1).padStart(2, "0")}</p>
                <p className="mt-2 text-sm text-slate-800">{t(`manager.referral.steps.${etape}`, { days: info.rewardDays })}</p>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
