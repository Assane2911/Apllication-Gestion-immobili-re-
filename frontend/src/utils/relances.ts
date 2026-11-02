/** Jours de retard auxquels partent les trois relances automatiques (même règle que le serveur). */
export function calendrierRelances(grace: string | number, intervalle: string | number): { first: number; second: number; third: number } {
  const g = Math.max(1, Number(grace) || 0);
  const i = Math.max(1, Number(intervalle) || 0);
  return { first: g, second: g + i, third: g + 2 * i };
}

/** Au-delà de ce retard (en jours), plus aucune relance automatique : la suite revient au gestionnaire. */
export const RETARD_MAX_RELANCE_JOURS = 90;
