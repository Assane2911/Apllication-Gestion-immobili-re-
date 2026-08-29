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
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
      <div className="w-14 h-14 rounded-2xl bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-400 flex items-center justify-center mb-4 text-2xl">
        {isComponent ? <Icon size={26} strokeWidth={1.75} /> : Icon || "👥"}
      </div>
      <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">{title}</h3>
      {description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">{description}</p>}
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

