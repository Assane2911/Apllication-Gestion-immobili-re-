import { RefreshCw, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { type EtatMaintenance, minutesRestantes } from "../utils/maintenance";
import Logo from "./Logo";

interface Props {
  etat: EtatMaintenance;
  maintenant: number;
  verification: boolean;
  onVerifier: () => void;
}

/**
 * L'écran qu'on voit pendant la maintenance, à la place de l'application : ce qui se passe, jusqu'à quand, et le message écrit par
 * l'équipe s'il y en a un. Il se met à jour tout seul (voir useMaintenance) : dès la fin de la fenêtre, l'application revient.
 * L'accès administrateur reste proposé, pour qui doit clore l'opération.
 */
export default function PageMaintenance({ etat, maintenant, verification, onVerifier }: Props) {
  const { t, i18n } = useTranslation();
  const fin = new Date(etat.fin);
  const aujourdhui = new Date(maintenant).toDateString() === fin.toDateString();
  const quand = fin.toLocaleString(i18n.language, aujourdhui ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const minutes = minutesRestantes(etat, maintenant);

  return (
    <main data-surface="app" className="flex min-h-screen items-center justify-center px-4 py-10">
      <title>{`${t("maintenance.page.docTitle")} | ${t("common.appName")}`}</title>
      <div className="w-full max-w-lg border border-ink-900 bg-white shadow-[inset_4px_0_0_var(--color-orange-700)]">
        <div className="flex items-center gap-3 border-b border-slate-300 px-6 py-4">
          <Logo />
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-orange-700">{t("maintenance.page.label")}</p>
        </div>
        <div className="space-y-5 px-6 py-7">
          <div className="flex size-12 items-center justify-center border border-slate-300 bg-slate-50 text-ink-900">
            <Wrench size={22} strokeWidth={1.6} aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">{t("maintenance.page.title")}</h1>
          <p className="text-sm text-slate-700">{t("maintenance.page.body")}</p>

          {etat.message && (
            <blockquote className="border-l-4 border-ink-900 bg-slate-50 px-4 py-3 text-sm text-slate-800">
              <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">{t("maintenance.page.messageLabel")}</p>
              <p className="whitespace-pre-wrap wrap-break-word">{etat.message}</p>
            </blockquote>
          )}

          <dl className="divide-y divide-slate-300 border border-slate-300 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
              <dt className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("maintenance.page.returnLabel")}</dt>
              <dd className="font-semibold tabular-nums text-ink-900">{quand}</dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
              <dt className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{t("maintenance.page.remainingLabel")}</dt>
              <dd className="tabular-nums text-slate-900">{minutes > 1 ? t("maintenance.page.remaining", { count: minutes }) : t("maintenance.page.soon")}</dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <button
              type="button"
              onClick={onVerifier}
              disabled={verification}
              className="inline-flex cursor-pointer items-center gap-2 border border-ink-900 bg-ink-900 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60"
            >
              <RefreshCw size={14} aria-hidden="true" />
              {verification ? t("maintenance.page.checking") : t("maintenance.page.check")}
            </button>
            <p className="text-xs text-slate-600">{t("maintenance.page.autoRefresh")}</p>
          </div>
        </div>
        <div className="border-t border-slate-300 px-6 py-3 text-right">
          <Link to="/login" className="border-b border-ink-900/40 text-xs font-semibold text-ink-900 hover:border-orange-700 hover:text-orange-700">
            {t("maintenance.page.admin")}
          </Link>
        </div>
      </div>
    </main>
  );
}
