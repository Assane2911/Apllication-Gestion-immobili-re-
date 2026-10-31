import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Le jaune d'accent (cartes, lignes, ombres) est posé UNE fois, dans index.css, par des règles globales sur la zone
// applicative : les cartes sont écrites en ligne dans ~100 endroits des pages (`bg-white … border`), les réécrire une
// à une serait ingérable. Ce test tient les garde-fous : le jaune reste dans la zone applicative, hors surfaces
// toujours sombres.
const css = readFileSync(resolve(__dirname, "index.css"), "utf8");

/** Les règles dont le sélecteur contient `motif`, avec leur corps. */
function regles(motif: RegExp): Array<{ selecteur: string; corps: string }> {
  const trouvees: Array<{ selecteur: string; corps: string }> = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (motif.test(m[1])) trouvees.push({ selecteur: m[1].trim(), corps: m[2] });
  }
  return trouvees;
}

describe("accent jaune — cartes", () => {
  it("pose un liseré jaune en haut des cartes du thème clair", () => {
    const r = regles(/html[^{]*\.bg-white\.border/).filter((x) => /inset 0 2px 0 0 var\(--jaune-trait\)/.test(x.corps));
    expect(r.length).toBeGreaterThan(0);
  });

  it("reste dans la zone applicative et hors des surfaces toujours sombres", () => {
    const r = regles(/\.border/).filter((x) => /var\(--jaune-trait\)/.test(x.corps));
    expect(r.length).toBeGreaterThan(0);
    for (const regle of r) {
      expect(regle.selecteur).toContain('[data-surface="app"]');
      expect(regle.selecteur).toContain(".surface-sombre *");
    }
  });

  it("ne remplace pas les ombres que les cartes déclarent elles-mêmes", () => {
    // Les règles qui posent `box-shadow` d'office ne visent que les cartes SANS aucune ombre ; les autres reçoivent le
    // liseré par les variables d'ombre de Tailwind, qui s'ajoutent à leur ombre.
    const r = regles(/\.border/).filter((x) => /(^|[\s;])box-shadow:/.test(x.corps) && /jaune|--tw-inset-shadow/.test(x.corps));
    expect(r.length).toBeGreaterThan(0);
    for (const regle of r) expect(regle.selecteur).toMatch(/\[class\*="shadow"\]/);
    const variables = regles(/\.border/).filter((x) => /--tw-inset-shadow:\s*inset 0 2px 0 0 var\(--jaune-trait\)/.test(x.corps));
    expect(variables.length).toBeGreaterThan(0);
    for (const regle of variables) expect(regle.selecteur).not.toMatch(/\[class\*="shadow"\]/);
  });

  it("n'empile pas le liseré sur les cartes imbriquées", () => {
    const r = regles(/\.border/).filter((x) => /var\(--jaune-trait\)/.test(x.corps));
    expect(r.length).toBeGreaterThan(0);
    for (const regle of r) expect(regle.selecteur).toMatch(/\.border(\[[^\]]*\])? \*/);
  });
});

describe("accent jaune — variables et survol", () => {
  it("définit trait et lueur", () => {
    expect(css).toMatch(/--jaune-trait:\s*rgb\(/);
    expect(css).toMatch(/--jaune-lueur:\s*rgb\(/);
  });

  it("teinte de jaune la bordure et l'ombre des cartes qui se soulèvent au survol", () => {
    const m = css.match(/@utility card-hover \{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/yellow|jaune/);
  });

  it("garde les contours dans une teinte claire (séparateurs lisibles mais discrets)", () => {
    for (const nom of ["contour-100", "contour-200"]) {
      const m = css.match(new RegExp(`--color-${nom}:\\s*(#[0-9a-fA-F]{6})`));
      expect(m).not.toBeNull();
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(m![1].slice(i, i + 2), 16));
      expect(Math.min(r, g, b)).toBeGreaterThan(160); // assez clair pour rester discret, assez marqué pour se voir sur le papier sable
      expect(Math.abs(r - b)).toBeLessThan(40); // gris bleuté du plan : jamais une couleur franche
    }
  });
});
