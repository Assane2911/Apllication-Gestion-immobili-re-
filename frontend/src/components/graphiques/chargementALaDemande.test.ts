import { describe, expect, it } from "vitest";

/**
 * `recharts` pèse ≈ 380 Ko avant compression. Importé directement par une page, il serait téléchargé avec elle et
 * retarderait l'affichage de ses chiffres. Seul `Graphiques.tsx` l'importe ; les pages passent par
 * `graphiquesALaDemande.ts`, qui le charge après leur premier affichage.
 */
const sources = import.meta.glob<string>(["/src/**/*.ts", "/src/**/*.tsx", "!/src/**/*.test.ts", "!/src/**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("Graphiques chargés à la demande", () => {
  it("seul Graphiques.tsx importe recharts", () => {
    const fautifs = Object.entries(sources)
      .filter(([chemin, contenu]) => /from\s+["']recharts["']/.test(contenu) && !chemin.endsWith("/components/graphiques/Graphiques.tsx"))
      .map(([chemin]) => chemin);
    expect(fautifs).toEqual([]);
    expect(sources["/src/components/graphiques/Graphiques.tsx"]).toMatch(/from\s+["']recharts["']/);
  });

  it("aucune page n'importe statiquement Graphiques.tsx : elles passent par graphiquesALaDemande", () => {
    const fautifs = Object.entries(sources)
      .filter(([chemin, contenu]) => /from\s+["'][^"']*graphiques\/Graphiques["']/.test(contenu) && !chemin.includes("/components/graphiques/"))
      .map(([chemin]) => chemin);
    expect(fautifs).toEqual([]);
  });
});
