import { useEffect, useRef, useState } from "react";
import { googleClientId } from "../utils/googleAuth";

const GOOGLE_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

let scriptLoadPromise: Promise<void> | null = null;

/**
 * Charge le script Google Identity Services une seule fois par page, même si
 * plusieurs instances de ce composant le demandent (Login ET Inscription
 * peuvent toutes deux le monter). Chargé uniquement à la demande — jamais
 * globalement dans index.html — car ni la vitrine publique ni le reste de
 * l'application n'en ont besoin : un script tiers de moins au chargement, et
 * un appel de moins vers Google pour un visiteur qui ne s'en sert jamais.
 */
function loadGoogleScript(): Promise<void> {
  if (typeof window !== "undefined" && window.google?.accounts?.id) {
    return Promise.resolve();
  }
  if (!scriptLoadPromise) {
    scriptLoadPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_SCRIPT_SRC}"]`);
      if (existing) {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("google-script-failed")));
        return;
      }
      const script = document.createElement("script");
      script.src = GOOGLE_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("google-script-failed"));
      document.head.appendChild(script);
    });
  }
  return scriptLoadPromise;
}

interface GoogleSignInButtonProps {
  /** Appelé avec le jeton d'identité renvoyé par Google une fois l'utilisateur authentifié côté Google. */
  onCredential: (credential: string) => void;
  /** Appelé si le script Google n'a pas pu être chargé (réseau, bloqueur de contenu...). */
  onError?: () => void;
  /** Langue d'affichage du bouton dessiné par Google (ex: "fr", "en"). */
  locale?: string;
}

/**
 * Bouton "Se connecter avec Google" — réservé aux gestionnaires (voir
 * auth.controller.ts::loginWithGoogle côté serveur). Ne rend rien tant que
 * VITE_GOOGLE_CLIENT_ID n'est pas configuré, pour que LoginPage/RegisterPage
 * restent inchangées avant que l'utilisateur n'ait créé son Client ID sur la
 * Google Cloud Console.
 */
export default function GoogleSignInButton({ onCredential, onError, locale }: GoogleSignInButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const clientId = googleClientId();

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;

    loadGoogleScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => onCredential(response.credential),
        });
        // Repart d'un conteneur vide avant chaque (re)rendu du bouton : évite
        // d'empiler plusieurs boutons Google si l'effet est rejoué (ex.
        // changement de langue) sans que Google ne remplace lui-même l'ancien.
        containerRef.current.innerHTML = "";
        window.google.accounts.id.renderButton(containerRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          width: 320,
          locale,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          onError?.();
        }
      });

    return () => {
      cancelled = true;
    };
    // onCredential/onError intentionnellement absents des dépendances : ce
    // sont des closures recréées à chaque rendu des pages appelantes, et les
    // inclure relancerait le chargement du script à chaque frappe du
    // formulaire. clientId/locale, seuls susceptibles de changer utilement,
    // suffisent à déclencher un nouveau rendu du bouton Google.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, locale]);

  if (!clientId || failed) return null;

  return <div ref={containerRef} className="flex justify-center" data-testid="google-signin-button" />;
}
