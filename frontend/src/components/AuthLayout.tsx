import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import LanguageSwitcher from "./LanguageSwitcher";
import Logo from "./Logo";
import Reveal from "./Reveal";

interface AuthLayoutProps {
  page: "login" | "register";
  /** Libellé du lien de retour vers l'accueil. */
  retour: string;
  children: ReactNode;
}

/**
 * Cadre des pages de connexion et d'inscription : à gauche, une planche d'encre (marque, promesse, points forts numérotés,
 * cartouche de feuille) ; à droite, le formulaire posé sur le papier quadrillé. La planche est masquée sur téléphone, où la
 * marque est reprise au-dessus du formulaire.
 */
export default function AuthLayout({ page, retour, children }: AuthLayoutProps) {
  const { t } = useTranslation();
  const highlights = t(`auth.${page}.panel.highlights`, { returnObjects: true }) as string[];
  const cases = [
    { cle: "project", libelle: t("common.cartouche.project"), valeur: t("common.appName") },
    { cle: "page", libelle: t("common.cartouche.page"), valeur: t(`auth.cartouche.${page}`) },
  ];

  return (
    <div className="relative isolate grid min-h-screen grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-ink-900 p-12 text-white lg:flex xl:p-16">
        <div aria-hidden="true" className="bande-motif absolute inset-x-0 top-0 h-3.5 opacity-80" />
        {/* Le quadrillage du plan, en filigrane. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        <Reveal className="relative flex items-center gap-3">
          <span className="flex size-11 items-center justify-center bg-white">
            <Logo taille={32} />
          </span>
          <span className="font-mono text-sm font-semibold uppercase tracking-wider">{t("common.appName")}</span>
        </Reveal>

        <Reveal delay={100} className="relative max-w-md">
          <p className="text-3xl font-extrabold leading-tight xl:text-4xl xl:leading-10">{t(`auth.${page}.panel.title`)}</p>
          <p className="mt-4 text-sm leading-relaxed text-slate-300">{t(`auth.${page}.panel.subtitle`)}</p>

          <ol className="mt-8 border-t border-white/20">
            {highlights.map((item, i) => (
              <li key={i} className="flex items-baseline gap-4 border-b border-white/20 py-3 text-sm text-slate-100">
                <span aria-hidden="true" className="font-mono text-[11px] font-semibold text-orange-300">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {item}
              </li>
            ))}
          </ol>
        </Reveal>

        <div className="relative space-y-4">
          <Reveal delay={200}>
            <p className="inline-block border border-orange-300/60 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-orange-200">
              {t(`auth.${page}.panel.trialNote`)}
            </p>
          </Reveal>
          {/* Cartouche de feuille : décoratif, comme celui des espaces connectés. */}
          <div aria-hidden="true" className="grid grid-cols-[1fr_1fr_auto] border border-white/30 font-mono">
            {cases.map((c) => (
              <div key={c.cle} className="border-r border-white/30 px-3 py-2">
                <p className="text-[9px] uppercase tracking-widest text-slate-400">{c.libelle}</p>
                <p className="mt-0.5 truncate text-[11px] font-semibold uppercase tracking-wider">{c.valeur}</p>
              </div>
            ))}
            <div className="bg-white px-3 py-2 text-ink-900">
              <p className="text-[9px] uppercase tracking-widest text-slate-600">{t("auth.cartouche.sheet")}</p>
              <p className="mt-0.5 text-sm font-bold">
                {page === "login" ? "01" : "02"} <span className="text-[10px] font-normal text-slate-600">/ 02</span>
              </p>
            </div>
          </div>
        </div>
      </aside>

      <main className="relative flex flex-col items-center justify-center px-6 pb-12 pt-20">
        <div className="absolute left-6 right-6 top-6 flex items-center justify-between">
          <Link
            to="/landing"
            className="border-b border-ink-900/40 pb-0.5 text-xs font-semibold text-ink-900 transition-colors hover:border-orange-700 hover:text-orange-700"
          >
            {retour}
          </Link>
          <LanguageSwitcher />
        </div>

        <Reveal className="w-full max-w-md">
          <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
            <Logo />
            <span className="font-mono text-sm font-semibold uppercase tracking-wider text-ink-900">{t("common.appName")}</span>
          </div>
          <div className="border border-slate-300 bg-white shadow-[0_1px_0_rgba(15,61,94,0.06)]">
            <div aria-hidden="true" className="bande-motif h-1.5" />
            <div className="p-6 sm:p-8">{children}</div>
          </div>
        </Reveal>
      </main>
    </div>
  );
}
