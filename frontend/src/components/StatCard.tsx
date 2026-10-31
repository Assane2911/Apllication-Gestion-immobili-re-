import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  accent?: "blue" | "green" | "amber" | "red";
  icon?: LucideIcon;
}

const accentClasses: Record<NonNullable<StatCardProps["accent"]>, string> = {
  blue: "bg-brand-50 text-brand-600 border-brand-200/60 dark:bg-brand-500/10 dark:text-brand-400 dark:border-brand-500/20",
  green: "bg-emerald-50 text-emerald-600 border-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20",
  amber: "bg-amber-50 text-amber-600 border-amber-200/60 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
  red: "bg-rose-50 text-rose-600 border-rose-200/60 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20",
};

const valueTextClasses: Record<NonNullable<StatCardProps["accent"]>, string> = {
  blue: "text-slate-900 dark:text-white group-hover:text-brand-600 dark:group-hover:text-brand-400",
  green: "text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400",
  amber: "text-slate-900 dark:text-white group-hover:text-amber-600 dark:group-hover:text-amber-400",
  red: "text-slate-900 dark:text-white group-hover:text-rose-600 dark:group-hover:text-rose-400",
};

/** Couleur de la cote (ligne de dimension) posée au-dessus de chaque chiffre, comme sur une feuille de plan. */
const coteClasses: Record<NonNullable<StatCardProps["accent"]>, string> = {
  blue: "text-slate-900 dark:text-slate-300",
  green: "text-emerald-700 dark:text-emerald-400",
  amber: "text-orange-700 dark:text-orange-400",
  red: "text-orange-700 dark:text-orange-400",
};

export default function StatCard({ label, value, hint, accent = "blue", icon: Icon }: StatCardProps) {
  return (
    <div className="group relative bg-white dark:bg-slate-900/90 rounded-2xl border border-contour-200/90 dark:border-slate-800/90 p-5 shadow-xs hover:border-ink-900 dark:hover:border-slate-300 transition-colors duration-200 overflow-hidden">
      <div aria-hidden="true" className={`relative z-10 mb-3 flex items-center ${coteClasses[accent]}`}>
        <svg width="8" height="10" viewBox="0 0 8 10" className="shrink-0">
          <path d="M8 0V10M8 5H0M3 2L0 5L3 8" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        <div className="h-px flex-1 bg-current" />
        <svg width="8" height="10" viewBox="0 0 8 10" className="shrink-0">
          <path d="M0 0V10M0 5H8M5 2L8 5L5 8" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </div>

      <div className="flex items-start justify-between gap-3 relative z-10">
        <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-slate-600 dark:text-slate-400">{label}</p>
        {Icon && (
          <div className={`shrink-0 w-10 h-10 rounded-xl border flex items-center justify-center shadow-2xs transition-transform duration-200 group-hover:scale-105 ${accentClasses[accent]}`}>
            <Icon size={19} strokeWidth={2.2} />
          </div>
        )}
      </div>
      <p className={`mt-3 text-2xl sm:text-3xl font-bold tracking-tight transition-colors ${valueTextClasses[accent]}`}>
        {value}
      </p>
      {hint && <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1">{hint}</p>}
    </div>
  );
}
