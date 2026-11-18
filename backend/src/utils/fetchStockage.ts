/**
 * Délai maximal d'un appel au stockage de fichiers (Supabase Storage).
 *
 * Le client Supabase appelle `fetch`, qui n'a aucun délai propre : un stockage dont la connexion se fige laissait la
 * requête attendre jusqu'à ce que Vercel tue la fonction (300 s). Pour un dépôt de photo, la personne voyait un écran
 * figé ; pour une suppression de compte ou une purge, le travail s'arrêtait à mi-chemin. 30 s est le double du délai
 * des autres prestataires (voir fetchAvecDelai.ts) : un dépôt de plusieurs mégaoctets sur une connexion lente y tient
 * largement, et reste bien en deçà de la limite de la fonction.
 */
export const DELAI_STOCKAGE_MS = 30_000;

/**
 * `fetch` interrompu au bout de `delaiMs`, sans perdre l'interruption que l'appelant aurait lui-même demandée. Elle se
 * manifeste comme n'importe quel échec réseau (la promesse est rejetée) : le client Supabase la renvoie dans `error`,
 * que le code appelant traite déjà.
 */
export function creerFetchAvecDelai(delaiMs: number = DELAI_STOCKAGE_MS): typeof fetch {
  return (input, init) => {
    const delai = AbortSignal.timeout(delaiMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, delai]) : delai;
    return fetch(input, { ...init, signal });
  };
}
