import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Versions minimales des dépendances qui ont eu un avis de sécurité (« npm audit »), tenues par le fichier de
// verrouillage : la version INSTALLÉE en production est celle du lockfile, pas celle que package.json autorise.
// Chaque entrée dit quel avis la justifie. Relever une valeur ici quand un nouvel avis paraît ; ne jamais la baisser.
const lock = JSON.parse(readFileSync(resolve(__dirname, "../package-lock.json"), "utf8")) as {
  packages: Record<string, { version?: string }>;
};

function version(nom: string): number[] {
  const v = lock.packages[`node_modules/${nom}`]?.version;
  if (!v) throw new Error(`${nom} absent de package-lock.json`);
  return v.split(".").map((n) => parseInt(n, 10));
}

function auMoins(actuelle: number[], minimale: number[]): boolean {
  for (let i = 0; i < minimale.length; i++) {
    if ((actuelle[i] ?? 0) !== minimale[i]) return (actuelle[i] ?? 0) > minimale[i];
  }
  return true;
}

describe("dépendances : versions corrigées des avis de sécurité", () => {
  it("body-parser ≥ 1.20.9 (GHSA-27r3-jxmh-p828 : déni de service par des octets après un corps compressé)", () => {
    expect(auMoins(version("body-parser"), [1, 20, 9])).toBe(true);
  });

  it("multer ≥ 2.5.0 (GHSA-q7qp-rjg7-q26m : déni de service par un fileFilter asynchrone resté en attente)", () => {
    expect(auMoins(version("multer"), [2, 5, 0])).toBe(true);
  });

  it("zod ≥ 4.6.6 (GHSA-mrhx-c7xc-m3w5 : mémoire saturée par la validation de très grandes collections)", () => {
    expect(auMoins(version("zod"), [4, 6, 6])).toBe(true);
  });

  it("package.json n'autorise plus la version vulnérable de zod", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies.zod).toMatch(/^\^4\.(6\.[6-9]|6\.\d{2,}|[7-9]|\d{2,})/);
  });

  it("vitest et @vitest/mocker ≥ 5.0.3 (GHSA-qxg6-89mg-rqv8, GHSA-xp26-3454-mjgp : injection de code par l'enregistrement manuel de simulacres)", () => {
    expect(auMoins(version("vitest"), [5, 0, 3])).toBe(true);
    expect(auMoins(version("@vitest/mocker"), [5, 0, 3])).toBe(true);
  });

  it("package.json n'autorise plus les versions vulnérables de vitest", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as { devDependencies: Record<string, string> };
    expect(pkg.devDependencies.vitest).toMatch(/^\^5\.0\.([3-9]|\d{2,})/);
    expect(pkg.devDependencies["@vitest/coverage-v8"]).toMatch(/^\^5\.0\.([3-9]|\d{2,})/);
  });

  it("package.json n'autorise plus la version vulnérable de multer", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies.multer).toMatch(/^\^2\.5\./);
  });
});
