declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; version?: string };
    _fbq?: unknown;
  }
}

/** Lu à chaque appel plutôt que figé au chargement du module : permet aux tests de faire varier la configuration. */
function idPixel(): string | undefined {
  return import.meta.env.VITE_META_PIXEL_ID as string | undefined;
}

/** Faux tant qu'aucun ID de pixel Meta n'est configuré (dev, preview sans la variable). */
export function isMetaPixelConfigured(): boolean {
  return Boolean(idPixel());
}

let chargee = false;

/**
 * Charge fbevents.js et initialise le pixel Meta (Facebook/Instagram) —
 * appelé uniquement après consentement explicite (CookieConsentBanner) et
 * seulement si un ID de pixel est configuré. Reprend la structure du
 * script officiel Meta (fonction fbq en file d'attente avant chargement du
 * script), réécrite lisiblement plutôt que collée depuis le snippet minifié.
 */
export function loadMetaPixel(): void {
  const id = idPixel();
  if (chargee || !id) return;
  chargee = true;

  const queue: unknown[] = [];
  const fbq = function fbq(...args: unknown[]) {
    queue.push(args);
  };
  fbq.queue = queue;
  fbq.loaded = true;
  fbq.version = "2.0";
  window.fbq = fbq;
  window._fbq = fbq;

  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);

  window.fbq("init", id);
  trackMetaPageView();
}

/** Réservé aux tests : remet l'état interne à zéro entre deux cas. */
export function _resetMetaPixelStateForTests(): void {
  chargee = false;
}

/** Signale une vue de page au pixel Meta — sans effet tant que loadMetaPixel() n'a pas chargé le script. */
export function trackMetaPageView(): void {
  if (!chargee || !window.fbq) return;
  window.fbq("track", "PageView");
}
