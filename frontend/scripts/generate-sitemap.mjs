#!/usr/bin/env node
/**
 * Génère dist/sitemap.xml après le build Vite : interroge les annonces
 * PUBLISHED réellement en base (GET /api/listings/public, déjà exposée
 * publiquement — voir VitrinePage/VitrineListingPage) pour leur donner une
 * entrée propre, en plus des pages statiques du site.
 *
 * Résilient à dessein : si le backend est injoignable au moment du build
 * (déploiement backend en cours, panne temporaire...), on écrit quand même un
 * sitemap valide limité aux pages statiques plutôt que de faire échouer tout
 * le build du frontend pour une page secondaire.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Domaine réel du frontend déployé (constaté, pas un placeholder) — à mettre
// à jour si un nom de domaine personnalisé est un jour rattaché au projet.
export const SITE_URL = "https://apllication-gestion-immobili-re.vercel.app";
const API_URL = process.env.VITE_API_URL ?? "http://localhost:4000";
const MAX_PAGE_SIZE = 100;

export const STATIC_ROUTES = [
  { path: "/", priority: "1.0" },
  { path: "/landing", priority: "1.0" },
  { path: "/vitrine", priority: "0.9" },
  { path: "/mentions-legales", priority: "0.3" },
  { path: "/cgu", priority: "0.3" },
  { path: "/confidentialite", priority: "0.3" },
];

export function echapperXml(texte) {
  return texte.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Toutes les annonces PUBLISHED, tous pays/types confondus, page par page. */
async function recupererIdsAnnoncesPubliees() {
  const ids = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await fetch(`${API_URL}/api/listings/public?page=${page}&pageSize=${MAX_PAGE_SIZE}`);
    if (!res.ok) throw new Error(`GET /listings/public a répondu ${res.status}`);
    const donnees = await res.json();
    for (const annonce of donnees.items ?? []) ids.push(annonce.id);
    totalPages = donnees.totalPages ?? 1;
    page += 1;
  } while (page <= totalPages);
  return ids;
}

export function construireSitemap(urls) {
  const entrees = urls
    .map(({ loc, priority }) => `  <url>\n    <loc>${echapperXml(loc)}</loc>\n    <priority>${priority}</priority>\n  </url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entrees}\n</urlset>\n`;
}

async function main() {
  const urls = STATIC_ROUTES.map(({ path, priority }) => ({ loc: `${SITE_URL}${path}`, priority }));

  try {
    const ids = await recupererIdsAnnoncesPubliees();
    for (const id of ids) urls.push({ loc: `${SITE_URL}/vitrine/annonces/${id}`, priority: "0.7" });
    console.log(`sitemap.xml : ${ids.length} annonce(s) publiée(s) incluse(s).`);
  } catch (err) {
    console.warn(
      `sitemap.xml : impossible de lister les annonces publiées depuis ${API_URL} (${err.message}) — sitemap limité aux pages statiques.`
    );
  }

  const dossierDist = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
  mkdirSync(dossierDist, { recursive: true });
  writeFileSync(resolve(dossierDist, "sitemap.xml"), construireSitemap(urls));
  console.log(`sitemap.xml écrit (${urls.length} URL) dans ${dossierDist}`);
}

// Ne s'exécute que lancé directement (`node generate-sitemap.mjs`) — pas à
// l'import de ses fonctions pures (construireSitemap, échapperXml) par les
// tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
