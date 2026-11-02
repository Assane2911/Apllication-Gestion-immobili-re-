import type { FiltreListe } from "./BarreListe";

/**
 * Filtres en onglets (boutons à bascule, `aria-pressed`) avec leur effectif, sans barre de recherche : pour les listes
 * courtes de l'espace locataire. Même aspect que les filtres de `BarreListe`.
 */
export default function GroupeFiltres({ libelle, filtres, actif, onChange }: { libelle: string; filtres: FiltreListe[]; actif: string; onChange: (cle: string) => void }) {
  return (
    <div role="group" aria-label={libelle} className="flex flex-wrap border border-slate-400 sm:inline-flex">
      {filtres.map((f) => (
        <button
          key={f.cle}
          type="button"
          aria-pressed={actif === f.cle}
          onClick={() => onChange(f.cle)}
          className={`flex flex-1 cursor-pointer items-center justify-center gap-2 whitespace-nowrap border-r border-slate-400 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider last:border-r-0 sm:flex-none ${
            actif === f.cle ? "bg-ink-900 text-white" : "bg-white text-slate-800 hover:bg-slate-100"
          }`}
        >
          {f.libelle}{" "}
          {f.compte !== undefined && <span className={`tabular-nums ${actif === f.cle ? "text-orange-300" : "text-orange-700"}`}>{f.compte}</span>}
        </button>
      ))}
    </div>
  );
}
