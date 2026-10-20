import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SITE_URL as SITE_URL_SITEMAP } from "../scripts/generate-sitemap.mjs";
import { SITE_URL as SITE_URL_DONNEES } from "./utils/structuredData";

/**
 * L'adresse publique du site apparaît à quatre endroits qui ne se voient pas depuis l'application : les balises de
 * partage (Open Graph, Twitter), `robots.txt`, le plan du site généré au build et les données structurées. Elles
 * pointaient toutes vers `apllication-gestion-immobili-re.vercel.app`, qui est l'adresse de l'API (Express) et non
 * du site : l'image d'aperçu d'un lien partagé sur WhatsApp ou LinkedIn et le plan du site y répondaient 404.
 */
const RACINE = join(__dirname, "..");
const SITE = "https://www.immoplatformpro.com";
const ADRESSE_DE_L_API = "apllication-gestion-immobili-re.vercel.app";
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), "utf8");

describe("adresse publique du site", () => {
  it("les données structurées et le plan du site utilisent la même adresse, celle du site", () => {
    expect(SITE_URL_DONNEES).toBe(SITE);
    expect(SITE_URL_SITEMAP).toBe(SITE);
  });

  it("les images d'aperçu des liens partagés sont servies par le site", () => {
    const html = lire("index.html");
    expect(html).toContain(`<meta property="og:image" content="${SITE}/og-image.png" />`);
    expect(html).toContain(`<meta name="twitter:image" content="${SITE}/og-image.png" />`);
  });

  it("robots.txt annonce le plan du site à l'adresse du site", () => {
    expect(lire("public/robots.txt")).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });

  it("aucun de ces fichiers ne vise l'adresse de l'API", () => {
    for (const chemin of ["index.html", "public/robots.txt", "scripts/generate-sitemap.mjs", "src/utils/structuredData.ts"]) {
      expect(lire(chemin), chemin).not.toContain(ADRESSE_DE_L_API);
    }
  });
});
