import * as Sentry from "@sentry/react";
import { AlertTriangle } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Filet de sécurité pour toute l'application : si un composant React plante
 * au rendu (bug, donnée inattendue renvoyée par l'API...), React démonte tout
 * l'arbre et laisse par défaut une page blanche sans aucun message — c'est
 * exactement le symptôme rencontré en production lors du déploiement du rôle
 * ADMIN (page /portail totalement vide, aucune erreur visible dans la
 * console). Ce composant intercepte l'erreur, la remonte à Sentry (no-op
 * silencieux si VITE_SENTRY_DSN n'est pas configuré, voir src/instrument.ts —
 * Sentry.captureException ne fait jamais planter l'appelant même sans init)
 * et affiche un message clair avec un bouton pour recharger, plutôt qu'un
 * écran vide silencieux.
 *
 * Placé volontairement à la racine de App(), en dehors de tous les
 * providers (thème, auth, devise...) : il doit continuer à fonctionner même
 * si l'erreur vient d'un de ces contextes eux-mêmes. Pas de hook ni de
 * traduction i18n ici pour la même raison — un texte français simple et
 * statique, qui ne dépend de rien d'autre que React.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    Sentry.captureException(error, { extra: { componentStack: errorInfo.componentStack } });
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950">
        <div className="max-w-sm w-full text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-8">
          <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={26} strokeWidth={1.75} />
          </div>
          <h1 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1.5">Une erreur est survenue</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-5">
            Quelque chose s'est mal passé de notre côté. Rechargez la page pour réessayer — si le
            problème persiste, contactez notre support.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl shadow-sm transition-colors cursor-pointer"
          >
            Recharger la page
          </button>
        </div>
      </div>
    );
  }
}
