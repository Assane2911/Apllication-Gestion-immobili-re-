import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Une adresse e-mail affichée dans l'espace gestionnaire passe par `LienCourriel` (lien d'écriture + bouton « Copier »), pas par un
 * lien « mailto: » seul : sans messagerie configurée sur le poste, un tel lien n'ouvre rien et n'explique rien.
 *
 * Restent volontairement en « mailto: » : la vitrine publique (le visiteur choisit sa propre messagerie, et un formulaire de contact
 * existe à côté) et le partage de parrainage (adresse du destinataire choisie dans la messagerie de la personne).
 */
const SRC = __dirname;
const AUTORISES = ["components/LienCourriel.tsx", "pages/VitrineListingPage.tsx", "utils/syntheseCompte.ts", "components/BoutonEcrire.tsx", "components/BoutonRappelEssai.tsx"];

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiers(chemin);
    return /\.(ts|tsx)$/.test(chemin) && !/\.test\.tsx?$/.test(chemin) ? [chemin] : [];
  });
}

describe("adresses e-mail de l'espace gestionnaire", () => {
  it("aucun lien « mailto: » direct hors des endroits prévus", () => {
    const fautifs: string[] = [];
    for (const f of fichiers(SRC)) {
      const rel = f.slice(SRC.length + 1).replaceAll("\\", "/");
      if (AUTORISES.includes(rel)) continue;
      // Sans les commentaires : « mailto: » cité dans une explication n'est pas un lien.
      const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      if (/mailto:/.test(code)) fautifs.push(rel);
    }
    expect(fautifs).toEqual([]);
  });
});
