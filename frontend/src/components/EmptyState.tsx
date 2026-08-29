import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

/** Bloc affiché à la place d'une liste/tableau vide, avec un appel à l'action clair. */
export default function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 bg-white rounded-xl border border-dashed border-slate-300">
      <div className="w-14 h-14 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center mb-4">
        <Icon size={26} strokeWidth={1.75} />
      </div>
      <h3 className="font-medium text-slate-900">{title}</h3>
      {description && <p className="text-sm text-slate-500 mt-1 max-w-sm">{description}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
