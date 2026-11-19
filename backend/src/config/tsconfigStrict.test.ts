import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Le serveur n'avait aucun contrôle des variables, imports et paramètres inutilisés : 26 s'y étaient accumulés (dont 9 dans
 * le code livré), alors que le frontend les interdit depuis longtemps — c'est d'ailleurs une variable inutilisée (TS6133) qui
 * a un jour fait échouer un déploiement. `tsc --noEmit`, rejoué par la CI à chaque pull request, les refuse maintenant.
 *
 * Ce test garde le réglage lui-même : le remettre à `false` ne ferait rien échouer, les restes réapparaîtraient en silence.
 */
const RACINE = join(__dirname, "../..");
const tsconfig = join(RACINE, "tsconfig.json");

describe.skipIf(!existsSync(tsconfig))("tsconfig du serveur", () => {
  const lu = () => JSON.parse(readFileSync(tsconfig, "utf8")) as { compilerOptions: Record<string, unknown> };

  it("garde le mode strict", () => {
    expect(lu().compilerOptions.strict).toBe(true);
  });

  it("interdit les variables, imports et paramètres inutilisés (comme le frontend)", () => {
    const options = lu().compilerOptions;
    expect(options.noUnusedLocals).toBe(true);
    expect(options.noUnusedParameters).toBe(true);
  });
});
