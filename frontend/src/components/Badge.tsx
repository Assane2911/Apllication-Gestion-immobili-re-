import { useTranslation } from "react-i18next";

const styles: Record<string, string> = {
  AVAILABLE: "bg-emerald-50 text-emerald-700 border-emerald-200/80",
  OCCUPIED: "bg-brand-50 text-brand-700 border-brand-200/80",
  MAINTENANCE: "bg-amber-50 text-amber-700 border-amber-200/80",
  ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200/80",
  ENDED: "bg-slate-100 text-slate-600 border-contour-200",
  TERMINATED: "bg-red-50 text-red-700 border-red-200/80",
  PENDING: "bg-amber-50 text-amber-700 border-amber-200/80",
  PAID: "bg-emerald-50 text-emerald-700 border-emerald-200/80",
  LATE: "bg-rose-50 text-rose-700 border-rose-200/80",
  CANCELLED: "bg-slate-100 text-slate-600 border-contour-200",
  OPEN: "bg-rose-50 text-rose-700 border-rose-200/80",
  IN_PROGRESS: "bg-amber-50 text-amber-700 border-amber-200/80",
  RESOLVED: "bg-emerald-50 text-emerald-700 border-emerald-200/80",
  REJECTED: "bg-slate-100 text-slate-600 border-contour-200",
  DRAFT: "bg-amber-50 text-amber-700 border-amber-200/80",
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200/80",
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
  DRAFT: "bg-amber-500",
  COMPLETED: "bg-emerald-500",
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
        styles[status] ?? "bg-slate-100 text-slate-600 border-contour-200"
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
