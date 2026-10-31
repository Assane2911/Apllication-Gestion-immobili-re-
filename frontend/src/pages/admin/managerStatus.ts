export type ManagerStatus = "TRIAL" | "ACTIVE" | "CANCELLED" | "EXPIRED";
export type ManagerPlan = "STARTER" | "PRO" | "ENTERPRISE";

/** Couleur du badge de statut d'abonnement, partagée par la liste et la fiche gestionnaire. */
export const STATUS_CLASSES: Record<ManagerStatus, string> = {
  TRIAL: "bg-sky-50 text-sky-700",
  ACTIVE: "bg-emerald-50 text-emerald-700",
  CANCELLED: "bg-amber-50 text-amber-700",
  EXPIRED: "bg-rose-50 text-rose-700",
};

/** Badge « Suspendu » : se superpose au statut d'abonnement, qui reste affiché. */
export const SUSPENDED_CLASS = "bg-slate-900 text-white";
