import { useTranslation } from "react-i18next";

/**
 * Pastille de statut, en carré à trait net comme le reste de l'espace. Trois registres : l'encre pour ce qui va bien
 * (loué, payé, actif), l'orange pour ce qui attend ou presse (à louer, en retard, ouvert), le gris pour ce qui est clos.
 */
const ENCRE = "border-ink-900 bg-white text-ink-900";
const ENCRE_PLEIN = "border-ink-900 bg-ink-900 text-white";
const ATTENTE = "border-orange-300 bg-orange-50 text-orange-900";
const ALERTE = "border-orange-700 bg-orange-700 text-white";
const CLOS = "border-slate-300 bg-slate-100 text-slate-600";

const styles: Record<string, string> = {
  AVAILABLE: ATTENTE,
  OCCUPIED: ENCRE_PLEIN,
  MAINTENANCE: CLOS,
  ACTIVE: ENCRE,
  ENDED: CLOS,
  TERMINATED: CLOS,
  PENDING: ATTENTE,
  PAID: ENCRE,
  LATE: ALERTE,
  CANCELLED: CLOS,
  OPEN: ALERTE,
  IN_PROGRESS: ATTENTE,
  RESOLVED: ENCRE,
  REJECTED: CLOS,
  DRAFT: ATTENTE,
  COMPLETED: ENCRE,
};

export default function Badge({ status }: { status: string }) {
  const { t } = useTranslation();
  const label = t(`common.status.${status}`, { defaultValue: status });

  return (
    <span className={`inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${styles[status] ?? CLOS}`}>
      <span aria-hidden="true" className="size-1.5 shrink-0 bg-current" />
      {label}
    </span>
  );
}
