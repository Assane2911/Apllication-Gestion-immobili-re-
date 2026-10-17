import type { PropertyStatus } from "../../types";

/** Couleurs des graphiques, dans un fichier à part : les pages les lisent sans charger la bibliothèque de graphiques. */
export const COULEUR_REVENUS = "#2563eb";
export const COULEUR_DEPENSES = "#f59e0b";
export const COULEURS_STATUT: Record<PropertyStatus, string> = {
  AVAILABLE: "#10b981",
  OCCUPIED: "#2563eb",
  MAINTENANCE: "#f59e0b",
};
