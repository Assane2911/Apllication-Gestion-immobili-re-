import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La suite du backend mettait ~15 minutes en CI parce que les fichiers de test s'exécutaient un à un
 * (`fileParallelism: false`), avec le motif « toutes les suites partagent la même base ». Ce motif n'est plus vrai :
 * chaque fichier reçoit sa propre base PGlite neuve (voir src/test/setupTestDb.ts). Mesuré sur 187 fichiers / 2721
 * tests : 537 s à 3 workers contre ~15 minutes un à un, sans aucun échec.
 *
 * Ce que le parallélisme suppose, et que ces contrôles gardent : l'isolation par fichier. Le journal de vitest suggère
 * `isolate: false` pour aller encore plus vite — ce serait faux ici : les modules, les `vi.mock` et la base seraient
 * partagés entre fichiers, et les tests se contamineraient.
 */
const configuration = readFileSync(join(__dirname, "../../vitest.config.ts"), "utf8");
// Le code seul, sans les commentaires : ils expliquent justement ce qu'il ne faut pas faire.
const code = configuration.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("configuration de vitest (backend)", () => {
  it("chaque fichier de test garde son propre environnement : jamais `isolate: false`", () => {
    expect(code).not.toMatch(/isolate\s*:\s*false/);
  });

  it("les fichiers de test s'exécutent en parallèle (`fileParallelism` n'est plus désactivé)", () => {
    expect(code).not.toMatch(/fileParallelism\s*:\s*false/);
  });

  it("le nombre de workers est borné : chacun porte une base PGlite (WebAssembly) en mémoire", () => {
    expect(code).toMatch(/maxWorkers\s*:\s*3\b/);
  });

  it("la base de test est bien créée pour chaque fichier (l'hypothèse du parallélisme)", () => {
    const setup = readFileSync(join(__dirname, "../test/setupTestDb.ts"), "utf8");
    expect(setup).toMatch(/const pglite = new PGlite\(\)/); // niveau module : une instance par fichier isolé
    expect(setup).toMatch(/pushSchema\(/);
  });
});
