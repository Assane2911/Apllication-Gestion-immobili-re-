/**
 * Adresse PUBLIQUE du site : celle que les visiteurs tapent et que les moteurs de recherche indexent (l'apex immoplatformpro.com y
 * redirige). Surtout pas celle de l'API. Même valeur que `SITE_URL` du site (frontend/scripts/generate-sitemap.mjs, et
 * frontend/src/utils/structuredData.ts), dont frontend/src/depot-domaine.test.ts verrouille l'accord.
 */
export const SITE_URL = "https://www.immoplatformpro.com";
