import { isAnalyticsConfigured } from "./analytics";
import { isLinkedInConfigured } from "./linkedinInsight";
import { isMetaPixelConfigured } from "./metaPixel";

/**
 * Choix du visiteur sur les traceurs (mesure d'audience Google, pixels Meta et LinkedIn), mémorisé dans le navigateur.
 *
 * Trois règles de la CNIL tenues ici :
 *  - le choix ne dure pas indéfiniment : un accord est redemandé au bout de 13 mois, un refus au bout de 6 mois ;
 *  - on peut le changer à tout moment, aussi simplement qu'on l'a donné (lien « Gérer mes cookies » en bas des pages
 *    publiques, qui rouvre le bandeau) ;
 *  - un retrait efface les cookies déjà déposés.
 * Un stockage indisponible (navigation privée, réglages stricts) ne doit jamais faire planter l'application : sans stockage,
 * le visiteur est simplement tenu pour n'ayant pas répondu.
 */
export const CLE_CHOIX = "cookie_consent";
export const CLE_DATE_CHOIX = "cookie_consent_date";
export type ChoixCookies = "accepted" | "rejected";

const JOUR_MS = 86_400_000;
const DUREE_DU_CHOIX_MS: Record<ChoixCookies, number> = { accepted: 395 * JOUR_MS, rejected: 183 * JOUR_MS };

/** Événement émis par « Gérer mes cookies » : le bandeau se rouvre. */
export const EVENEMENT_ROUVRIR_CHOIX = "rouvrir-choix-cookies";

/** Au moins un des trois traceurs a son identifiant configuré : sinon il n'y a rien à accepter ni à gérer. */
export function unTraceurEstConfigure(): boolean {
  return isAnalyticsConfigured() || isMetaPixelConfigured() || isLinkedInConfigured();
}

/** Le choix enregistré, ou `null` s'il n'y en a pas, s'il a expiré ou si le stockage est indisponible. */
export function lireChoixCookies(maintenant: number = Date.now()): ChoixCookies | null {
  try {
    const brut = localStorage.getItem(CLE_CHOIX);
    if (brut !== "accepted" && brut !== "rejected") return null;
    const date = Number(localStorage.getItem(CLE_DATE_CHOIX));
    if (!Number.isFinite(date) || date <= 0) {
      // Choix fait avant que sa date soit enregistrée : on part de maintenant plutôt que de redemander d'un coup à tous.
      localStorage.setItem(CLE_DATE_CHOIX, String(maintenant));
      return brut;
    }
    return maintenant - date > DUREE_DU_CHOIX_MS[brut] ? null : brut;
  } catch {
    return null;
  }
}

/** Enregistre le choix et sa date. Faux si le stockage est indisponible (le choix ne vaut alors que pour cette page). */
export function enregistrerChoixCookies(choix: ChoixCookies, maintenant: number = Date.now()): boolean {
  try {
    localStorage.setItem(CLE_CHOIX, choix);
    localStorage.setItem(CLE_DATE_CHOIX, String(maintenant));
    return true;
  } catch {
    return false;
  }
}

/** Rouvre le bandeau pour que le visiteur change d'avis (lien « Gérer mes cookies »). */
export function rouvrirChoixCookies(): void {
  window.dispatchEvent(new Event(EVENEMENT_ROUVRIR_CHOIX));
}

/**
 * Cookies déposés par les traceurs : Google Analytics (_ga, _ga_<ID>, _gid, _gat…), Meta (_fbp, _fbc, fr), LinkedIn (li_*,
 * lidc, bcookie, bscookie, UserMatchHistory, AnalyticsSyncHistory). Ils sont posés sur le domaine du site (ou son domaine parent).
 */
const COOKIES_TRACEURS = /^(_ga(_.*)?|_gid|_gat(_.*)?|_fbp|_fbc|fr|li_.*|lidc|bcookie|bscookie|UserMatchHistory|AnalyticsSyncHistory)$/;

/** Supprime les cookies de traceurs du navigateur, pour le domaine du site et ses domaines parents. */
export function effacerCookiesTraceurs(): void {
  try {
    const noms = document.cookie
      .split(";")
      .map((c) => c.split("=")[0].trim())
      .filter((nom) => COOKIES_TRACEURS.test(nom));
    const parties = window.location.hostname.split(".");
    const domaines = ["", ...parties.map((_, i) => parties.slice(i).join(".")).filter((d) => d.includes("."))];
    for (const nom of noms) {
      for (const domaine of domaines) {
        document.cookie = `${nom}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domaine ? `; domain=${domaine}` : ""}`;
      }
    }
  } catch {
    // Les cookies ne s'effacent pas : sans conséquence pour le reste.
  }
}
