/**
 * Arithmétique de CALENDRIER — par opposition à l'arithmétique d'instants.
 *
 * Une échéance de loyer, une fin de bail, un nombre de jours restants : ce
 * sont des notions de jour, pas d'horaire. Les calculer par différence de
 * timestamps (`(a - b) / 86_400_000`) donne un résultat faux une à deux fois
 * par an, au changement d'heure, et à chaque fois qu'un décalage de fuseau
 * s'invite entre la donnée stockée et le serveur qui la lit : un jour entier
 * bascule pour une heure d'écart. Les fonctions ci-dessous ne raisonnent donc
 * que sur les composantes année/mois/jour.
 */

/** Minuit au début du jour de `reference` (par défaut : aujourd'hui). */
export function debutDeLaJournee(reference: Date = new Date()): Date {
  return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
}

/** Minuit à la fin du jour de `reference`, soit 23:59:59.999. */
export function finDeLaJournee(reference: Date = new Date()): Date {
  return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate(), 23, 59, 59, 999);
}

/** Le même jour, décalé de `jours` (valeur négative acceptée), à minuit. */
export function jourDecale(jours: number, reference: Date = new Date()): Date {
  return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + jours);
}

/**
 * Nombre de jours de calendrier séparant `depuis` de `jusqu_a` — positif si
 * `jusqu_a` est postérieur. Le passage par Date.UTC neutralise l'heure d'été :
 * une journée UTC dure toujours exactement 24 heures.
 */
export function joursEntre(depuis: Date, jusqu_a: Date): number {
  const aMinuitUTC = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((aMinuitUTC(jusqu_a) - aMinuitUTC(depuis)) / 86_400_000);
}
