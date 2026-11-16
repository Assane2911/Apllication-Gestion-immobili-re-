import { describe, expect, it } from "vitest";
import { LANGUES_PREFIXEES as LANGUES_DU_SITE, PAGES_TRADUITES as TRADUITES_DU_SITE } from "../src/utils/langueUrl";
import { construireSitemap, echapperXml, entreesStatiques, LANGUES_PREFIXEES, PAGES_TRADUITES, SITE_URL, STATIC_ROUTES, versionsDeLaPage } from "./generate-sitemap.mjs";

describe("generate-sitemap — fonctions pures", () => {
  it("échappe les caractères spéciaux XML", () => {
    expect(echapperXml("a & b")).toBe("a &amp; b");
    expect(echapperXml('<x y="z">')).toBe("&lt;x y=&quot;z&quot;&gt;");
  });

  it("construit un sitemap XML valide avec une entrée par URL", () => {
    const xml = construireSitemap([
      { loc: "https://example.com/a", priority: "1.0" },
      { loc: "https://example.com/b", priority: "0.5" },
    ]);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("<loc>https://example.com/a</loc>");
    expect(xml).toContain("<priority>1.0</priority>");
    expect(xml).toContain("<loc>https://example.com/b</loc>");
    expect(xml).toContain("<priority>0.5</priority>");
  });

  it("échappe le contenu de <loc> (ex. un id d'annonce imprévu avec un caractère spécial)", () => {
    const xml = construireSitemap([{ loc: "https://example.com/vitrine/annonces/a&b", priority: "0.7" }]);
    expect(xml).toContain("<loc>https://example.com/vitrine/annonces/a&amp;b</loc>");
  });

  // Régression. /vitrine/annonces/:id (priorité 1 du plan SEO) doit être
  // couverte par le sitemap pour que les nouvelles annonces soient
  // découvertes rapidement — ce test verrouille la présence de /vitrine dans
  // les routes statiques, socle sur lequel les annonces viennent s'ajouter.
  it("inclut la vitrine parmi les routes statiques, socle des annonces individuelles", () => {
    expect(STATIC_ROUTES.map((r) => r.path)).toContain("/vitrine");
  });

  it("utilise le domaine public du site (celui des visiteurs), pas l'adresse de l'API", () => {
    expect(SITE_URL).toBe("https://www.immoplatformpro.com");
  });

  // /landing affiche la même page que / et pointe vers elle (balise canonique) : un plan du site ne liste que les
  // adresses canoniques. /inscription est la page de conversion : elle y a sa place.
  it("liste /inscription, et plus /landing (copie de / qui pointe vers elle)", () => {
    const chemins = STATIC_ROUTES.map((r) => r.path);
    expect(chemins).toContain("/inscription");
    expect(chemins).not.toContain("/landing");
    expect(chemins).toContain("/");
  });

  it("ne liste que des adresses distinctes", () => {
    const chemins = STATIC_ROUTES.map((r) => r.path);
    expect(new Set(chemins).size).toBe(chemins.length);
  });

  /**
   * L'accueil et la vitrine existent en quatre langues, chacune à son adresse : le plan du site les liste toutes et les relie
   * par des balises hreflang (chaque version cite toutes les versions, la sienne comprise, et le français en x-default).
   */
  describe("pages traduites", () => {
    it("la liste du script est celle de l'application", () => {
      expect([...LANGUES_PREFIXEES]).toEqual([...LANGUES_DU_SITE]);
      expect([...PAGES_TRADUITES]).toEqual([...TRADUITES_DU_SITE]);
    });

    it("une page traduite a une entrée par langue, reliées entre elles", () => {
      const entrees = entreesStatiques().filter((e: { loc: string }) => e.loc.includes("/vitrine") && !e.loc.includes("/annonces"));
      expect(entrees.map((e: { loc: string }) => e.loc)).toEqual([
        `${SITE_URL}/vitrine`,
        `${SITE_URL}/en/vitrine`,
        `${SITE_URL}/es/vitrine`,
        `${SITE_URL}/pt/vitrine`,
      ]);
      for (const e of entrees) {
        expect(e.alternates).toEqual({ fr: `${SITE_URL}/vitrine`, en: `${SITE_URL}/en/vitrine`, es: `${SITE_URL}/es/vitrine`, pt: `${SITE_URL}/pt/vitrine` });
      }
    });

    it("l'accueil français est « / », ses versions « /en », « /es », « /pt »", () => {
      expect(versionsDeLaPage("/")).toEqual({ fr: "/", en: "/en", es: "/es", pt: "/pt" });
    });

    it("une page qui n'existe qu'en français (connexion, inscription, pages légales) n'a qu'une entrée, sans hreflang", () => {
      const entrees = entreesStatiques().filter((e: { loc: string }) => /\/(inscription|cgu|mentions-legales|confidentialite)$/.test(e.loc));
      expect(entrees).toHaveLength(4);
      for (const e of entrees) expect(e.alternates).toBeUndefined();
    });

    it("le XML déclare l'espace xhtml et porte les liens hreflang et x-default", () => {
      const xml = construireSitemap(entreesStatiques());
      expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
      expect(xml).toContain(`<xhtml:link rel="alternate" hreflang="en" href="${SITE_URL}/en/vitrine"/>`);
      expect(xml).toContain(`<xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}/vitrine"/>`);
      expect(xml).toContain(`<loc>${SITE_URL}/pt</loc>`);
    });

    it("sans page traduite, le XML reste celui d'avant (pas d'espace xhtml)", () => {
      expect(construireSitemap([{ loc: "https://example.com/a", priority: "1.0" }])).not.toContain("xhtml");
    });
  });
});
