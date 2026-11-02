import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RACINE = join(__dirname, "..", "..");

/**
 * La détection d'une nouvelle version (utils/versionPubliee.ts) repose sur deux choses que le build doit fournir ensemble :
 * l'identifiant inscrit dans le code (`__BUILD_ID__`) et le même identifiant publié dans `/version.json`. L'un sans l'autre, et
 * chaque onglet croirait à une nouvelle version (ou jamais).
 */
describe("publication de la version du site", () => {
  const config = readFileSync(join(RACINE, "vite.config.ts"), "utf8");

  it("le build inscrit son identifiant dans le code ET le publie dans version.json, depuis la même valeur", () => {
    expect(config).toMatch(/define:\s*\{\s*__BUILD_ID__:\s*JSON\.stringify\(buildId\)/);
    expect(config).toMatch(/fileName:\s*'version\.json'/);
    expect(config).toMatch(/JSON\.stringify\(\{\s*version:\s*buildId\s*\}\)/);
  });

  it("l'identifiant vient du commit déployé, pour qu'un redéploiement du même code ne change rien d'inutile", () => {
    expect(config).toContain("VERCEL_GIT_COMMIT_SHA");
  });

  it("version.json n'est servi sous aucune règle de cache long (seul /assets/ en a une)", () => {
    const { headers } = JSON.parse(readFileSync(join(RACINE, "vercel.json"), "utf8")) as { headers: Array<{ source: string }> };
    expect(headers.filter((h) => /version/.test(h.source))).toEqual([]);
    expect(headers.filter((h) => h.source !== "/(.*)" && h.source !== "/assets/(.*)")).toEqual([]);
  });
});
