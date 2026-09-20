export {};

/**
 * Typage minimal du script tiers Google Identity Services
 * (https://accounts.google.com/gsi/client), chargé à la demande par
 * GoogleSignInButton.tsx. Seules les deux méthodes réellement utilisées sont
 * déclarées — ce script expose une API bien plus large, hors périmètre ici.
 */
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: "standard" | "icon";
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "large" | "medium" | "small";
              width?: number;
              locale?: string;
            }
          ) => void;
        };
      };
    };
  }
}
