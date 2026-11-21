import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `.github/dependabot.yml` est ce qui propose les mises à jour de dépendances : sans lui, personne n'est averti du
 * retard (l'avis hebdomadaire ne signale que les failles). Il ne doit pas non plus proposer de version MAJEURE, qui est
 * une migration à décider à part (express 5, vite 8, typescript 7...), ni oublier un dossier de dépendances.
 *
 * Ces contrôles lisent le fichier tel qu'il sera livré ; ils sont ignorés si le dépôt n'est pas complet.
 */
const RACINE = join(__dirname, "../../..");
const FICHIER = join(RACINE, ".github/dependabot.yml");
const dispo = existsSync(FICHIER) && existsSync(join(RACINE, "backend/package.json")) && existsSync(join(RACINE, "frontend/package.json"));

/** Les blocs `- package-ecosystem: …` du fichier, un par entrée. */
function blocs(): string[] {
  return readFileSync(FICHIER, "utf8").split(/^ {2}- package-ecosystem:/m).slice(1);
}

describe.skipIf(!dispo)("Dependabot", () => {
  it("surveille le backend, le frontend et les workflows", () => {
    const resume = blocs().map((b) => `${b.match(/^\s*"([^"]+)"/)?.[1]} ${b.match(/directory:\s*"([^"]+)"/)?.[1]}`);
    expect(resume).toEqual(expect.arrayContaining(["npm /backend", "npm /frontend", "github-actions /"]));
  });

  it("ne propose jamais de version majeure, dans aucune entrée", () => {
    for (const bloc of blocs()) {
      expect(bloc, `entrée sans règle contre les versions majeures :\n${bloc.slice(0, 80)}`).toMatch(/ignore:\s*\n\s*- dependency-name: "\*"\s*\n\s*update-types: \["version-update:semver-major"\]/);
    }
  });

  it("regroupe les mises à jour mineures et les correctifs en une seule pull request", () => {
    for (const bloc of blocs()) {
      expect(bloc).toMatch(/groups:\s*\n\s*[\w-]+:\s*\n\s*update-types: \["minor", "patch"\]/);
    }
  });

  it("est cité dans le README", () => {
    expect(readFileSync(join(RACINE, "README.md"), "utf8")).toContain("dependabot.yml");
  });
});
