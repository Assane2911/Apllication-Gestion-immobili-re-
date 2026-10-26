import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { rechargementAssure, rechargementEnCours } from "./rechargementApresDeploiement";

/**
 * Remplace React.lazy() : si le chunk échoue à charger, recharge la page une
 * fois plutôt que de laisser l'erreur remonter jusqu'à l'ErrorBoundary — cas
 * classique d'un visiteur qui garde un onglet ouvert pendant qu'un nouveau
 * déploiement remplace les fichiers JS sous des noms différents (hash de
 * build changé), observé en production (Sentry : "Failed to fetch
 * dynamically imported module"). Le rechargement récupère le nouveau
 * manifeste et donc le bon chunk.
 *
 * Le garde-fou est celui de rechargementApresDeploiement.ts, PARTAGÉ avec
 * l'événement `vite:preloadError` et le filet d'erreurs : un seul
 * rechargement par minute pour ne jamais boucler si l'échec a une autre cause
 * (visiteur réellement hors ligne, etc.) — au deuxième échec dans la minute,
 * l'erreur remonte normalement jusqu'à l'ErrorBoundary. Deux garde-fous
 * séparés pouvaient recharger la page deux fois pour un même fichier manquant.
 */
export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const module = await factory();
      // Vite ne relève plus l'échec d'un préchargement quand l'écouteur de `vite:preloadError` appelle
      // `preventDefault()` (c'est ce que fait notre rechargement automatique) : l'`import()` se résout alors avec
      // `undefined`, et React lisait `.default` dessus — erreur affichée, et signalée à Sentry, le temps que la page
      // se remplace (IMMOPLATFORM-PRO-BACKEND-E). Un module absent PENDANT un rechargement reste donc en attente,
      // comme dans le cas d'un échec rattrapé plus bas. Sans rechargement en cours, rien ne change.
      if (module === undefined && rechargementEnCours()) return new Promise<{ default: T }>(() => {});
      return module;
    } catch (error) {
      if (rechargementAssure()) {
        // Le rechargement remplace la page avant que cette promesse ne
        // compte : elle reste volontairement en attente pour ne pas
        // déclencher l'état d'erreur de Suspense pendant la transition.
        return new Promise<{ default: T }>(() => {});
      }
      throw error;
    }
  });
}
