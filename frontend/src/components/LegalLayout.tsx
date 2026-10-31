import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import Logo from "./Logo";
import { COMPANY } from "../legal/companyInfo";
import Seo from "./Seo";

const LEGAL_PAGES = [
  { to: "/mentions-legales", label: "Mentions légales" },
  { to: "/cgu", label: "CGU & CGV" },
  { to: "/confidentialite", label: "Politique de confidentialité" },
];

interface LegalLayoutProps {
  title: string;
  /** Meta description de la page (document juridique français uniquement, voir plus bas). */
  description: string;
  children: ReactNode;
}

/** Titre de section (h2) pour le contenu des pages légales. */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-bold text-slate-900 mb-3">{title}</h2>
      <div className="space-y-3 text-slate-700">{children}</div>
    </section>
  );
}

/** Liste à puces pour le contenu des pages légales. */
export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc list-outside pl-5 space-y-1.5 marker:text-slate-400">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/**
 * Mise en page partagée des 3 pages légales. Volontairement en français
 * uniquement (pas de useTranslation ici) : ce sont des documents juridiques
 * de référence, pas des écrans de l'application traduite.
 */
export default function LegalLayout({ title, description, children }: LegalLayoutProps) {
  const { pathname } = useLocation();

  return (
    <div className="relative isolate min-h-screen text-slate-900">
      <Seo title={`${title} | ${COMPANY.tradeName}`} description={description} canonical={pathname} />
      <nav className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <Logo taille={28} />
            <span className="font-bold text-sm tracking-tight text-slate-900">{COMPANY.tradeName}</span>
          </Link>
          <Link to="/" className="text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors">
            ← Retour à l'accueil
          </Link>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <div className="flex flex-wrap gap-2 mb-8">
          {LEGAL_PAGES.map((page) => (
            <Link
              key={page.to}
              to={page.to}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                pathname === page.to
                  ? "bg-brand-600 border-brand-500 text-white"
                  : "bg-white/80 border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300"
              }`}
            >
              {page.label}
            </Link>
          ))}
        </div>

        <h1 className="text-2xl font-bold text-slate-900 mb-2">{title}</h1>
        <p className="text-xs text-slate-600 mb-10">Dernière mise à jour : {COMPANY.lastUpdated}</p>

        <div className="text-sm leading-relaxed text-slate-700 space-y-8">{children}</div>
      </main>

      <footer className="border-t border-slate-200 bg-white py-8 px-6 text-center text-xs text-slate-600">
        <p>
          © 2026 {COMPANY.tradeName}. {COMPANY.legalStatus}.
        </p>
      </footer>
    </div>
  );
}
