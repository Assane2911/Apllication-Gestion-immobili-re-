import { CODES_PAYS, type CodePays } from "../data/pays";

/**
 * Codes pays (ISO 3166-1 alpha-2) proposés pour le champ `country` d'une
 * annonce et pour le filtre pays de la vitrine publique.
 *
 * Cette liste n'est plus écrite ici : elle DÉRIVE de `data/pays.ts`, seule
 * table des pays couverts, où chaque pays porte aussi son indicatif
 * téléphonique et sa devise. Avant, trois listes décrivaient le même marché
 * sans jamais se consulter, et l'une pouvait accueillir un pays que les deux
 * autres ignoraient.
 *
 * Elle reste volontairement limitée à l'Afrique francophone (cœur de marché)
 * plus la France, quelques pays limitrophes et ceux de la diaspora, plutôt que
 * la liste ISO complète (~250 entrées) qui noierait le sélecteur.
 *
 * Aucune table de correspondance code -> nom traduit n'est maintenue : voir
 * `countryLabel` ci-dessous, qui délègue à `Intl.DisplayNames` (déjà
 * localisé dans les 4 langues de l'app par le navigateur/Node lui-même).
 */
export const SUPPORTED_COUNTRY_CODES: readonly CodePays[] = CODES_PAYS;

export type SupportedCountryCode = CodePays;

/**
 * Nom lisible d'un code pays dans la langue demandée, via `Intl.DisplayNames`
 * (supporté par tous les navigateurs ciblés). Retombe sur le code brut si
 * l'API n'est pas disponible ou ne reconnaît pas le code, plutôt que de
 * planter l'écran.
 */
export function countryLabel(code: string, locale: string): string {
  try {
    const displayNames = new Intl.DisplayNames([locale], { type: "region" });
    return displayNames.of(code) ?? code;
  } catch {
    return code;
  }
}
