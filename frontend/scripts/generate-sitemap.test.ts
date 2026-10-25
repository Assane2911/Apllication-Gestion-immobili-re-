import { describe, expect, it } from "vitest";
import { construireSitemap, echapperXml, SITE_URL, STATIC_ROUTES } from "./generate-sitemap.mjs";

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
});
