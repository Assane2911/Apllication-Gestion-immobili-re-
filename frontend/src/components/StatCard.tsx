import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  accent?: "blue" | "green" | "amber" | "red";
  icon?: LucideIcon;
  /** Page ouverte au clic : l'indicateur devient un raccourci vers le détail. */
  to?: string;
  /** Jauge de 0 à 100 sous le chiffre (taux d'occupation, part du loyer encaissé…). */
  progress?: number;
}

const accentClasses: Record<NonNullable<StatCardProps["accent"]>, string> = {
  blue: "bg-brand-50 text-brand-600 border-brand-200/60",
  green: "bg-emerald-50 text-emerald-600 border-emerald-200/60",
  amber: "bg-amber-50 text-amber-600 border-amber-200/60",
  red: "bg-rose-50 text-rose-600 border-rose-200/60",
};

const valueTextClasses: Record<NonNullable<StatCardProps["accent"]>, string> = {
  blue: "text-slate-900 group-hover:text-brand-600",
  green: "text-slate-900 group-hover:text-emerald-600",
  amber: "text-slate-900 group-hover:text-amber-600",
  red: "text-slate-900 group-hover:text-rose-600",
};

/** Couleur de la cote (ligne de dimension) posée au-dessus de chaque chiffre, comme sur une feuille de plan. */
const coteClasses: Record<NonNullable<StatCardProps["accent"]>, string> = {
  blue: "text-slate-900",
  green: "text-emerald-700",
  amber: "text-orange-700",
  red: "text-orange-700",
};

const jaugeClasses: Record<NonNullable<StatCardProps["accent"]>, string> = {
  blue: "bg-ink-900",
  green: "bg-emerald-700",
  amber: "bg-orange-700",
  red: "bg-orange-700",
};

export default function StatCard({ label, value, hint, accent = "blue", icon: Icon, to, progress }: StatCardProps) {
  const classes =
    "group relative block bg-white rounded-2xl border border-contour-200/90 p-5 shadow-xs hover:border-ink-900 transition-colors duration-200 overflow-hidden";
  const contenu = (
    <>
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
        <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-slate-600">{label}</p>
        {Icon && (
          <div className={`shrink-0 w-10 h-10 rounded-xl border flex items-center justify-center shadow-2xs transition-transform duration-200 group-hover:scale-105 ${accentClasses[accent]}`}>
            <Icon size={19} strokeWidth={2.2} />
          </div>
        )}
      </div>
      <p className={`mt-3 text-2xl sm:text-3xl font-bold tracking-tight transition-colors ${valueTextClasses[accent]}`}>
        {value}
      </p>
      {hint && <p className="mt-1.5 text-xs text-slate-600 flex items-center gap-1">{hint}</p>}
      {progress !== undefined && (
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(Math.max(0, Math.min(100, progress)))}
          className="relative z-10 mt-3 h-1.5 bg-slate-200"
        >
          <div className={`h-full ${jaugeClasses[accent]} transition-[width] duration-700 ease-out motion-reduce:transition-none`} style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      )}
      {to && (
        <span aria-hidden="true" className="absolute bottom-3 right-4 z-10 font-mono text-[11px] text-orange-700 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
          →
        </span>
      )}
    </>
  );
  return to ? (
    <Link to={to} className={`${classes} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900`}>
      {contenu}
    </Link>
  ) : (
    <div className={classes}>{contenu}</div>
  );
}
