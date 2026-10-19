/**
 * Délai maximal d'un appel à un prestataire externe (Meta, Stripe, PayDunya).
 *
 * `fetch` n'a aucun délai propre : un prestataire dont la connexion se fige laissait la fonction attendre
 * jusqu'à ce que Vercel la tue — pour un paiement, l'utilisateur voyait un écran figé ; pour le cron, tout
 * le reste du lot était perdu (le budget de temps du cron ne protège qu'ENTRE deux éléments, jamais au
 * milieu d'un appel). 15 s laisse largement passer un appel normal et reste bien en deçà de la marge que
 * le budget du cron laisse avant la limite de la fonction (300 s − 240 s).
 */
export const DELAI_APPEL_EXTERNE_MS = 15_000;

/**
 * `fetch` interrompu au bout de `delaiMs`. L'interruption se manifeste comme n'importe quel échec réseau
 * (la promesse est rejetée) : les appelants, qui capturent déjà ce cas, n'ont rien d'autre à gérer.
 */
export function fetchAvecDelai(url: string, init: RequestInit = {}, delaiMs: number = DELAI_APPEL_EXTERNE_MS): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(delaiMs) });
}
