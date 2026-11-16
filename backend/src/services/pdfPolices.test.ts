import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Les polices de pdfkit doivent être référencées statiquement (voir pdfPolices.ts) : sans cela l'hébergeur les omet de la fonction
 * serverless et la génération d'un PDF (quittance, mise en demeure…) échoue en production.
 */
const SRC = join(__dirname, "..");
const exiger = createRequire(__filename);
const source = readFileSync(join(__dirname, "pdfPolices.ts"), "utf8");
const declarees = [...source.matchAll(/^import "(pdfkit\/standard-fonts\/[A-Za-z]+)";$/gm)].map((m) => m[1]);

function fichiersTs(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiersTs(chemin);
    return /\.ts$/.test(nom) && !/\.test\.ts$/.test(nom) ? [chemin] : [];
  });
}

describe("polices standard de pdfkit embarquées", () => {
  it("chaque référence se résout vers un fichier existant (chemin public exporté par pdfkit)", () => {
    expect(declarees.length).toBeGreaterThanOrEqual(2);
    for (const specifieur of declarees) expect(() => exiger.resolve(specifieur), specifieur).not.toThrow();
  });

  it("toute police utilisée dans le code est déclarée", () => {
    const utilisees = new Set<string>(["Helvetica"]); // police par défaut d'un document pdfkit
    for (const fichier of fichiersTs(SRC)) {
      for (const m of readFileSync(fichier, "utf8").matchAll(/\.font\("([A-Za-z-]+)"/g)) utilisees.add(m[1]);
    }
    for (const police of utilisees) expect(declarees, `police « ${police} » non déclarée`).toContain(`pdfkit/standard-fonts/${police.replace(/-/g, "")}`);
  });

  it("le service PDF charge cette déclaration", () => {
    expect(readFileSync(join(__dirname, "pdf.service.ts"), "utf8")).toContain('import "./pdfPolices";');
  });
});
