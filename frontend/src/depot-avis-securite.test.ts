import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Une vulnérabilité publiée après le dernier contrôle passe inaperçue tant que personne ne lance `npm audit` à la
 * main : c'est ainsi qu'un avis « high » sur follow-redirects n'a été vu que par hasard. Le workflow
 * `avis-securite.yml` contrôle chaque semaine les dépendances de PRODUCTION et ouvre un ticket quand il en trouve.
 *
 * Il ne doit jamais bloquer le travail en cours : un avis publié du jour au lendemain ferait échouer des pull
 * requests sans rapport avec lui. Ces contrôles lisent le fichier tel qu'il sera livré.
 */
const RACINE = join(__dirname, "../..");
const dispo = existsSync(join(RACINE, ".github/workflows/ci.yml"));

function workflow(): string {
  return readFileSync(join(RACINE, ".github/workflows/avis-securite.yml"), "utf8");
}

describe.skipIf(!dispo)("workflow hebdomadaire des avis de sécurité", () => {
  it("tourne chaque semaine et peut être lancé à la main", () => {
    const source = workflow();
    const cron = source.match(/cron:\s*"([^"]+)"/);
    expect(cron, "une planification cron").not.toBeNull();
    const champs = cron![1].trim().split(/\s+/);
    expect(champs).toHaveLength(5);
    // Jour de la semaine précisé, jour du mois et mois libres : une fois par semaine.
    expect(champs[4]).toMatch(/^[0-6]$/);
    expect(champs[2]).toBe("*");
    expect(champs[3]).toBe("*");
    expect(source).toMatch(/workflow_dispatch:/);
  });

  it("ne se déclenche jamais sur une pull request ni sur un push : il ne bloque aucun travail en cours", () => {
    const declencheurs = workflow().split(/^jobs:/m)[0];
    expect(declencheurs).not.toMatch(/^\s*pull_request/m);
    expect(declencheurs).not.toMatch(/^\s*push:/m);
  });

  it("contrôle les dépendances de production du backend ET du frontend, à partir du fichier de verrouillage", () => {
    const source = workflow();
    expect(source).toMatch(/dossier:\s*\[\s*backend\s*,\s*frontend\s*\]/);
    expect(source).toMatch(/npm audit --omit=dev --audit-level=moderate/);
    // Le contrôle lit package-lock.json : inutile (et plus lent) d'installer quoi que ce soit.
    expect(source).not.toMatch(/npm (ci|install)/);
  });

  it("n'a que les droits nécessaires : lire le code, ouvrir un ticket", () => {
    const source = workflow();
    expect(source).toMatch(/^permissions:\s*\n\s+contents: read\s*$/m);
    expect(source).toMatch(/^\s+issues: write\s*$/m);
    expect(source).not.toMatch(/write-all/);
    expect(source).not.toMatch(/contents: write/);
    expect(source).not.toMatch(/pull-requests: write/);
  });

  it("signale par un ticket, sans en créer un nouveau chaque semaine tant que le premier est ouvert", () => {
    const source = workflow();
    expect(source).toMatch(/gh issue create/);
    expect(source).toMatch(/gh issue list[^\n]*--state open/);
    expect(source).toMatch(/gh issue comment/);
  });
});
