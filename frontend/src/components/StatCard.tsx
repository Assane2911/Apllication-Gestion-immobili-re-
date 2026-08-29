import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  accent?: "blue" | "green" | "amber" | "red";
  icon?: LucideIcon;
}

const accentClasses: Record<NonNullable<StatCardProps["accent"]>, string> = {
  blue: "bg-brand-50 text-brand-700",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
};

export default function StatCard({ label, value, hint, accent = "blue", icon: Icon }: StatCardProps) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-slate-500">{label}</p>
        {Icon && (
          <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${accentClasses[accent]}`}>
            <Icon size={18} strokeWidth={2} />
          </div>
        )}
      </div>
      <p className={`mt-2 text-2xl font-semibold ${accentClasses[accent].split(" ")[1]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
