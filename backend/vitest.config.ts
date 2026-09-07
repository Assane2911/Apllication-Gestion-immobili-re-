import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./src/test/setupTestDb.ts"],
    // Un seul worker : toutes les suites partagent la même base PGlite en
    // mémoire créée dans setupTestDb.ts (voir le commentaire là-bas).
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
