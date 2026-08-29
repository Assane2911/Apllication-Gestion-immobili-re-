const styles: Record<string, string> = {
  AVAILABLE: "bg-emerald-100 text-emerald-700",
  OCCUPIED: "bg-brand-100 text-brand-700",
  MAINTENANCE: "bg-amber-100 text-amber-700",
  ACTIVE: "bg-emerald-100 text-emerald-700",
  ENDED: "bg-slate-200 text-slate-600",
  TERMINATED: "bg-red-100 text-red-700",
  PENDING: "bg-amber-100 text-amber-700",
  PAID: "bg-emerald-100 text-emerald-700",
  LATE: "bg-red-100 text-red-700",
  CANCELLED: "bg-slate-200 text-slate-600",
  OPEN: "bg-red-100 text-red-700",
  IN_PROGRESS: "bg-amber-100 text-amber-700",
  RESOLVED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-slate-200 text-slate-600",
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
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] ?? "bg-slate-100 text-slate-600"}`}>
      {labels[status] ?? status}
    </span>
  );
}
