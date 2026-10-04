declare global {
  interface Window {
    _linkedin_partner_id?: string;
    _linkedin_data_partner_ids?: string[];
    lintrk?: ((...args: unknown[]) => void) & { q?: unknown[] };
  }
}

/** Lu à chaque appel plutôt que figé au chargement du module : permet aux tests de faire varier la configuration. */
function idPartenaire(): string | undefined {
  return import.meta.env.VITE_LINKEDIN_PARTNER_ID as string | undefined;
}

/** Faux tant qu'aucun ID de partenaire LinkedIn n'est configuré (dev, preview sans la variable). */
export function isLinkedInConfigured(): boolean {
  return Boolean(idPartenaire());
}

let chargee = false;

/**
 * Charge l'Insight Tag LinkedIn — appelé uniquement après consentement
 * explicite (CookieConsentBanner) et seulement si un ID de partenaire est
 * configuré. Contrairement à GA4, LinkedIn n'offre pas d'événement
 * "page_view" manuel par route : le tag lui-même comptabilise la visite dès
 * son chargement, donc un seul appel suffit (pas d'équivalent trackPageView).
 */
export function loadLinkedInInsightTag(): void {
  const id = idPartenaire();
  if (chargee || !id) return;
  chargee = true;

  window._linkedin_partner_id = id;
  window._linkedin_data_partner_ids = window._linkedin_data_partner_ids ?? [];
  window._linkedin_data_partner_ids.push(id);

  const queue: unknown[] = [];
  const lintrk = function lintrk(...args: unknown[]) {
    queue.push(args);
  };
  lintrk.q = queue;
  window.lintrk = lintrk;

  const script = document.createElement("script");
  script.async = true;
  script.src = "https://snap.licdn.com/li.lms-analytics/insight.min.js";
  document.head.appendChild(script);
}

/** Réservé aux tests : remet l'état interne à zéro entre deux cas. */
export function _resetLinkedInStateForTests(): void {
  chargee = false;
}
