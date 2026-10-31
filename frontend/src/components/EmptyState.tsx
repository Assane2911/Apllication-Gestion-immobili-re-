import { Users } from "lucide-react";
import type { ReactNode } from "react";

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
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 bg-white rounded-2xl border border-dashed border-slate-300">
      {/* Un plan en pointillés, encore à remplir, derrière l'icône. */}
      <div className="relative mb-4 flex h-24 w-32 items-center justify-center">
        <svg aria-hidden="true" viewBox="0 0 112 84" fill="none" className="absolute inset-0 h-full w-full text-ink-900/30">
          <path d="M2 2H110V82H2Z M2 42H56 M56 2V82 M56 56H110" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" />
        </svg>
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 text-2xl">
          {isComponent ? <Icon size={26} strokeWidth={1.75} /> : Icon || <Users size={26} strokeWidth={1.75} />}
        </div>
      </div>
      <h3 className="font-bold text-slate-900 text-base">{title}</h3>
      {description && <p className="text-xs text-slate-600 mt-1 max-w-sm">{description}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-sm transition-colors cursor-pointer"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

