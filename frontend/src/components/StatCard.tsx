import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  accent?: "blue" | "green" | "amber" | "red";
  icon?: LucideIcon;
}

const accentClasses: Record<NonNullable<StatCardProps["accent"]>, string> = {
  blue: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-400",
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  red: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400",
};

const valueTextClasses: Record<NonNullable<StatCardProps["accent"]>, string> = {
  blue: "text-brand-700 dark:text-brand-400",
  green: "text-emerald-700 dark:text-emerald-400",
  amber: "text-amber-700 dark:text-amber-400",
  red: "text-red-700 dark:text-red-400",
};

export default function StatCard({ label, value, hint, accent = "blue", icon: Icon }: StatCardProps) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm hover:shadow-md dark:shadow-none transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
        {Icon && (
          <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${accentClasses[accent]}`}>
            <Icon size={18} strokeWidth={2} />
          </div>
        )}
      </div>
      <p className={`mt-2 text-2xl font-semibold ${valueTextClasses[accent]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  );
}
