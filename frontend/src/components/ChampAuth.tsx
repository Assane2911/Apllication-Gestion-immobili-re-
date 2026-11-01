import type { InputHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface ChampAuthProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  id: string;
  label: string;
  /** Pictogramme à gauche du champ. */
  icone?: LucideIcon;
  /** Élément posé à droite du champ (bouton afficher / masquer le mot de passe). */
  droite?: ReactNode;
  /** Ligne sous le champ : consigne, indicateur de validité. */
  aide?: ReactNode;
  className?: string;
}

/** Champ des pages de connexion et d'inscription : libellé en police technique, saisie à angles droits, filet d'encre au focus. */
export default function ChampAuth({ id, label, icone: Icone, droite, aide, className = "", ...saisie }: ChampAuthProps) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-700">
        {label}
      </label>
      <div className="relative">
        {Icone && (
          <span aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
            <Icone size={16} strokeWidth={1.8} />
          </span>
        )}
        <input
          id={id}
          {...saisie}
          className={`w-full border border-slate-400 bg-white py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-ink-900 focus:outline-none focus:ring-2 focus:ring-ink-900/20 ${
            Icone ? "pl-10" : "pl-3.5"
          } ${droite ? "pr-10" : "pr-3.5"}`}
        />
        {droite && <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{droite}</span>}
      </div>
      {aide}
    </div>
  );
}
