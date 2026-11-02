import * as Sentry from "@sentry/react";
import { AlertTriangle } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import i18n from "../i18n";
import { BOUTON_PLEIN } from "./styleFormulaire";
import { estFichierDisparu, rechargementAssure } from "../utils/rechargementApresDeploiement";

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
    // Onglet resté ouvert pendant un déploiement : un rechargement récupère la version courante (une seule fois).
    // Ce n'est pas un bug à remonter : on ne le signale à Sentry que si le rechargement n'a pas lieu.
    if (estFichierDisparu(error) && rechargementAssure()) return;
    Sentry.captureException(error, { extra: { componentStack: errorInfo.componentStack } });
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-sm border-2 border-ink-900 bg-white p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center border border-rose-700 bg-rose-50 text-rose-700">
            <AlertTriangle size={26} strokeWidth={1.75} />
          </div>
          <h1 className="text-base font-bold text-slate-900 mb-1.5">{i18n.t("components.errorBoundary.title")}</h1>
          <p className="text-sm text-slate-600 leading-relaxed mb-5">
            {i18n.t("components.errorBoundary.body")}
          </p>
          <button
            onClick={() => window.location.reload()}
            className={BOUTON_PLEIN}
          >
            {i18n.t("components.errorBoundary.reload")}
          </button>
        </div>
      </div>
    );
  }
}
