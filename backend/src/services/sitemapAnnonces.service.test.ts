import { describe, expect, it } from "vitest";
import { construireSitemapAnnonces, PLAFOND_URLS_SITEMAP } from "./sitemapAnnonces.service";

const jour = (iso: string) => new Date(`${iso}T10:30:00Z`);

describe("construireSitemapAnnonces", () => {
  it("liste chaque annonce à l'adresse du SITE (www), avec sa date de dernière modification", () => {
    const xml = construireSitemapAnnonces([
      { id: "abc123", updatedAt: jour("2026-11-01") },
      { id: "def456", updatedAt: jour("2026-11-17") },
    ]);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("<loc>https://www.immoplatformpro.com/vitrine/annonces/abc123</loc>");
    expect(xml).toContain("<lastmod>2026-11-01T10:30:00.000Z</lastmod>");
    expect(xml).toContain("<loc>https://www.immoplatformpro.com/vitrine/annonces/def456</loc>");
    expect(xml).toContain("<lastmod>2026-11-17T10:30:00.000Z</lastmod>");
    expect((xml.match(/<url>/g) ?? []).length).toBe(2);
  });

  it("sans annonce, reste un plan valide (et non une erreur)", () => {
    const xml = construireSitemapAnnonces([]);
    expect(xml).toContain("<urlset");
    expect(xml).toContain("</urlset>");
    expect(xml).not.toContain("<url>");
  });

  it("échappe les caractères réservés du XML dans l'adresse", () => {
    const xml = construireSitemapAnnonces([{ id: 'a&b<c>"d', updatedAt: jour("2026-11-01") }]);
    expect(xml).toContain("a&amp;b&lt;c&gt;&quot;d");
    expect(xml).not.toContain('a&b<c>"d');
  });

  it("ne dépasse pas le plafond de 50 000 adresses d'un plan du site", () => {
    expect(PLAFOND_URLS_SITEMAP).toBe(50_000);
    const lignes = Array.from({ length: PLAFOND_URLS_SITEMAP + 5 }, (_, i) => ({ id: `id${i}`, updatedAt: jour("2026-11-01") }));
    expect((construireSitemapAnnonces(lignes).match(/<url>/g) ?? []).length).toBe(PLAFOND_URLS_SITEMAP);
  });
});
