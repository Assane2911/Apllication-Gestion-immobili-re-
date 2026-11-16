/**
 * Adresses par langue pour les pages publiques qui ont un équivalent traduit : l'accueil et la vitrine.
 *
 * Avant, les quatre langues partageaient la même adresse, le choix de langue vivant dans le navigateur du visiteur : un
 * moteur de recherche, qui n'a pas de navigateur « réglé », ne voyait que le français. Désormais :
 *   français (langue de référence, adresses d'origine)  →  /            /vitrine
 *   anglais, espagnol, portugais                        →  /en  /es  /pt     /en/vitrine  /es/vitrine  /pt/vitrine
 * Chaque version annonce les autres (balises hreflang, voir Seo.tsx) et le plan du site les liste.
 * Les pages qui n'existent qu'en français (pages légales) et celles de l'application gardent leur adresse unique.
 */
export const LANGUES_PREFIXEES = ["en", "es", "pt"] as const;
export type LanguePrefixee = (typeof LANGUES_PREFIXEES)[number];
export const TOUTES_LES_LANGUES = ["fr", ...LANGUES_PREFIXEES] as const;
export type LangueDuSite = (typeof TOUTES_LES_LANGUES)[number];

/** Pages publiques qui existent dans chaque langue (adresse sans préfixe : « / » est l'accueil, aussi servi par « /landing »). */
export const PAGES_TRADUITES = ["/", "/vitrine"] as const;

/** Le préfixe de langue de cette adresse (« /en/vitrine » → « en »), ou `null`. « /enigme » n'est pas « /en ». */
export function langueDuChemin(chemin: string): LanguePrefixee | null {
  const segment = chemin.split("/")[1] ?? "";
  return (LANGUES_PREFIXEES as readonly string[]).includes(segment) ? (segment as LanguePrefixee) : null;
}

/** L'adresse sans son préfixe de langue (« /en/vitrine » → « /vitrine », « /en » → « / »). */
export function sansPrefixeLangue(chemin: string): string {
  if (!langueDuChemin(chemin)) return chemin;
  const reste = chemin.replace(/^\/[^/]+/, "");
  return reste === "" ? "/" : reste;
}

/** Cette page (adresse sans préfixe) existe-t-elle dans chaque langue ? « /landing » est l'accueil. */
export function estPageTraduite(chemin: string): boolean {
  const propre = sansPrefixeLangue(chemin);
  return propre === "/landing" || (PAGES_TRADUITES as readonly string[]).includes(propre);
}

/**
 * L'adresse de cette page dans cette langue. Le français garde l'adresse d'origine ; une page qui n'existe pas en plusieurs
 * langues (légales, application, annonce) est rendue telle quelle.
 */
export function cheminDansLaLangue(chemin: string, langue: string): string {
  const propre = sansPrefixeLangue(chemin);
  if (!estPageTraduite(propre)) return chemin;
  const accueil = propre === "/" || propre === "/landing";
  if (!(LANGUES_PREFIXEES as readonly string[]).includes(langue)) return accueil ? "/" : propre;
  return accueil ? `/${langue}` : `/${langue}${propre}`;
}

/** Toutes les versions d'une page traduite : « /vitrine » → { fr: « /vitrine », en: « /en/vitrine »… }. */
export function versionsDeLaPage(chemin: string): Record<LangueDuSite, string> {
  return Object.fromEntries(TOUTES_LES_LANGUES.map((l) => [l, cheminDansLaLangue(chemin, l)])) as Record<LangueDuSite, string>;
}
