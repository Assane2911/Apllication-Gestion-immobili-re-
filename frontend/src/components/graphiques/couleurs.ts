import type { PropertyStatus } from "../../types";

/** Couleurs des graphiques, dans un fichier à part : les pages les lisent sans charger la bibliothèque de graphiques. */
export const COULEUR_REVENUS = "#124a73";
export const COULEUR_DEPENSES = "#d9480f";
export const COULEURS_STATUT: Record<PropertyStatus, string> = {
  AVAILABLE: "#2b8a6e",
  OCCUPIED: "#124a73",
  MAINTENANCE: "#d9480f",
};
