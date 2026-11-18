import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tableaux lisibles par les lecteurs d'écran.
 *
 *  - Chaque cellule d'en-tête dit ce qu'elle intitule (`scope`). Les navigateurs le devinent dans un `thead`, mais pas
 *    les logiciels d'assistance plus anciens ni une cellule qui sortirait un jour de l'en-tête.
 *  - Un tableau dont on change l'affichage en CSS (`display: block` sur téléphone, pour en faire des cartes) perd sa
 *    structure pour les lecteurs d'écran : ils lisent alors des textes à la suite, sans colonnes. Les rôles ARIA la lui
 *    rendent.
 */
const SRC = join(__dirname, "..");

function fichiersTsx(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiersTsx(chemin);
    return chemin.endsWith(".tsx") && !/\.test\.tsx$/.test(chemin) ? [chemin] : [];
  });
}

function code(chemin: string): string {
  return readFileSync(chemin, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("cellules d'en-tête", () => {
  it("chaque <th> porte un scope", () => {
    const fautives: string[] = [];
    let vues = 0;
    for (const f of fichiersTsx(SRC)) {
      for (const balise of code(f).match(/<th(?=[\s>])[^>]*>/g) ?? []) {
        vues++;
        if (!/\bscope=/.test(balise)) fautives.push(`${f.slice(SRC.length + 1)} : ${balise.slice(0, 70)}`);
      }
    }
    expect(vues, "le test ne tourne pas à vide").toBeGreaterThan(100);
    expect(fautives).toEqual([]);
  });
});

describe("tableaux transformés en cartes sur téléphone", () => {
  const concernes = fichiersTsx(SRC).filter((f) => /<table[^>]*max-sm:block/.test(code(f)));

  it("il en existe au moins un (le test ne tourne pas à vide)", () => {
    expect(concernes.length).toBeGreaterThan(0);
  });

  for (const f of concernes) {
    it(`${f.slice(SRC.length + 1)} : les rôles du tableau sont posés explicitement`, () => {
      const source = code(f);
      expect(source).toMatch(/<table[^>]*role="table"/);
      expect(source).toMatch(/<tbody[^>]*role="rowgroup"/);
      expect(source).toMatch(/<tr[^>]*role="row"/);
      expect(source).toMatch(/<td[^>]*role="cell"/);
    });
  }
});
