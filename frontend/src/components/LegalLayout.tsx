import { ArrowLeft, ArrowRight, Check, Link2, Printer } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import Logo from "./Logo";
import { COMPANY } from "../legal/companyInfo";
import PiedDeSite from "./PiedDeSite";
import Seo from "./Seo";

const LEGAL_PAGES = [
  { to: "/mentions-legales", label: "Mentions légales" },
  { to: "/cgu", label: "CGU & CGV" },
  { to: "/confidentialite", label: "Politique de confidentialité" },
];

/** Mots lus par minute, pour estimer la durée de lecture d'un document. */
const MOTS_PAR_MINUTE = 200;

interface LegalLayoutProps {
  title: string;
  /** Meta description de la page (document juridique français uniquement, voir plus bas). */
  description: string;
  children: ReactNode;
}

/** Identifiant d'ancre tiré d'un titre : sans accents ni ponctuation, en minuscules, mots reliés par des tirets. */
export function slugifier(titre: string): string {
  return titre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Copie un texte dans le presse-papiers ; renvoie `false` si le navigateur ne le permet pas. */
async function copier(texte: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texte);
    return true;
  } catch {
    return false;
  }
}

/** Titre de section (h2) pour le contenu des pages légales, avec son ancre et un bouton qui copie le lien de la section. */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  const { pathname } = useLocation();
  const id = slugifier(title);
  const [copie, setCopie] = useState(false);

  async function copierLien() {
    if (await copier(`${window.location.origin}${pathname}#${id}`)) {
      setCopie(true);
      setTimeout(() => setCopie(false), 1800);
    }
  }

  return (
    <section id={id} className="scroll-mt-24 border-t border-slate-300 pt-6">
      <div className="group mb-3 flex items-start justify-between gap-3">
        <h2 className="text-base font-bold text-ink-900">{title}</h2>
        <button
          type="button"
          onClick={copierLien}
          aria-label={`Copier le lien de la section : ${title}`}
          className="mt-0.5 flex size-6 shrink-0 cursor-pointer items-center justify-center text-slate-500 opacity-60 transition-opacity hover:text-orange-700 hover:opacity-100 focus-visible:opacity-100 print:hidden"
        >
          {copie ? <Check size={14} aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />}
        </button>
      </div>
      <div className="space-y-3 text-slate-700">{children}</div>
    </section>
  );
}

/** Liste à puces pour le contenu des pages légales. */
export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-outside list-disc space-y-1.5 pl-5 marker:text-orange-700">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

interface EntreeSommaire {
  id: string;
  numero: string | null;
  libelle: string;
}

/** « 3. Formules d'abonnement » → numéro « 03 » et libellé « Formules d'abonnement » ; un titre sans numéro reste entier. */
function decouperTitre(titre: string): { numero: string | null; libelle: string } {
  const m = /^(\d+)\.\s*(.+)$/.exec(titre.trim());
  return m ? { numero: m[1].padStart(2, "0"), libelle: m[2] } : { numero: null, libelle: titre.trim() };
}

/**
 * Mise en page partagée des 3 pages légales. Volontairement en français
 * uniquement (pas de useTranslation ici) : ce sont des documents juridiques
 * de référence, pas des écrans de l'application traduite.
 *
 * Le sommaire, la durée de lecture et les ancres sont construits à partir des sections réellement affichées : une page
 * qui gagne ou perd une section les met à jour sans qu'on y touche.
 */
export default function LegalLayout({ title, description, children }: LegalLayoutProps) {
  const { pathname, hash } = useLocation();
  const contenu = useRef<HTMLDivElement>(null);
  const [sommaire, setSommaire] = useState<EntreeSommaire[]>([]);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [actif, setActif] = useState<string | null>(null);
  const [lienCopie, setLienCopie] = useState(false);
  const rang = LEGAL_PAGES.findIndex((page) => page.to === pathname);
  const precedent = rang > 0 ? LEGAL_PAGES[rang - 1] : null;
  const suivant = rang >= 0 && rang < LEGAL_PAGES.length - 1 ? LEGAL_PAGES[rang + 1] : null;

  useEffect(() => {
    const racine = contenu.current;
    if (!racine) return;
    const sections = Array.from(racine.querySelectorAll<HTMLElement>("section[id]"));
    setSommaire(
      sections.map((section) => {
        const { numero, libelle } = decouperTitre(section.querySelector("h2")?.textContent ?? "");
        return { id: section.id, numero, libelle };
      })
    );
    const mots = (racine.textContent ?? "").split(/\s+/).filter(Boolean).length;
    setMinutes(Math.max(1, Math.ceil(mots / MOTS_PAR_MINUTE)));
    // Arrivée par un lien vers une section : les ancres n'existaient pas encore au chargement de la page.
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [pathname, hash, children]);

  // La section affichée au centre de l'écran est celle du sommaire en gras.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || sommaire.length === 0) return;
    const observateur = new IntersectionObserver(
      (entrees) => {
        for (const entree of entrees) if (entree.isIntersecting) setActif(entree.target.id);
      },
      { rootMargin: "-20% 0px -70% 0px" }
    );
    for (const { id } of sommaire) {
      const element = document.getElementById(id);
      if (element) observateur.observe(element);
    }
    return () => observateur.disconnect();
  }, [sommaire]);

  async function copierLeLien() {
    if (await copier(`${window.location.origin}${pathname}`)) {
      setLienCopie(true);
      setTimeout(() => setLienCopie(false), 1800);
    }
  }

  const sommaireListe = (
    <ol className="border border-slate-300 bg-white">
      {sommaire.map((entree) => (
        <li key={entree.id} className="border-b border-slate-200 last:border-b-0">
          <a
            href={`#${entree.id}`}
            aria-current={actif === entree.id ? "location" : undefined}
            className={`flex items-baseline gap-3 px-3 py-2 text-xs transition-colors ${
              actif === entree.id ? "bg-ink-900 font-semibold text-white" : "text-slate-800 hover:bg-slate-50 hover:text-ink-900"
            }`}
          >
            {entree.numero && <span aria-hidden="true" className={`font-mono text-[10px] ${actif === entree.id ? "text-orange-300" : "text-orange-700"}`}>{entree.numero}</span>}
            <span>{entree.libelle}</span>
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="relative isolate min-h-screen text-slate-900">
      <Seo title={`${title} | ${COMPANY.tradeName}`} description={description} canonical={pathname} />
      <nav className="sticky top-0 z-10 border-b-2 border-ink-900 bg-white print:hidden">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-3">
            <Logo taille={28} />
            <span className="font-mono text-sm font-semibold uppercase tracking-wider text-ink-900">{COMPANY.tradeName}</span>
          </Link>
          <Link to="/" className="border-b border-ink-900/40 pb-0.5 text-xs font-semibold text-ink-900 transition-colors hover:border-orange-700 hover:text-orange-700">
            ← Retour à l'accueil
          </Link>
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {/* Les trois documents, en onglets. */}
        <div className="mb-8 flex flex-wrap border border-slate-400 bg-white sm:inline-flex print:hidden">
          {LEGAL_PAGES.map((page) => (
            <Link
              key={page.to}
              to={page.to}
              aria-current={pathname === page.to ? "page" : undefined}
              className={`flex-1 whitespace-nowrap border-r border-slate-400 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors last:border-r-0 sm:flex-none ${
                pathname === page.to ? "bg-ink-900 text-white" : "text-slate-800 hover:bg-slate-100"
              }`}
            >
              {page.label}
            </Link>
          ))}
        </div>

        {/* En-tête du document, comme un cartouche : titre, date, durée de lecture, et ce qu'on peut en faire. */}
        <header className="mb-8 border border-slate-300 bg-white">
          <div aria-hidden="true" className="bande-motif h-2" />
          <div className="flex flex-wrap items-end justify-between gap-4 p-6">
            <div>
              {rang >= 0 && (
                <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-orange-700">
                  Document {String(rang + 1).padStart(2, "0")} / {String(LEGAL_PAGES.length).padStart(2, "0")}
                </p>
              )}
              <h1 className="mt-1 text-2xl font-bold text-ink-900">{title}</h1>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-slate-600">
                Dernière mise à jour : {COMPANY.lastUpdated}
                {minutes !== null && ` · Lecture : environ ${minutes} min`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <button
                type="button"
                onClick={copierLeLien}
                className="inline-flex cursor-pointer items-center gap-1.5 border border-slate-400 bg-white px-3 py-2 text-xs font-semibold text-slate-800 transition-colors hover:border-ink-900"
              >
                {lienCopie ? <Check size={13} aria-hidden="true" /> : <Link2 size={13} aria-hidden="true" />}
                {lienCopie ? "Lien copié" : "Copier le lien"}
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex cursor-pointer items-center gap-1.5 bg-ink-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-orange-700"
              >
                <Printer size={13} aria-hidden="true" />
                Imprimer ou enregistrer en PDF
              </button>
            </div>
          </div>
        </header>

        <div className="grid items-start gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
          {sommaire.length > 1 && (
            <>
              {/* Écran large : le sommaire reste en vue pendant la lecture. */}
              <nav aria-label="Sommaire" className="sticky top-24 hidden lg:block print:hidden">
                <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">Sommaire</p>
                {sommaireListe}
              </nav>
              {/* Téléphone : le même sommaire, replié. */}
              <details className="border border-slate-300 bg-white lg:hidden print:hidden">
                <summary className="cursor-pointer px-4 py-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-900">Sommaire</summary>
                <div className="p-3 pt-0">{sommaireListe}</div>
              </details>
            </>
          )}

          <div className={sommaire.length > 1 ? "" : "lg:col-span-2"}>
            <div ref={contenu} className="max-w-3xl space-y-8 text-sm leading-relaxed text-slate-700">
              {children}
            </div>

            {/* D'un document à l'autre. */}
            {(precedent || suivant) && (
              <div className="mt-12 grid max-w-3xl gap-px border border-slate-300 bg-slate-300 sm:grid-cols-2 print:hidden">
                {precedent ? (
                  <Link to={precedent.to} className="group flex items-center gap-3 bg-white px-4 py-3 text-xs font-semibold text-ink-900 transition-colors hover:bg-slate-50">
                    <ArrowLeft size={14} aria-hidden="true" className="transition-transform group-hover:-translate-x-0.5" />
                    <span>
                      <span className="block font-mono text-[10px] font-normal uppercase tracking-wider text-slate-600">Précédent</span>
                      {precedent.label}
                    </span>
                  </Link>
                ) : (
                  <span className="bg-white" />
                )}
                {suivant ? (
                  <Link to={suivant.to} className="group flex items-center justify-end gap-3 bg-white px-4 py-3 text-right text-xs font-semibold text-ink-900 transition-colors hover:bg-slate-50">
                    <span>
                      <span className="block font-mono text-[10px] font-normal uppercase tracking-wider text-slate-600">Suivant</span>
                      {suivant.label}
                    </span>
                    <ArrowRight size={14} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
                  </Link>
                ) : (
                  <span className="bg-white" />
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      <div className="print:hidden">
        <PiedDeSite
          etroit
          mentions={
            <p>
              © 2026 {COMPANY.tradeName}. {COMPANY.legalStatus}.
            </p>
          }
        />
      </div>
    </div>
  );
}
