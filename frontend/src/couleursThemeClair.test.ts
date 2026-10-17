import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Garde-fou du thème clair : les gris secondaires de Tailwind (slate-300/400/500)
// sont éclaircis par défaut sous le seuil de lisibilité. index.css les foncé dans
// la zone applicative ; ce test empêche de redescendre sous le seuil WCAG.
const css = readFileSync(resolve(__dirname, "index.css"), "utf8");
const tailwind = readFileSync(resolve(__dirname, "../tailwind.config.js"), "utf8");

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [clair, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (clair + 0.05) / (sombre + 0.05);
}

function variable(nom: string): string {
  const m = css.match(new RegExp(`--${nom}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`Variable --${nom} introuvable dans index.css`);
  return m[1];
}

const canvas = tailwind.match(/canvas:\s*"(#[0-9a-fA-F]{6})"/)![1];
const fonds = { "blanc des cartes": "#ffffff", "fond des pages": canvas };

describe("thème clair — contraste du texte", () => {
  for (const [nom, seuil] of [
    ["texte-400", 4.5],
    ["texte-500", 4.5],
    ["texte-600", 4.5],
    ["texte-300", 3],
  ] as const) {
    for (const [fond, couleurFond] of Object.entries(fonds)) {
      it(`--${nom} sur ${fond} atteint ${seuil}:1`, () => {
        expect(contraste(variable(nom), couleurFond)).toBeGreaterThanOrEqual(seuil);
      });
    }
  }

  it("garde la hiérarchie : 600 plus foncé que 500, 500 plus foncé que 400, 400 plus foncé que 300", () => {
    expect(luminance(variable("texte-600"))).toBeLessThan(luminance(variable("texte-500")));
    expect(luminance(variable("texte-500"))).toBeLessThan(luminance(variable("texte-400")));
    expect(luminance(variable("texte-400"))).toBeLessThan(luminance(variable("texte-300")));
  });

  it("n'agit que dans la zone applicative du thème clair", () => {
    for (const regle of css.match(/html:not\(\.dark\)\s+\[data-surface="app"\][^{]*\.text-slate-\d{3}[^{]*\{/g) ?? []) {
      expect(regle).toContain(":not(.surface-sombre *)");
    }
  });
});
