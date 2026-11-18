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
/**
 * Le consentement se donne FINALITÉ PAR FINALITÉ (recommandation de la CNIL) : la mesure d'audience (Google Analytics) d'une part, la
 * publicité et le reciblage (pixels Meta et LinkedIn) d'autre part. Quatre valeurs : « accepted » (les deux) et « rejected » (aucune)
 * gardent leur sens d'avant, donc les choix déjà enregistrés restent valables ; « audience » et « publicite » n'autorisent que leur finalité.
 */
export type ChoixCookies = "accepted" | "rejected" | "audience" | "publicite";

/** Les finalités qu'un choix autorise. Sans choix (`null`), aucune : rien ne part tant que le visiteur n'a pas répondu. */
export interface FinalitesCookies {
  audience: boolean;
  publicite: boolean;
}

export function finalitesAutorisees(choix: ChoixCookies | null): FinalitesCookies {
  return {
    audience: choix === "accepted" || choix === "audience",
    publicite: choix === "accepted" || choix === "publicite",
  };
}

/** Le choix qui correspond à des finalités cochées : tout cocher, c'est tout accepter ; ne rien cocher, c'est tout refuser. */
export function choixDepuisFinalites({ audience, publicite }: FinalitesCookies): ChoixCookies {
  if (audience && publicite) return "accepted";
  if (audience) return "audience";
  if (publicite) return "publicite";
  return "rejected";
}

const CHOIX_VALIDES: readonly string[] = ["accepted", "rejected", "audience", "publicite"];

const JOUR_MS = 86_400_000;
/** Un choix qui contient un accord, même partiel, se redemande au bout de 13 mois ; un refus complet, au bout de 6. */
const DUREE_DU_CHOIX_MS: Record<ChoixCookies, number> = { accepted: 395 * JOUR_MS, audience: 395 * JOUR_MS, publicite: 395 * JOUR_MS, rejected: 183 * JOUR_MS };

/** Événement émis par « Gérer mes cookies » : le bandeau se rouvre. */
export const EVENEMENT_ROUVRIR_CHOIX = "rouvrir-choix-cookies";

/** Au moins un des trois traceurs a son identifiant configuré : sinon il n'y a rien à accepter ni à gérer. */
export function unTraceurEstConfigure(): boolean {
  return audienceEstConfiguree() || publiciteEstConfiguree();
}

/** La finalité « mesure d'audience » existe : Google Analytics a son identifiant. */
export function audienceEstConfiguree(): boolean {
  return isAnalyticsConfigured();
}

/** La finalité « publicité et reciblage » existe : le pixel Meta ou le traceur LinkedIn a son identifiant. */
export function publiciteEstConfiguree(): boolean {
  return isMetaPixelConfigured() || isLinkedInConfigured();
}

/** Le choix enregistré, ou `null` s'il n'y en a pas, s'il a expiré ou si le stockage est indisponible. */
export function lireChoixCookies(maintenant: number = Date.now()): ChoixCookies | null {
  try {
    const brut = localStorage.getItem(CLE_CHOIX);
    if (brut === null || !CHOIX_VALIDES.includes(brut)) return null;
    const choix = brut as ChoixCookies;
    const date = Number(localStorage.getItem(CLE_DATE_CHOIX));
    if (!Number.isFinite(date) || date <= 0) {
      // Choix fait avant que sa date soit enregistrée : on part de maintenant plutôt que de redemander d'un coup à tous.
      localStorage.setItem(CLE_DATE_CHOIX, String(maintenant));
      return choix;
    }
    return maintenant - date > DUREE_DU_CHOIX_MS[choix] ? null : choix;
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
