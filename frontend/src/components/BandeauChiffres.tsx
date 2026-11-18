import type { ReactNode } from "react";
import { Skeleton } from "./Skeleton";

export interface CaseChiffre {
  libelle: string;
  valeur: ReactNode;
  /** Précision sous le chiffre (« 3 biens », « sur cette page »). */
  aide?: string;
  /** `alerte` colore le chiffre en orange : quelque chose demande l'attention. */
  ton?: "normal" | "alerte";
}

/**
 * Bandeau de chiffres clés en tête d'une liste : des cases collées par un filet, libellé technique puis valeur.
 *
 * Le fond de la grille est le filet (gris) : une dernière rangée incomplète — trois chiffres sur quatre colonnes — le
 * laissait apparaître comme une case grise vide. Des cases de remplissage, blanches et muettes, complètent la rangée à
 * chaque largeur (deux colonnes sur téléphone, quatre au-delà).
 */
export default function BandeauChiffres({ cases, etiquette }: { cases: CaseChiffre[]; etiquette: string }) {
  const videsMobile = (2 - (cases.length % 2)) % 2;
  const videsLarge = (4 - (cases.length % 4)) % 4;
  return (
    <dl aria-label={etiquette} className="grid grid-cols-2 gap-px border border-slate-300 bg-slate-300 lg:grid-cols-4">
      {cases.map((c) => (
        <div key={c.libelle} className="bg-white p-4">
          <dt className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">{c.libelle}</dt>
          <dd className={`mt-1.5 text-lg font-bold tabular-nums ${c.ton === "alerte" ? "text-orange-700" : "text-ink-900"}`}>{c.valeur}</dd>
          {c.aide && <dd className="mt-0.5 text-xs text-slate-600">{c.aide}</dd>}
        </div>
      ))}
      {Array.from({ length: Math.max(videsMobile, videsLarge) }, (_, i) => (
        <div
          key={`vide-${i}`}
          data-remplissage=""
          aria-hidden="true"
          className={`bg-white ${i < videsMobile ? "" : "max-lg:hidden"} ${i < videsLarge ? "" : "lg:hidden"}`}
        />
      ))}
    </dl>
  );
}

/**
 * Place réservée au bandeau pendant le chargement de la liste, aux mêmes dimensions que le vrai (quatre cases, deux colonnes sur
 * téléphone). Sans elle, le bandeau s'insérait au-dessus de la liste à l'arrivée des données et la repoussait de 100 à 240 px :
 * un décalage de mise en page (CLS) de 0,15 à 0,6 mesuré sur les listes de factures, d'incidents, de locataires, de biens,
 * de propriétaires et de dépenses. À retirer dès que le chargement est fini, qu'il y ait des chiffres à montrer ou non.
 */
export function BandeauChiffresSquelette() {
  return (
    <div aria-hidden="true" data-squelette-bandeau="" className="grid grid-cols-2 gap-px border border-slate-300 bg-slate-300 lg:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="min-h-[6.25rem] bg-white p-4 max-lg:min-h-[6.5rem]">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="mt-2.5 h-5 w-24" />
          <Skeleton className="mt-2.5 h-3 w-28" />
        </div>
      ))}
    </div>
  );
}
