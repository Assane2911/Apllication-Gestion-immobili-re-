import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Aucun identifiant ne doit subsister dans le code du frontend.
 *
 * Régression. La page de connexion embarquait deux comptes de démonstration
 * avec leur mot de passe en clair, et les quatre fichiers de traduction
 * l'affichaient même à l'écran. Ce n'est pas comparable à un secret laissé
 * dans un dépôt : TOUT ce qui est dans le frontend est servi au navigateur de
 * n'importe quel visiteur. Le mot de passe était donc public pour qui ouvrait
 * simplement le site, sans avoir à lire le code source.
 *
 * Ce test balaie les sources plutôt qu'un composant précis : le défaut peut
 * réapparaître n'importe où — un composant, une traduction, un commentaire,
 * un fichier d'exemple.
 */
const RACINE = path.resolve(__dirname);

// Motifs construits par morceaux : sans cela, ce fichier se signalerait
// lui-même s'il venait à être analysé.
const MOTIFS: { nom: string; motif: RegExp }[] = [
  { nom: "mot de passe de démonstration", motif: new RegExp("Demo" + "1234") },
  { nom: "adresse de compte de démonstration", motif: new RegExp("@demo" + "\\.com") },
  { nom: "clé de service Supabase", motif: new RegExp("service" + "_role") },
  { nom: "clé secrète Stripe", motif: new RegExp("sk_" + "live|sk_" + "test") },
];

function fichiersSources(dossier: string): string[] {
  const trouves: string[] = [];
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory()) {
      trouves.push(...fichiersSources(chemin));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entree.name)) continue;
    // Les fichiers de test peuvent légitimement contenir des valeurs factices.
    if (/\.test\.tsx?$/.test(entree.name)) continue;
    trouves.push(chemin);
  }
  return trouves;
}

describe("aucun identifiant dans le code livré au navigateur", () => {
  for (const { nom, motif } of MOTIFS) {
    it(`ne contient aucun ${nom}`, () => {
      const coupables = fichiersSources(RACINE).filter((fichier) =>
        motif.test(fs.readFileSync(fichier, "utf8"))
      );

      expect(
        coupables.map((f) => path.relative(RACINE, f)),
        `Ces fichiers sont servis au navigateur de chaque visiteur et ne doivent contenir aucun ${nom}`
      ).toEqual([]);
    });
  }
});
