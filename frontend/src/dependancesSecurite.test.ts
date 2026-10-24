import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Versions minimales des dépendances qui ont eu un avis de sécurité (« npm audit »), tenues par le fichier de
// verrouillage : la version INSTALLÉE est celle du lockfile, pas celle que package.json autorise. Ce sont ici des
// outils de test (aucun n'est livré dans le site), mais ils tournent sur les postes et en CI. Chaque entrée dit quel
// avis la justifie ; relever la valeur à chaque nouvel avis, ne jamais la baisser.
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
  it("vitest et @vitest/mocker ≥ 5.0.3 (GHSA-qxg6-89mg-rqv8, GHSA-xp26-3454-mjgp : injection de code par l'enregistrement manuel de simulacres)", () => {
    expect(auMoins(version("vitest"), [5, 0, 3])).toBe(true);
    expect(auMoins(version("@vitest/mocker"), [5, 0, 3])).toBe(true);
  });

  it("undici ≥ 8.12.2 (GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472, GHSA-xjj6-f33q-929c : déni de service, dont la mémoire saturée de l'analyseur d'événements)", () => {
    expect(auMoins(version("undici"), [8, 12, 2])).toBe(true);
  });

  it("package.json n'autorise plus les versions vulnérables de vitest", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as { devDependencies: Record<string, string> };
    expect(pkg.devDependencies.vitest).toMatch(/^\^5\.0\.([3-9]|\d{2,})/);
    expect(pkg.devDependencies["@vitest/coverage-v8"]).toMatch(/^\^5\.0\.([3-9]|\d{2,})/);
  });
});
