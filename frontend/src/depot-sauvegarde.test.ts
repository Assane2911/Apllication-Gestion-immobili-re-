import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Le projet Supabase est sur le plan gratuit : aucune sauvegarde automatique, aucun retour en arrière possible après
 * une fausse manipulation ou une panne. Le workflow `sauvegarde.yml` copie la base chaque nuit (copie chiffrée) et
 * prouve, à chaque fois, qu'elle se restaure. Ces contrôles lisent le fichier tel qu'il sera livré ; le trajet
 * sauvegarde → restauration lui-même est testé côté backend (src/scripts/sauvegarde.test.ts).
 */
const RACINE = join(__dirname, "../..");
const dispo = existsSync(join(RACINE, ".github/workflows/ci.yml"));

const workflow = () => readFileSync(join(RACINE, ".github/workflows/sauvegarde.yml"), "utf8");
const doc = () => readFileSync(join(RACINE, "DEPLOYMENT.md"), "utf8");

describe.skipIf(!dispo)("workflow de sauvegarde nocturne", () => {
  it("tourne chaque nuit, hors des heures des tâches de l'application, et peut être lancé à la main", () => {
    const source = workflow();
    const cron = source.match(/cron:\s*"([^"]+)"/);
    expect(cron, "une planification cron").not.toBeNull();
    const champs = cron![1].trim().split(/\s+/);
    expect(champs).toHaveLength(5);
    // Tous les jours : jour du mois, mois et jour de la semaine libres.
    expect(champs.slice(2)).toEqual(["*", "*", "*"]);
    // Pas à 08 h UTC (tâche quotidienne de l'application) ni à l'heure pile (exécutions planifiées souvent retardées).
    expect(Number(champs[1])).not.toBe(8);
    expect(champs[0]).not.toBe("0");
    expect(source).toMatch(/workflow_dispatch:/);
  });

  it("ne se déclenche jamais sur une pull request ni sur un push : il ne touche la vraie base que de nuit ou à la main", () => {
    const declencheurs = workflow().split(/^jobs:/m)[0];
    expect(declencheurs).not.toMatch(/^\s*pull_request/m);
    expect(declencheurs).not.toMatch(/^\s*push:/m);
  });

  it("n'a que les droits nécessaires : lire le code, ouvrir un ticket en cas d'échec", () => {
    const source = workflow();
    expect(source).toMatch(/^permissions:\s*\n\s+contents: read\s*\n\s+issues: write\s*$/m);
    expect(source).not.toMatch(/write-all/);
    expect(source).not.toMatch(/contents: write/);
  });

  it("ne manipule les secrets que par l'environnement des étapes, jamais dans le texte d'une commande", () => {
    const lignes = workflow()
      .split("\n")
      .filter((l) => l.includes("secrets."));
    expect(lignes.length).toBeGreaterThan(0);
    for (const l of lignes) expect(l, l).toMatch(/^\s+[A-Z_]+:\s*\$\{\{\s*secrets\.[A-Z_]+\s*\}\}\s*$/);
    // Ni trace des commandes (elle afficherait les adresses), ni écho d'un secret.
    expect(workflow()).not.toMatch(/set\s+-[a-z]*x/);
    expect(workflow()).not.toMatch(/echo[^\n]*\$\{?(DATABASE_URL|BACKUP_PASSPHRASE|SUPABASE_DB_URL)/);
  });

  it("utilise les deux secrets attendus et dit clairement lequel manque", () => {
    const source = workflow();
    expect(source).toMatch(/SUPABASE_DB_URL/);
    expect(source).toMatch(/BACKUP_PASSPHRASE/);
    expect(source).toMatch(/Secret manquant|secret manquant/);
  });

  it("utilise un client PostgreSQL de la même version majeure que la base (17) : pg_dump refuse un serveur plus récent", () => {
    const source = workflow();
    expect(source).toMatch(/postgresql-client-17/);
    expect(source).toMatch(/image:\s*postgres:17/);
  });

  it("sauvegarde, restaure dans un PostgreSQL jetable pour le prouver, puis conserve la copie chiffrée", () => {
    const source = workflow();
    const etapes = ["sauvegarder.sh", "verifier-sauvegarde.sh", "actions/upload-artifact@v4"].map((m) => source.indexOf(m));
    expect(etapes.every((i) => i >= 0), "les trois étapes").toBe(true);
    // Dans cet ordre : une copie qui ne se restaure pas n'est jamais déposée.
    expect(etapes).toEqual([...etapes].sort((a, b) => a - b));
    expect(source).toMatch(/retention-days:\s*\d+/);
    // Seule la copie chiffrée est déposée, jamais le dump en clair.
    expect(source).toMatch(/sauvegardes\/\*\.gpg/);
    expect(source).not.toMatch(/sauvegardes\/\*\.dump\b/);
  });

  it("signale un échec par un ticket, sans en créer un nouveau chaque nuit tant que le premier est ouvert", () => {
    const source = workflow();
    expect(source).toMatch(/if:\s*failure\(\)/);
    expect(source).toMatch(/gh issue create/);
    expect(source).toMatch(/gh issue list[^\n]*--state open/);
    expect(source).toMatch(/gh issue comment/);
  });

  it("est documenté : secrets à créer, adresse de connexion utilisable, restauration, limites", () => {
    const d = doc();
    expect(d).toMatch(/Sauvegarde et restauration/);
    expect(d).toMatch(/SUPABASE_DB_URL/);
    expect(d).toMatch(/BACKUP_PASSPHRASE/);
    // Le pooler en mode transaction de Vercel (6543) ne convient pas à pg_dump : la documentation doit le dire.
    expect(d).toMatch(/Session pooler/i);
    expect(d).toMatch(/verifier-sauvegarde\.sh/);
    // Ce que la copie ne couvre pas, dit franchement.
    expect(d).toMatch(/espaces de stockage|fichiers déposés/);
  });
});
