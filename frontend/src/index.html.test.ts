import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * index.html est le SEUL document que reçoivent les robots qui ne lisent pas
 * le rendu React (facebookexternalhit, LinkedIn, WhatsApp, X/Twitter — à la
 * différence de Googlebot, qui exécute le JS). frontend/vercel.json réécrit
 * toute URL vers ce même fichier, donc ces balises statiques sont tout ce que
 * ces plateformes voient jamais, quelle que soit la page partagée.
 */
describe("index.html — balises statiques lues par les robots qui n'exécutent pas JavaScript", () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../index.html"), "utf-8");
  // Les balises réellement actives, hors prose des commentaires HTML.
  const htmlSansCommentaires = html.replace(/<!--[\s\S]*?-->/g, "");

  it("déclare le français comme langue du document", () => {
    expect(html).toMatch(/<html lang="fr">/);
  });

  it("expose les balises Open Graph nécessaires à un aperçu de partage", () => {
    expect(htmlSansCommentaires).toMatch(/<meta property="og:type" content="website" \/>/);
    expect(htmlSansCommentaires).toMatch(/<meta property="og:title" content="[^"]+" \/>/);
    expect(htmlSansCommentaires).toMatch(/property="og:description"[\s\S]{0,40}content="[^"]+"/);
    expect(htmlSansCommentaires).toMatch(/<meta property="og:image" content="https:\/\/[^"]+" \/>/);
  });

  it("expose les balises Twitter Card avec une image plein format", () => {
    expect(htmlSansCommentaires).toMatch(/<meta name="twitter:card" content="summary_large_image" \/>/);
    expect(htmlSansCommentaires).toMatch(/<meta name="twitter:image" content="https:\/\/[^"]+" \/>/);
  });

  // Régression : React ne réconcilie pas un <meta> qu'il n'a pas lui-même
  // rendu (vérifié empiriquement) — un <meta name="description"> statique ici
  // se dupliquerait au lieu d'être remplacé par celui que Seo.tsx pose par
  // page. Cette balise doit donc rester absente de ce fichier.
  it('ne pose pas de <meta name="description"> statique (laissée à Seo.tsx par page)', () => {
    expect(htmlSansCommentaires).not.toMatch(/<meta\s+name="description"/);
  });
});
