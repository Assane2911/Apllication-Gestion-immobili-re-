export type ManagerStatus = "TRIAL" | "ACTIVE" | "CANCELLED" | "EXPIRED";
export type ManagerPlan = "STARTER" | "PRO" | "ENTERPRISE";

/** Couleur du badge de statut d'abonnement, partagée par la liste et la fiche gestionnaire. */
export const STATUS_CLASSES: Record<ManagerStatus, string> = {
  TRIAL: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  ACTIVE: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  CANCELLED: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  EXPIRED: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
};
