import { describe, expect, it } from "vitest";
import en from "./locales/en";
import es from "./locales/es";
import fr from "./locales/fr";
import pt from "./locales/pt";

/**
 * Les moteurs de recherche coupent le titre d'un résultat vers 60 caractères et sa description vers 160 : la vitrine
 * s'affichait « Annonces immobilières — Locations, ventes, terr… » (70 à 74 caractères selon la langue). Titres et descriptions
 * des pages publiques tiennent maintenant dans ces limites, dans chaque langue.
 */
type Seo = Record<string, { title?: string; description?: string }>;
const LANGUES: Array<[string, Seo]> = [
  ["fr", (fr as unknown as { seo: Seo }).seo],
  ["en", (en as unknown as { seo: Seo }).seo],
  ["es", (es as unknown as { seo: Seo }).seo],
  ["pt", (pt as unknown as { seo: Seo }).seo],
];
// Pages dont le titre s'affiche seul dans les résultats ; les autres reçoivent « | ImmoPlatform Pro » (19 caractères) en suffixe.
const SANS_SUFFIXE = new Set(["landing", "vitrine"]);

describe.each(LANGUES)("SEO %s", (_langue, seo) => {
  it("chaque titre tient dans 60 caractères, suffixe de marque compris", () => {
    const fautes = Object.entries(seo).flatMap(([page, v]) => {
      if (!v.title) return [];
      const longueur = v.title.length + (SANS_SUFFIXE.has(page) ? 0 : " | ImmoPlatform Pro".length);
      return longueur > 60 ? [`${page} : ${longueur} caractères`] : [];
    });
    expect(fautes).toEqual([]);
  });

  it("chaque description tient dans 160 caractères", () => {
    const fautes = Object.entries(seo).flatMap(([page, v]) => (v.description && v.description.length > 160 ? [`${page} : ${v.description.length} caractères`] : []));
    expect(fautes).toEqual([]);
  });
});
