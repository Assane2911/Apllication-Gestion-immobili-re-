import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./src/test/setupTestDb.ts"],
    // Les fichiers de test s'exécutent en parallèle : chacun reçoit sa propre
    // base PGlite neuve (setupTestDb.ts crée l'instance au niveau du module, et
    // chaque fichier a son propre environnement), donc rien n'est partagé entre
    // eux. Mesuré : 187 fichiers / 2721 tests en ~9 min à 3 workers, contre ~15 min
    // un à un en CI, sans aucun échec.
    //
    // NE PAS passer `isolate: false`, malgré la suggestion du journal de vitest :
    // modules, `vi.mock` et base seraient alors partagés entre fichiers, et les
    // tests se contamineraient (src/config/vitestConfig.test.ts le garde).
    //
    // 3 workers : chacun porte une base PGlite (WebAssembly) en mémoire, et les
    // machines de la CI publique ont 4 cœurs.
    maxWorkers: 3,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
