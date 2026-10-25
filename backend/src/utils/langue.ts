import type { Request } from "express";

/** Les langues de l'interface (frontend/src/i18n) pour lesquelles le serveur sait écrire. Le français est la langue par défaut. */
export const LANGUES = ["fr", "en", "es", "pt"] as const;
export type Langue = (typeof LANGUES)[number];
export const LANGUE_PAR_DEFAUT: Langue = "fr";

/** Au-delà, l'en-tête n'est pas celui d'un navigateur : on ne le lit pas. */
const LONGUEUR_MAX_ENTETE = 1000;

/**
 * Choisit la langue d'un en-tête `Accept-Language` parmi celles que gère l'application.
 *
 * Le frontend y met la langue choisie dans l'interface (voir api/client.ts) ; sans cela, le navigateur y met ses
 * propres langues, classées par préférence (`fr-FR,fr;q=0.9,en;q=0.8`). Dans les deux cas on retient la préférence la
 * mieux classée que l'on sait écrire, sans tenir compte de la région (`pt-BR` → `pt`). Un q à zéro exclut la langue.
 * En l'absence de langue connue, l'en-tête absent ou illisible : le français.
 */
export function choisirLangue(entete: string | undefined): Langue {
  return lireLangue(entete) ?? LANGUE_PAR_DEFAUT;
}

/** Comme `choisirLangue`, mais `null` quand l'en-tête ne demande aucune des langues gérées (au lieu du français). */
function lireLangue(entete: string | undefined): Langue | null {
  if (!entete || entete.length > LONGUEUR_MAX_ENTETE) return null;

  const candidates = entete
    .split(",")
    .map((morceau, rang) => {
      const [balise, ...parametres] = morceau.trim().split(";");
      const q = parametres.map((p) => p.trim()).find((p) => /^q=/i.test(p));
      const poids = q === undefined ? 1 : Number(q.slice(2));
      return { langue: balise.trim().toLowerCase().split("-")[0], poids: Number.isFinite(poids) ? poids : 0, rang };
    })
    .filter((c): c is { langue: Langue; poids: number; rang: number } => c.poids > 0 && (LANGUES as readonly string[]).includes(c.langue))
    .sort((a, b) => b.poids - a.poids || a.rang - b.rang);

  return candidates[0]?.langue ?? null;
}

/** Langue dans laquelle écrire à la personne qui fait cette requête. */
export function langueDeLaRequete(req: Request): Langue {
  const entete = req.headers["accept-language"];
  return choisirLangue(Array.isArray(entete) ? entete[0] : entete);
}

/**
 * La langue que demande cette requête, ou `null` si elle n'en demande aucune que l'on gère. À préférer à
 * `langueDeLaRequete` quand il s'agit d'ENREGISTRER la langue d'une personne : le français par défaut ne doit pas
 * écraser celle qu'elle avait, simplement parce qu'une requête n'en précisait pas.
 */
export function langueDemandee(req: Request): Langue | null {
  const entete = req.headers["accept-language"];
  return lireLangue(Array.isArray(entete) ? entete[0] : entete);
}

/**
 * Langue lue en base (locataire, propriétaire...) : une valeur absente, inconnue ou d'un autre type donne le
 * français, comme avant que les personnes aient une langue.
 */
export function langueOuDefaut(valeur: unknown): Langue {
  return typeof valeur === "string" && (LANGUES as readonly string[]).includes(valeur) ? (valeur as Langue) : LANGUE_PAR_DEFAUT;
}

/**
 * Locale d'écriture des nombres et des dates, par langue. C'est la table du portail (frontend/src/context/
 * CurrencyContext.tsx) : une même somme s'écrit pareil dans l'e-mail et sur l'espace du locataire.
 */
export const LOCALE_PAR_LANGUE: Record<Langue, string> = { fr: "fr-FR", en: "en", es: "es", pt: "pt-PT" };

/** Une date en toutes lettres dans la langue donnée (« 5 novembre 2026 », « 5 November 2026 »). */
export function formaterDate(
  date: Date | string | number,
  langue: Langue = LANGUE_PAR_DEFAUT,
  options: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" }
): string {
  return new Date(date).toLocaleDateString(LOCALE_PAR_LANGUE[langue], options);
}

/** Nom d'un mois (1 à 12) dans la langue donnée. Hors de cette plage, le nombre tel quel. */
export function nomDuMois(mois: number, langue: Langue = LANGUE_PAR_DEFAUT): string {
  if (!Number.isInteger(mois) || mois < 1 || mois > 12) return String(mois);
  return new Date(Date.UTC(2026, mois - 1, 1)).toLocaleDateString(LOCALE_PAR_LANGUE[langue], { month: "long", timeZone: "UTC" });
}
