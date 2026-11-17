import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Dans l'espace applicatif, index.css fonce les gris `text-slate-300/400/500` pour qu'ils restent lisibles sur le papier clair
 * (`html [data-surface="app"] .text-slate-300:not(.surface-sombre *)`). Sur un fond sombre, c'est l'inverse : un `text-slate-300`
 * devient un gris moyen (3,5:1 sur l'encre au lieu de 8:1) et le libellé se perd. Une surface sombre qui contient de ces gris doit
 * donc porter la classe `surface-sombre`, qui les exclut de la règle.
 *
 * Mesuré dans un navigateur sur le compte rendu de gestion d'un propriétaire : « Net à reverser » (10 px) à 3,51:1.
 */
function source(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}

describe("surfaces sombres : les gris clairs restent clairs", () => {
  it("DecompteCrg : la case « Net à reverser » (fond encre) porte surface-sombre", () => {
    const src = source("./components/DecompteCrg.tsx");
    expect(src).toMatch(/net \? "[^"]*\bsurface-sombre\b[^"]*\bbg-ink-900\b[^"]*"|net \? "[^"]*\bbg-ink-900\b[^"]*\bsurface-sombre\b[^"]*"/);
  });
});
