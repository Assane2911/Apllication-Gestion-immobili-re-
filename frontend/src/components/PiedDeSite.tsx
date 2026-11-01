import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export interface LienPied {
  to: string;
  libelle: string;
}

/**
 * Pied de page des pages publiques (accueil, pages légales), en bloc de titre de plan : une bande hachurée, la marque et
 * son accroche, les liens en lignes numérotées, et un encadré pour les mentions. Reste un <footer> hors de <main>.
 */
export default function PiedDeSite({
  accroche,
  liens,
  mentions,
  etroit = false,
}: {
  accroche?: string;
  liens?: LienPied[];
  mentions: ReactNode;
  /** Colonne étroite (pages de texte) : le pied s'aligne sur le texte et empile ses blocs. */
  etroit?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <footer className="border-t-2 border-ink-900 bg-white">
      <div aria-hidden="true" className="bande-motif h-2.5 opacity-70" />
      <div className={`mx-auto grid items-start gap-8 px-6 py-10 ${etroit ? "max-w-3xl" : "max-w-7xl md:grid-cols-12"}`}>
        <div className={etroit ? "" : liens ? "md:col-span-5" : "md:col-span-8"}>
          <p className="text-lg font-extrabold tracking-tight text-ink-900">{t("common.appName")}</p>
          {accroche && <p className="mt-2 max-w-sm text-xs leading-relaxed text-slate-700">{accroche}</p>}
        </div>

        {liens && liens.length > 0 && (
          <nav aria-label={t("common.cartouche.footerNav")} className={etroit ? "" : "md:col-span-4"}>
            <ul className="border border-ink-900">
              {liens.map((lien, i) => (
                <li key={lien.to} className="border-b border-slate-300 last:border-b-0">
                  <Link
                    to={lien.to}
                    className="group flex items-center gap-3 px-4 py-2.5 text-xs font-semibold text-ink-900 transition-colors hover:bg-slate-50 hover:text-orange-700"
                  >
                    <span aria-hidden="true" className="font-mono text-[10px] text-orange-700">{String(i + 1).padStart(2, "0")}</span>
                    <span className="flex-1">{lien.libelle}</span>
                    <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className={`border border-ink-900 ${etroit ? "" : liens ? "md:col-span-3" : "md:col-span-4"}`}>
          <p className="border-b border-ink-900 bg-ink-900 px-4 py-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-white">{t("common.cartouche.notice")}</p>
          <div className="px-4 py-3 text-xs leading-relaxed text-slate-700">{mentions}</div>
        </div>
      </div>
    </footer>
  );
}
