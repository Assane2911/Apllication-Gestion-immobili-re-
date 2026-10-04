import { lazy, type ComponentType, type LazyExoticComponent } from "react";

const RELOAD_FLAG_KEY = "chunk_load_reload_attempted";

/**
 * Remplace React.lazy() : si le chunk échoue à charger, recharge la page une
 * fois plutôt que de laisser l'erreur remonter jusqu'à l'ErrorBoundary — cas
 * classique d'un visiteur qui garde un onglet ouvert pendant qu'un nouveau
 * déploiement remplace les fichiers JS sous des noms différents (hash de
 * build changé), observé en production (Sentry : "Failed to fetch
 * dynamically imported module"). Le rechargement récupère le nouveau
 * manifeste et donc le bon chunk.
 *
 * Un seul essai par session (sessionStorage, pas localStorage : ne doit pas
 * survivre à la fermeture de l'onglet) pour ne jamais boucler si l'échec a
 * une autre cause (visiteur réellement hors ligne, etc.) — au deuxième échec
 * dans la même session, l'erreur remonte normalement jusqu'à l'ErrorBoundary.
 */
export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const mod = await factory();
      sessionStorage.removeItem(RELOAD_FLAG_KEY);
      return mod;
    } catch (error) {
      if (!sessionStorage.getItem(RELOAD_FLAG_KEY)) {
        sessionStorage.setItem(RELOAD_FLAG_KEY, "1");
        window.location.reload();
        // Le rechargement remplace la page avant que cette promesse ne
        // compte : elle reste volontairement en attente pour ne pas
        // déclencher l'état d'erreur de Suspense pendant la transition.
        return new Promise<{ default: T }>(() => {});
      }
      throw error;
    }
  });
}
