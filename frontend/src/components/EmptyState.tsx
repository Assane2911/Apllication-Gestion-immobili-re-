import { Users } from "lucide-react";
import type { ReactNode } from "react";
import { BOUTON_PLEIN } from "./styleFormulaire";

interface EmptyStateProps {
  icon?: ReactNode | any;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

/** Bloc affiché à la place d'une liste/tableau vide, avec un appel à l'action clair. */
export default function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  const isComponent = typeof Icon === "function" || (typeof Icon === "object" && Icon !== null && "$$typeof" in Icon);

  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-16 bg-white border border-dashed border-slate-400">
      {/* Un plan en pointillés, encore à remplir, derrière l'icône. */}
      <div className="relative mb-4 flex h-24 w-32 items-center justify-center">
        <svg aria-hidden="true" viewBox="0 0 112 84" fill="none" className="absolute inset-0 h-full w-full text-ink-900/30">
          <path d="M2 2H110V82H2Z M2 42H56 M56 2V82 M56 56H110" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" />
        </svg>
        <div className="relative flex h-14 w-14 items-center justify-center border border-ink-900 bg-white text-ink-900 text-2xl">
          {isComponent ? <Icon size={26} strokeWidth={1.75} /> : Icon || <Users size={26} strokeWidth={1.75} />}
        </div>
      </div>
      <h3 className="font-bold text-slate-900 text-base">{title}</h3>
      {description && <p className="text-xs text-slate-600 mt-1 max-w-sm">{description}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className={`mt-5 ${BOUTON_PLEIN}`}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

