/**
 * Dates « de calendrier » : début et fin de bail, échéance, date d'une dépense, d'un état des lieux, d'une police,
 * date de visite souhaitée. L'API les enregistre à minuit UTC du jour choisi (une date saisie « 2026-03-01 » vaut
 * `2026-03-01T00:00:00.000Z`). Les lire avec le fuseau du navigateur les fait reculer d'un jour à l'ouest de
 * Greenwich (Brésil, Haïti, Antilles, Québec) : on lit donc toujours le jour en UTC, comme le fait le serveur
 * pour ses emails, ses documents et ses exports.
 *
 * Ne s'applique PAS aux instants réels (création, paiement, signature, envoi) : eux s'affichent à l'heure locale.
 */
export function formaterJour(valeur: string | number | Date, langue: string, options?: Intl.DateTimeFormatOptions): string {
  return new Date(valeur).toLocaleDateString(langue, { ...options, timeZone: "UTC" });
}

const MS_PAR_JOUR = 86_400_000;

/**
 * Nombre de jours entre AUJOURD'HUI (le jour de l'utilisateur, à son fuseau) et un jour de calendrier enregistré en
 * UTC. Négatif quand le jour est passé. Les deux jours sont ramenés à minuit UTC avant la soustraction, donc ni
 * l'heure ni un changement d'heure ne décalent le résultat.
 */
export function ecartEnJours(valeur: string | number | Date, maintenant: Date = new Date()): number {
  const jour = new Date(valeur);
  const cible = Date.UTC(jour.getUTCFullYear(), jour.getUTCMonth(), jour.getUTCDate());
  const aujourdhui = Date.UTC(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate());
  return Math.round((cible - aujourdhui) / MS_PAR_JOUR);
}
