import type { ReactNode } from "react";

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
