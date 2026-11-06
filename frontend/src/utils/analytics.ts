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
 * Pages sur lesquelles la mesure d'audience s'applique : le site public (accueil, annonces, connexion, inscription, pages
 * légales). Tout le reste — tableau de bord, biens, locataires, factures, portails, administration — est l'usage de
 * l'application par ses utilisateurs, et rien n'en part vers Google. C'est ce que dit la politique de confidentialité
 * (mesure d'audience du site public) ; les pages de réinitialisation du mot de passe et de vérification d'e-mail, dont
 * l'adresse porte un jeton, n'en font pas partie.
 */
const PAGES_PUBLIQUES = ["/", "/landing", "/login", "/inscription", "/mot-de-passe-oublie", "/mentions-legales", "/cgu", "/confidentialite", "/vitrine"];

/** Cette adresse (chemin seul) fait-elle partie du site public ? Une page de l'application, non. */
export function estPagePublique(chemin: string): boolean {
  return PAGES_PUBLIQUES.some((page) => chemin === page || (page !== "/" && chemin.startsWith(`${page}/`)));
}

/**
 * Coupe (ou rétablit) TOUTE la mesure de Google pour la page affichée, y compris ses mesures automatiques (défilement,
 * engagement, formulaires) que gtag.js envoie de lui-même, sans passer par notre code. C'est le mécanisme prévu par
 * Google pour cela : `window['ga-disable-<ID>']`, relu à chaque envoi.
 */
function reglerMesurePour(chemin: string): void {
  const id = idMesure();
  if (!id) return;
  (window as unknown as Record<string, unknown>)[`ga-disable-${id}`] = !estPagePublique(chemin);
}

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
  // Avant même de charger gtag.js : sur une page de l'application, rien ne doit partir, pas même les mesures automatiques.
  reglerMesurePour(window.location.pathname);

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer ?? [];
  // `arguments` et NON un tableau (`...args`) : gtag.js ne reconnaît dans dataLayer que l'objet `Arguments` que pousse le
  // snippet officiel de Google. Un tableau est ignoré en silence : le script se charge, mais « js », « consent »,
  // « config » et « event » ne sont jamais exécutés, et GA4 ne reçoit aucune visite.
  window.gtag = function gtag() {
    // oxlint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
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

/**
 * Événements de conversion envoyés à GA4, avec les noms RECOMMANDÉS par Google (reconnus tels quels dans ses rapports).
 * Aucun ne porte de donnée personnelle : ni e-mail, ni nom, ni téléphone, ni identifiant de compte.
 */
export type EvenementAnalytics =
  | { nom: "sign_up"; params: { method: "email" } }
  | { nom: "login"; params: { method: "password" | "google" } }
  | { nom: "generate_lead"; params: { lead_type: string } };

/** Signale une conversion à GA4 — sans effet tant que le visiteur n'a pas accepté la mesure (script non chargé). */
export function trackEvent(evenement: EvenementAnalytics): void {
  if (!chargee || !window.gtag) return;
  window.gtag("event", evenement.nom, evenement.params);
}

/** Signale une vue de page à GA4 — sans effet tant que loadGoogleAnalytics() n'a pas chargé le script. */
export function trackPageView(path: string): void {
  if (!chargee || !window.gtag) return;
  reglerMesurePour(path);
  if (!estPagePublique(path)) return;
  window.gtag("event", "page_view", { page_path: path });
}
