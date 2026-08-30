import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { COMPANY } from "../legal/companyInfo";

const LEGAL_PAGES = [
  { to: "/mentions-legales", label: "Mentions légales" },
  { to: "/cgu", label: "CGU & CGV" },
  { to: "/confidentialite", label: "Politique de confidentialité" },
];

interface LegalLayoutProps {
  title: string;
  children: ReactNode;
}

/** Titre de section (h2) pour le contenu des pages légales. */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-bold text-white mb-3">{title}</h2>
      <div className="space-y-3 text-slate-300">{children}</div>
    </section>
  );
}

/** Liste à puces pour le contenu des pages légales. */
export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc list-outside pl-5 space-y-1.5 marker:text-slate-600">
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
export default function LegalLayout({ title, children }: LegalLayoutProps) {
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <img src="/app-icon.png" alt="Logo" className="w-7 h-7 rounded-lg shadow" />
            <span className="font-bold text-sm tracking-tight text-white">{COMPANY.tradeName}</span>
          </Link>
          <Link to="/" className="text-xs font-medium text-slate-400 hover:text-white transition-colors">
            ← Retour à l'accueil
          </Link>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="flex flex-wrap gap-2 mb-8">
          {LEGAL_PAGES.map((page) => (
            <Link
              key={page.to}
              to={page.to}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                pathname === page.to
                  ? "bg-brand-600 border-brand-500 text-white"
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700"
              }`}
            >
              {page.label}
            </Link>
          ))}
        </div>

        <h1 className="text-2xl font-bold text-white mb-2">{title}</h1>
        <p className="text-xs text-slate-500 mb-10">Dernière mise à jour : {COMPANY.lastUpdated}</p>

        <div className="text-sm leading-relaxed text-slate-300 space-y-8">{children}</div>
      </div>

      <footer className="border-t border-slate-800/80 py-8 px-6 text-center text-xs text-slate-500">
        <p>
          © 2026 {COMPANY.tradeName}. {COMPANY.legalStatus} — {COMPANY.country}.
        </p>
      </footer>
    </div>
  );
}
