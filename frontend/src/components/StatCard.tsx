interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  accent?: "blue" | "green" | "amber" | "red";
}

const accentClasses: Record<NonNullable<StatCardProps["accent"]>, string> = {
  blue: "bg-brand-50 text-brand-700",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
};

export default function StatCard({ label, value, hint, accent = "blue" }: StatCardProps) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${accentClasses[accent].split(" ")[1]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
