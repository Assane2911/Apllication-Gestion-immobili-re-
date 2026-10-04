declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** Lu à chaque appel plutôt que figé au chargement du module : permet aux tests de faire varier la configuration. */
function idMesure(): string | undefined {
  return import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;
}

/** Faux tant qu'aucun ID de mesure GA4 n'est configuré (dev, preview sans la variable). */
export function isAnalyticsConfigured(): boolean {
  return Boolean(idMesure());
}

let chargee = false;

/**
 * Charge gtag.js et initialise GA4 — appelé uniquement après consentement
 * explicite (CookieConsentBanner) et seulement si un ID de mesure est
 * configuré. Idempotent : un second appel (ex. l'utilisateur rouvre un onglet
 * où le consentement était déjà enregistré) ne recharge pas le script.
 */
export function loadGoogleAnalytics(): void {
  const id = idMesure();
  if (chargee || !id) return;
  chargee = true;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer!.push(args);
  };
  window.gtag("js", new Date());
  // Sans signal explicite, le Consent Mode de Google considère par défaut la
  // mesure comme non autorisée et abandonne silencieusement les événements
  // (le script se charge, la requête de config part, mais rien n'atteint
  // /g/collect) — constaté en prod. loadGoogleAnalytics() n'est appelé
  // qu'après acceptation explicite du bandeau (CookieConsentBanner), donc
  // la mesure est bien autorisée à ce stade ; ad_storage/ads reste refusé,
  // ce produit ne fait pas de ciblage publicitaire.
  window.gtag("consent", "default", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  // send_page_view à false : la première vue et celles liées à la navigation
  // interne (SPA, pas de rechargement de page) sont toutes envoyées
  // explicitement par trackPageView, pour ne jamais en perdre ni en dupliquer.
  window.gtag("config", id, { send_page_view: false });
  trackPageView(window.location.pathname);
}

/** Réservé aux tests : remet l'état interne à zéro entre deux cas. */
export function _resetAnalyticsStateForTests(): void {
  chargee = false;
}

/** Signale une vue de page à GA4 — sans effet tant que loadGoogleAnalytics() n'a pas chargé le script. */
export function trackPageView(path: string): void {
  if (!chargee || !window.gtag) return;
  window.gtag("event", "page_view", { page_path: path });
}
