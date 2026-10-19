import type { Role } from "../types";

/**
 * Déconnexion à l'inactivité (web). Doit rester d'accord avec backend/src/utils/session.ts : le serveur fait
 * respecter ces durées par un cookie court, l'interface prévient et déconnecte proprement avant que le serveur ne
 * réponde 401.
 */
export const DUREE_INACTIVITE_ADMIN_MS = 15 * 60_000;
export const DUREE_INACTIVITE_MS = 30 * 60_000;
/** Délai d'avertissement avant la déconnexion. */
export const AVERTISSEMENT_MS = 60_000;
/** Au plus un renouvellement de session par minute, quel que soit le nombre de gestes. */
export const INTERVALLE_RENOUVELLEMENT_MS = 60_000;
/** Dernière activité, partagée entre les onglets d'un même navigateur. */
export const CLE_DERNIERE_ACTIVITE = "derniereActivite";

export function dureeInactiviteMs(role: Role): number {
  return role === "ADMIN" ? DUREE_INACTIVITE_ADMIN_MS : DUREE_INACTIVITE_MS;
}
