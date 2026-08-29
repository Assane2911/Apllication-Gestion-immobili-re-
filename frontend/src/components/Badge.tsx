const styles: Record<string, string> = {
  AVAILABLE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  OCCUPIED: "bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-400",
  MAINTENANCE: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  ACTIVE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  ENDED: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
  TERMINATED: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
  PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  PAID: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  LATE: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
  CANCELLED: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
  OPEN: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
  IN_PROGRESS: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  RESOLVED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  REJECTED: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
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
  LATE: "bg-red-500",
  CANCELLED: "bg-slate-400",
  OPEN: "bg-red-500",
  IN_PROGRESS: "bg-amber-500",
  RESOLVED: "bg-emerald-500",
  REJECTED: "bg-slate-400",
};

const labels: Record<string, string> = {
  AVAILABLE: "Disponible",
  OCCUPIED: "Occupé",
  MAINTENANCE: "Maintenance",
  ACTIVE: "Actif",
  ENDED: "Terminé",
  TERMINATED: "Résilié",
  PENDING: "En attente",
  PAID: "Réglée",
  LATE: "En retard",
  CANCELLED: "Annulée",
  OPEN: "Ouvert",
  IN_PROGRESS: "En cours",
  RESOLVED: "Résolu",
  REJECTED: "Rejeté",
};

export default function Badge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
        styles[status] ?? "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotStyles[status] ?? "bg-slate-400"}`} />
      {labels[status] ?? status}
    </span>
  );
}
