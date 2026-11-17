import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fous d'accessibilité qui se lisent dans le code : ce qui se vérifie au rendu est dans les tests des composants.
 */
const SRC = __dirname;

function fichiersTsx(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiersTsx(chemin);
    return chemin.endsWith(".tsx") && !/\.test\.tsx$/.test(chemin) ? [chemin] : [];
  });
}

describe("lien d'évitement", () => {
  it("chaque <main> porte l'identifiant que vise « Aller au contenu principal », et peut recevoir le focus", () => {
    const fautifs: string[] = [];
    for (const f of fichiersTsx(SRC)) {
      // Sans les commentaires : un `<main>` cité dans une explication n'est pas une balise.
      const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const balise of code.match(/<main[\s>][^>]*>/g) ?? []) {
        if (!balise.includes('id="contenu-principal"') || !balise.includes("tabIndex={-1}")) fautifs.push(`${f.slice(SRC.length + 1)} : ${balise.slice(0, 70)}`);
      }
    }
    expect(fautifs).toEqual([]);
  });

  it("le lien est posé une fois pour toute l'application, avant tout le reste", () => {
    const app = readFileSync(join(SRC, "App.tsx"), "utf8");
    expect(app.match(/<LienEvitement \/>/g)).toHaveLength(1);
    expect(app.indexOf("<LienEvitement />")).toBeLessThan(app.indexOf("<AppRoutes />"));
  });
});
