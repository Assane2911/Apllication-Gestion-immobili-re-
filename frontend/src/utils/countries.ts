/**
 * Codes pays (ISO 3166-1 alpha-2) proposés pour le champ `country` d'une
 * annonce et pour le filtre pays de la vitrine publique. Volontairement
 * limité à l'Afrique francophone (cœur de marché de la plateforme) + France
 * + quelques pays limitrophes/de la diaspora, plutôt que la liste ISO
 * complète (~250 entrées) qui noierait le sélecteur pour un usage qui ne le
 * justifie pas ici.
 *
 * Aucune table de correspondance code -> nom traduit n'est maintenue : voir
 * `countryLabel` ci-dessous, qui délègue à `Intl.DisplayNames` (déjà
 * localisé dans les 4 langues de l'app par le navigateur/Node lui-même).
 */
export const SUPPORTED_COUNTRY_CODES = [
  "SN",
  "CI",
  "ML",
  "BF",
  "BJ",
  "TG",
  "NE",
  "GN",
  "CM",
  "GA",
  "CG",
  "CD",
  "TD",
  "MR",
  "MA",
  "FR",
  "BE",
  "CH",
  "CA",
] as const;

export type SupportedCountryCode = (typeof SUPPORTED_COUNTRY_CODES)[number];

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
