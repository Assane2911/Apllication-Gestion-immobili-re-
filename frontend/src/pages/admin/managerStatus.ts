export type ManagerStatus = "TRIAL" | "ACTIVE" | "CANCELLED" | "EXPIRED";
export type ManagerPlan = "STARTER" | "PRO" | "ENTERPRISE";

/** Étiquette du statut d'abonnement (filet + fond teinté, angles droits), partagée par la liste et la fiche gestionnaire. */
export const STATUS_CLASSES: Record<ManagerStatus, string> = {
  TRIAL: "border border-sky-300 bg-sky-50 text-sky-900",
  ACTIVE: "border border-emerald-300 bg-emerald-50 text-emerald-900",
  CANCELLED: "border border-amber-300 bg-amber-50 text-amber-900",
  EXPIRED: "border border-rose-300 bg-rose-50 text-rose-900",
};

/** Badge « Suspendu » : se superpose au statut d'abonnement, qui reste affiché. */
export const SUSPENDED_CLASS = "border border-ink-900 bg-ink-900 text-white";

/** Étiquette de la formule : plus la formule est haute, plus elle est marquée. */
export const PLAN_CLASSES: Record<ManagerPlan, string> = {
  STARTER: "border border-slate-300 bg-white text-slate-800",
  PRO: "border border-ink-900 bg-white text-ink-900",
  ENTERPRISE: "border border-orange-700 bg-orange-50 text-orange-900",
};

/** Nombre de biens inclus par formule : table partagée avec l'accueil (voir data/lignesFormules.ts). */
export { PLAFOND_BIENS } from "../../data/lignesFormules";
