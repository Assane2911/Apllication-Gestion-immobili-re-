/**
 * Date ET heure d'un instant (création d'un compte, d'une demande…), dans la langue de l'interface et, par défaut,
 * le fuseau de l'appareil : « 21/10/2026 15:07 ». Un jour calendaire (fin d'essai, échéance) n'a pas d'heure : voir
 * jourCivil.ts.
 *
 * `fuseau` : pour forcer un fuseau (les tests, ou un affichage en UTC).
 */
export function formaterDateHeure(valeur: string | Date, langue: string, fuseau?: string): string {
  return new Date(valeur).toLocaleString(langue, { dateStyle: "short", timeStyle: "short", ...(fuseau ? { timeZone: fuseau } : {}) });
}

/**
 * Même chose en toutes lettres, pour une phrase : « 5 novembre 2026 à 15:07 », « November 5, 2026 at 3:07 PM ».
 */
export function formaterDateHeureLongue(valeur: string | Date, langue: string, fuseau?: string): string {
  return new Date(valeur).toLocaleString(langue, { dateStyle: "long", timeStyle: "short", ...(fuseau ? { timeZone: fuseau } : {}) });
}
