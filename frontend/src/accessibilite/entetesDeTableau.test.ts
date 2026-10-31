import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Les en-têtes de tableau de l'espace sont en bleu de plan avec un texte blanc (voir index.css). Une couleur posée sur la
// ligne d'en-tête (`<tr class="text-slate-600">`) ou sur une cellule redonnait du gris sur du bleu : illisible (2,2:1).
// La règle de la feuille de styles est donc prioritaire (`!important`) et couvre les lignes et cellules, pas seulement `th`.
const SRC = resolve(__dirname, "..");
const css = readFileSync(resolve(SRC, "index.css"), "utf8");

describe("en-têtes de tableau lisibles", () => {
  it("le fond bleu de plan et le texte blanc sont posés sur `thead`", () => {
    expect(css).toMatch(/\[data-surface="app"\] thead \{[^}]*background-color: var\(--color-ink-900\)[^}]*color: #ffffff/s);
  });

  it("tout ce qui est dans l'en-tête hérite du blanc, même si une classe pose une autre couleur", () => {
    const regle = css.match(/\[data-surface="app"\] thead :is\(([^)]*)\) \{[^}]*color: inherit !important/s);
    expect(regle).not.toBeNull();
    for (const balise of ["tr", "th", "td", "button", "a", "span"]) expect(regle?.[1]).toContain(balise);
  });

  it("aucun en-tête n'est dessiné sur un fond sombre posé à la main avec du texte gris", () => {
    const fichiers: string[] = [];
    const parcourir = (dossier: string) =>
      readdirSync(dossier).forEach((nom) => {
        const chemin = join(dossier, nom);
        if (statSync(chemin).isDirectory()) parcourir(chemin);
        else if (/\.tsx$/.test(nom) && !/\.test\./.test(nom)) fichiers.push(chemin);
      });
    parcourir(SRC);
    const fautifs = fichiers.filter((f) => /<thead[^>]*className="[^"]*bg-(ink-900|slate-[789]00)[^"]*text-slate-[3-6]00/.test(readFileSync(f, "utf8")));
    expect(fautifs).toEqual([]);
  });
});
