import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Chaque job des workflows GitHub doit avoir un délai maximal (`timeout-minutes`). Sans lui, GitHub applique 6 heures :
 * un test qui se bloque, un `npm audit` qui ne répond pas ou une sauvegarde suspendue tournerait six heures et
 * consommerait des minutes pour rien. Un nouveau job ajouté sans délai fait échouer ce test.
 *
 * Ces contrôles lisent les fichiers tels qu'ils seront livrés ; ils sont ignorés si le dépôt n'est pas complet.
 */
const DOSSIER = join(__dirname, "../../../.github/workflows");
const dispo = existsSync(DOSSIER);

/** Plafond raisonnable : la CI la plus longue dure une dizaine de minutes, la sauvegarde moins de cinq. */
const PLAFOND_MINUTES = 60;

/** Les jobs d'un workflow : nom et texte du bloc, de `  nom:` jusqu'au job suivant. */
function jobs(texte: string): Array<{ nom: string; bloc: string }> {
  const apres = texte.split(/^jobs:\s*$/m)[1] ?? "";
  const morceaux = apres.split(/^ {2}(?=[\w-]+:\s*$)/m).slice(1);
  return morceaux.map((m) => ({ nom: m.split(":")[0], bloc: m }));
}

describe.skipIf(!dispo)("délais maximaux des workflows GitHub", () => {
  const fichiers = dispo ? readdirSync(DOSSIER).filter((f) => f.endsWith(".yml")) : [];

  it("il y a des workflows à contrôler", () => {
    expect(fichiers.length).toBeGreaterThanOrEqual(3);
  });

  for (const fichier of fichiers) {
    it(`${fichier} : chaque job a un délai maximal d'au plus ${PLAFOND_MINUTES} minutes`, () => {
      const liste = jobs(readFileSync(join(DOSSIER, fichier), "utf8"));
      expect(liste.length, `aucun job lu dans ${fichier}`).toBeGreaterThan(0);
      for (const { nom, bloc } of liste) {
        const minutes = Number(bloc.match(/^ {4}timeout-minutes:\s*(\d+)\s*$/m)?.[1]);
        expect(Number.isFinite(minutes), `le job « ${nom} » de ${fichier} n'a pas de timeout-minutes`).toBe(true);
        expect(minutes, `le délai du job « ${nom} » de ${fichier} dépasse ${PLAFOND_MINUTES} minutes`).toBeLessThanOrEqual(PLAFOND_MINUTES);
      }
    });
  }
});
