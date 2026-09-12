import { useTranslation } from "react-i18next";

const styles: Record<string, string> = {
  AVAILABLE: "bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20",
  OCCUPIED: "bg-brand-50 text-brand-700 border-brand-200/80 dark:bg-brand-500/10 dark:text-brand-300 dark:border-brand-500/20",
  MAINTENANCE: "bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20",
  ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20",
  ENDED: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/60 dark:text-slate-400 dark:border-slate-700/60",
  TERMINATED: "bg-red-50 text-red-700 border-red-200/80 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/20",
  PENDING: "bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20",
  PAID: "bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20",
  LATE: "bg-rose-50 text-rose-700 border-rose-200/80 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20",
  CANCELLED: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/60 dark:text-slate-400 dark:border-slate-700/60",
  OPEN: "bg-rose-50 text-rose-700 border-rose-200/80 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20",
  IN_PROGRESS: "bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20",
  RESOLVED: "bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20",
  REJECTED: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/60 dark:text-slate-400 dark:border-slate-700/60",
};

const dotStyles: Record<string, string> = {
  AVAILABLE: "bg-emerald-500",
  OCCUPIED: "bg-brand-500",
  MAINTENANCE: "bg-amber-500",
  ACTIVE: "bg-emerald-500",
  ENDED: "bg-slate-400",
  TERMINATED: "bg-red-500",
  PENDING: "bg-amber-500",
  PAID: "bg-emerald-500",
  LATE: "bg-rose-500",
  CANCELLED: "bg-slate-400",
  OPEN: "bg-rose-500",
  IN_PROGRESS: "bg-amber-500",
  RESOLVED: "bg-emerald-500",
  REJECTED: "bg-slate-400",
};

const shouldPulse: Record<string, boolean> = {
  LATE: true,
  OPEN: true,
};

export default function Badge({ status }: { status: string }) {
  const { t } = useTranslation();
  const label = t(`common.status.${status}`, { defaultValue: status });
  const pulse = shouldPulse[status] ?? false;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border shadow-2xs tracking-tight ${
        styles[status] ?? "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
      }`}
    >
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        {pulse && (
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${dotStyles[status] ?? "bg-slate-400"}`} />
        )}
        <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${dotStyles[status] ?? "bg-slate-400"}`} />
      </span>
      {label}
    </span>
  );
}
