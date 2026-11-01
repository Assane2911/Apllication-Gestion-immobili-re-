import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RACINE = resolve(__dirname, "../../..");
const DOSSIERS = ["backend", "frontend"] as const;

/**
 * Chaque dossier est un projet Vercel à part (Root Directory différent) : sans `ignoreCommand`, un commit qui ne touche
 * que l'interface reconstruit aussi le serveur, et inversement — et chaque construction consomme du crédit Vercel.
 * La commande s'exécute dans le Root Directory : le `-- .` limite la comparaison à ce dossier.
 */
describe.skipIf(!existsSync(resolve(RACINE, "backend/vercel.json")))("vercel.json — constructions ignorées", () => {
  for (const dossier of DOSSIERS) {
    it(`${dossier} n'est reconstruit que si ${dossier}/ a changé`, () => {
      const config = JSON.parse(readFileSync(resolve(RACINE, dossier, "vercel.json"), "utf-8")) as { ignoreCommand?: string };
      expect(config.ignoreCommand).toBeDefined();
      // Compare le dernier déploiement réussi de la branche (ou le commit parent) au commit construit.
      expect(config.ignoreCommand).toContain("git diff --quiet");
      expect(config.ignoreCommand).toContain("VERCEL_GIT_PREVIOUS_SHA");
      expect(config.ignoreCommand).toContain("HEAD");
      // Limité au dossier du projet : sans cela, tout changement du dépôt déclencherait la construction.
      expect(config.ignoreCommand).toMatch(/-- \.$/);
      // Un commit de comparaison introuvable (réalignement après une fusion en squash) doit donner « construire »
      // (code 1) : `git diff` seul sortirait en 128, que Vercel traite comme une erreur de déploiement.
      expect(config.ignoreCommand).toMatch(/^git cat-file -e \S+\^\{commit\} 2>\/dev\/null \|\| exit 1; git diff --quiet /);
    });
  }
});
