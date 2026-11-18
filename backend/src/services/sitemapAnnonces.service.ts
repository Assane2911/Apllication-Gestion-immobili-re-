import { SITE_URL } from "../config/siteUrl";

/** Un plan du site ne peut pas lister plus de 50 000 adresses (protocole sitemaps.org). */
export const PLAFOND_URLS_SITEMAP = 50_000;

export interface LigneAnnonceSitemap {
  id: string;
  updatedAt: Date;
}

function echapperXml(texte: string): string {
  return texte.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Plan du site des annonces de la vitrine : une adresse par annonce visible, à l'adresse du SITE, avec sa date de dernière
 * modification (que Google exploite pour savoir quoi réexplorer). Les pages fixes restent dans le plan produit au build du site
 * (frontend/scripts/generate-sitemap.mjs) : ce plan-ci ne couvre que ce qui change entre deux déploiements.
 */
export function construireSitemapAnnonces(lignes: LigneAnnonceSitemap[]): string {
  const entrees = lignes
    .slice(0, PLAFOND_URLS_SITEMAP)
    .map(({ id, updatedAt }) => `  <url>\n    <loc>${echapperXml(`${SITE_URL}/vitrine/annonces/${id}`)}</loc>\n    <lastmod>${updatedAt.toISOString()}</lastmod>\n  </url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entrees ? `\n${entrees}\n` : "\n"}</urlset>\n`;
}
