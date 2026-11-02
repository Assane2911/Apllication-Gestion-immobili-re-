import { Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export interface FiltreListe {
  cle: string;
  libelle: string;
  /** Effectif du filtre ; absent quand il n'est pas connu d'avance (filtre appliqué par le serveur). */
  compte?: number;
}

interface BarreListeProps {
  /** Préfixe des identifiants (plusieurs barres ne partagent jamais d'id). */
  idPrefixe: string;
  recherche: string;
  onRecherche: (valeur: string) => void;
  placeholderRecherche: string;
  filtres?: FiltreListe[];
  filtreActif?: string;
  onFiltre?: (cle: string) => void;
  libelleFiltres?: string;
  tri?: { libelle: string; valeur: string; options: Array<{ valeur: string; libelle: string }>; onChange: (valeur: string) => void };
  /** Actions à droite (bascule de vue, export…). */
  children?: ReactNode;
}

/**
 * Barre d'outils des listes de l'espace gestionnaire : recherche, filtres en onglets avec leur effectif, tri, et les
 * actions propres à la page. Les filtres sont des boutons à bascule (`aria-pressed`) plutôt qu'un menu : on voit d'un
 * coup d'œil combien d'éléments chacun garde.
 */
export default function BarreListe({ idPrefixe, recherche, onRecherche, placeholderRecherche, filtres, filtreActif, onFiltre, libelleFiltres, tri, children }: BarreListeProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 border border-slate-300 bg-white p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-56 flex-1">
          <label htmlFor={`${idPrefixe}-recherche`} className="sr-only">
            {placeholderRecherche}
          </label>
          <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            id={`${idPrefixe}-recherche`}
            type="search"
            value={recherche}
            onChange={(e) => onRecherche(e.target.value)}
            placeholder={placeholderRecherche}
            className="w-full border border-slate-300 bg-white py-2 pl-9 pr-9 text-sm text-slate-900 [&::-webkit-search-cancel-button]:hidden"
          />
          {recherche && (
            <button
              type="button"
              onClick={() => onRecherche("")}
              aria-label={t("manager.liste.clearSearch")}
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center text-slate-500 hover:text-ink-900"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        {tri && (
          <div>
            <label htmlFor={`${idPrefixe}-tri`} className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-600">
              {tri.libelle}
            </label>
            <select id={`${idPrefixe}-tri`} value={tri.valeur} onChange={(e) => tri.onChange(e.target.value)} className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
              {tri.options.map((o) => (
                <option key={o.valeur} value={o.valeur}>
                  {o.libelle}
                </option>
              ))}
            </select>
          </div>
        )}
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      </div>
      {filtres && filtres.length > 0 && onFiltre && (
        <div role="group" aria-label={libelleFiltres} className="flex flex-wrap border border-slate-400 sm:inline-flex">
          {filtres.map((f) => (
            <button
              key={f.cle}
              type="button"
              aria-pressed={filtreActif === f.cle}
              onClick={() => onFiltre(f.cle)}
              className={`flex flex-1 cursor-pointer items-center justify-center gap-2 whitespace-nowrap border-r border-slate-400 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider last:border-r-0 sm:flex-none ${
                filtreActif === f.cle ? "bg-ink-900 text-white" : "bg-white text-slate-800 hover:bg-slate-100"
              }`}
            >
              {f.libelle}
              {f.compte !== undefined && <span className={`tabular-nums ${filtreActif === f.cle ? "text-orange-300" : "text-orange-700"}`}>{f.compte}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
