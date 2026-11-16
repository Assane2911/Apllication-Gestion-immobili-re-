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

// Domaine public du site : celui que les visiteurs tapent (l'apex immoplatformpro.com y redirige en 308). Surtout
// pas l'adresse .vercel.app de l'API, qui n'est pas celle du site : le plan du site, les aperçus de liens et les
// données structurées y répondaient 404. Même valeur dans src/utils/structuredData.ts, index.html
// et public/robots.txt (verrouillé par src/depot-domaine.test.ts).
export const SITE_URL = "https://www.immoplatformpro.com";
const API_URL = process.env.VITE_API_URL ?? "http://localhost:4000";
const MAX_PAGE_SIZE = 100;

export const STATIC_ROUTES = [
  { path: "/", priority: "1.0" },
  // /landing affiche la même page que / et pointe vers elle (balise canonique) : seules les adresses canoniques y figurent.
  { path: "/vitrine", priority: "0.9" },
  { path: "/inscription", priority: "0.8" },
  { path: "/mentions-legales", priority: "0.3" },
  { path: "/cgu", priority: "0.3" },
  { path: "/confidentialite", priority: "0.3" },
];

// Pages publiques qui existent aussi en anglais, espagnol et portugais, à leur propre adresse (« /en », « /es/vitrine »…).
// Même liste que src/utils/langueUrl.ts, dont src/utils/langueUrl.test.ts vérifie l'accord.
export const LANGUES_PREFIXEES = ["en", "es", "pt"];
export const PAGES_TRADUITES = ["/", "/vitrine"];

/** Les quatre versions d'une page traduite : { fr: « /vitrine », en: « /en/vitrine »… }. */
export function versionsDeLaPage(chemin) {
  const versions = { fr: chemin };
  for (const langue of LANGUES_PREFIXEES) versions[langue] = chemin === "/" ? `/${langue}` : `/${langue}${chemin}`;
  return versions;
}

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

/**
 * `alternates` (facultatif) : les versions de la page dans chaque langue, { fr: url, en: url… }. Chaque version se liste elle-même
 * et ses sœurs, avec le français en « x-default » — c'est ce que Google demande pour relier les versions d'une page.
 */
export function construireSitemap(urls) {
  const avecLangues = urls.some((u) => u.alternates);
  const entrees = urls
    .map(({ loc, priority, alternates }) => {
      const liens = alternates
        ? Object.entries(alternates)
            .map(([langue, href]) => `\n    <xhtml:link rel="alternate" hreflang="${langue}" href="${echapperXml(href)}"/>`)
            .join("") + `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${echapperXml(alternates.fr)}"/>`
        : "";
      return `  <url>\n    <loc>${echapperXml(loc)}</loc>${liens}\n    <priority>${priority}</priority>\n  </url>`;
    })
    .join("\n");
  const espaces = avecLangues ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${espaces}>\n${entrees}\n</urlset>\n`;
}

/** Les entrées du plan pour les pages statiques : une par langue pour une page traduite, reliées entre elles. */
export function entreesStatiques() {
  const entrees = [];
  for (const { path, priority } of STATIC_ROUTES) {
    if (!PAGES_TRADUITES.includes(path)) {
      entrees.push({ loc: `${SITE_URL}${path}`, priority });
      continue;
    }
    const versions = versionsDeLaPage(path);
    const alternates = Object.fromEntries(Object.entries(versions).map(([langue, chemin]) => [langue, `${SITE_URL}${chemin}`]));
    for (const chemin of Object.values(versions)) entrees.push({ loc: `${SITE_URL}${chemin}`, priority, alternates });
  }
  return entrees;
}

async function main() {
  const urls = entreesStatiques();

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
