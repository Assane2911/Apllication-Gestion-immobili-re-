import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cache navigateur des fichiers du site.
 *
 * Vite nomme chaque fichier de `/assets/` avec une empreinte de son contenu (`index-CS7rEG0o.js`) : un fichier ne
 * change jamais sans changer de nom. Vercel les servait pourtant avec `max-age=0, must-revalidate` — « à revalider à
 * chaque visite » — si bien que le navigateur renvoyait une requête de vérification pour chacun des ~25 fichiers, à
 * chaque visite, pour rien. Une durée d'un an avec `immutable` supprime ces allers-retours.
 *
 * Cette règle n'est sûre que tant que TOUT ce qui est servi sous `/assets/` porte une empreinte, et que la page
 * d'entrée (`index.html`, qui désigne les fichiers à charger) reste, elle, toujours revalidée. Ce test tient ces deux
 * conditions.
 */
const RACINE = join(__dirname, "..");

type Entete = { key: string; value: string };
type Regle = { source: string; headers: Entete[] };
const { headers: regles } = JSON.parse(readFileSync(join(RACINE, "vercel.json"), "utf8")) as { headers: Regle[] };

const cacheControl = (regle: Regle) => regle.headers.find((h) => h.key.toLowerCase() === "cache-control")?.value;

describe("cache des fichiers à empreinte (/assets/)", () => {
  const regleAssets = regles.find((r) => r.source === "/assets/(.*)");

  it("une règle dédiée à /assets/ existe", () => {
    expect(regleAssets).toBeDefined();
  });

  it("garde les fichiers un an, sans revalidation (immutable)", () => {
    const valeur = cacheControl(regleAssets!) ?? "";
    expect(valeur).toMatch(/\bpublic\b/);
    expect(valeur).toMatch(/\bmax-age=31536000\b/);
    expect(valeur).toMatch(/\bimmutable\b/);
  });

  it("n'applique aucune durée de cache au reste du site : la page d'entrée reste revalidée", () => {
    const autres = regles.filter((r) => r !== regleAssets);
    expect(autres.length).toBeGreaterThan(0);
    for (const regle of autres) expect(cacheControl(regle), regle.source).toBeUndefined();
  });

  it("ne change pas les en-têtes de sécurité de la règle générale", () => {
    const generale = regles.find((r) => r.source === "/(.*)")!;
    const noms = generale.headers.map((h) => h.key.toLowerCase());
    for (const attendu of [
      "x-content-type-options",
      "x-frame-options",
      "content-security-policy",
      "content-security-policy-report-only",
      "referrer-policy",
      "permissions-policy",
    ]) {
      expect(noms, attendu).toContain(attendu);
    }
  });
});

describe("tout ce qui est servi sous /assets/ porte une empreinte", () => {
  const config = readFileSync(join(RACINE, "vite.config.ts"), "utf8");
  // On ne garde que les lignes de code : les commentaires du fichier ont le droit de nommer ces options.
  const code = config
    .split("\n")
    .filter((ligne) => !ligne.trim().startsWith("//"))
    .join("\n");

  it("vite.config.ts ne change ni le dossier des fichiers construits ni leurs noms", () => {
    for (const option of ["assetsDir", "entryFileNames", "chunkFileNames", "assetFileNames"]) {
      expect(code, option).not.toContain(option);
    }
  });

  it("aucun fichier copié tel quel depuis public/ ne se retrouve sous /assets/", () => {
    // Les fichiers de public/ sont servis sans empreinte : sous /assets/, ils seraient gardés un an sans pouvoir
    // être mis à jour.
    expect(existsSync(join(RACINE, "public", "assets"))).toBe(false);
  });
});
