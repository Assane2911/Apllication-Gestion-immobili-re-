/**
 * Maintient la fonction en vie jusqu'à la fin d'un travail lancé « en arrière-plan » (sans que la réponse l'attende).
 *
 * Sur Vercel, une fonction peut être figée dès que la réponse est partie : un envoi SMTP lancé sans `await` n'aboutit
 * alors jamais, et ne laisse aucune trace — c'est ainsi que « mot de passe oublié » posait son jeton, répondait 200, et
 * n'envoyait rien. `waitUntil` prolonge la vie de la fonction jusqu'à la fin de la promesse, sans retarder la réponse
 * (même durée pour une adresse connue et inconnue : pas de fuite d'énumération de comptes).
 *
 * Vercel place son contexte de requête dans un symbole global ; c'est exactement ce que lit son paquet
 * `@vercel/functions`, qu'on n'ajoute pas ici : il apporte à lui seul des dépendances à avis de sécurité élevés
 * (`@vercel/oidc`), alors que les dépendances de production sont à zéro avis. Hors de Vercel (local, tests) le
 * contexte est absent : la fonction ne fait rien et Node mène la promesse à son terme, comme avant.
 *
 * La promesse reçue doit déjà traiter ses propres échecs (`.catch`) : une promesse qui se terminerait en erreur serait
 * une erreur non gérée.
 */
const CONTEXTE_REQUETE_VERCEL = Symbol.for("@vercel/request-context");

export function enArrierePlan(promesse: Promise<unknown>): void {
  try {
    const contexte = (globalThis as unknown as Record<symbol, { get?: () => { waitUntil?: (p: Promise<unknown>) => void } | undefined } | undefined>)[CONTEXTE_REQUETE_VERCEL];
    const prolonger = contexte?.get?.()?.waitUntil;
    if (typeof prolonger === "function") prolonger(promesse);
  } catch {
    // Un contexte qui se comporte mal ne doit jamais faire échouer la requête : l'envoi continue comme avant.
  }
}
