import { describe, expect, it } from "vitest";
import en from "./locales/en";
import es from "./locales/es";
import fr from "./locales/fr";
import pt from "./locales/pt";

/**
 * Une clé absente d'une langue n'échoue pas : i18next affiche la CLÉ BRUTE.
 * L'utilisateur lit alors « manager.tips.contractRenew » au milieu d'une
 * phrase, et rien dans les journaux ne le signale.
 *
 * Le risque n'est pas théorique : les bulles d'aide ont ajouté une trentaine
 * de clés d'un coup, dans quatre fichiers, par script. Un oubli s'y serait
 * glissé sans bruit — et se serait vu d'abord chez un utilisateur
 * hispanophone ou lusophone, c'est-à-dire le plus tard possible.
 */
type Arbre = { [cle: string]: string | Arbre };

function cheminsDe(objet: Arbre, prefixe = ""): string[] {
  return Object.entries(objet).flatMap(([cle, valeur]) => {
    const chemin = prefixe ? `${prefixe}.${cle}` : cle;
    return typeof valeur === "string" ? [chemin] : cheminsDe(valeur, chemin);
  });
}

const langues: Array<[string, Arbre]> = [
  ["en", en as unknown as Arbre],
  ["es", es as unknown as Arbre],
  ["pt", pt as unknown as Arbre],
];

describe("Traductions — les quatre langues décrivent la même application", () => {
  const referenceFr = cheminsDe(fr as unknown as Arbre);

  it.each(langues)("%s ne laisse aucune clé du français sans traduction", (nom, arbre) => {
    const traduites = new Set(cheminsDe(arbre));
    const manquantes = referenceFr.filter((chemin) => !traduites.has(chemin));

    expect(manquantes, `Clés absentes de ${nom} : ${manquantes.slice(0, 20).join(", ")}`).toEqual([]);
  });

  it.each(langues)("%s n'invente aucune clé que le français ignore", (nom, arbre) => {
    // L'inverse compte aussi : une clé qui n'existe que dans une langue est
    // du texte mort, ou le signe d'une faute de frappe dans le nom.
    const enFrancais = new Set(referenceFr);
    const orphelines = cheminsDe(arbre).filter((chemin) => !enFrancais.has(chemin));

    expect(orphelines, `Clés en trop dans ${nom} : ${orphelines.slice(0, 20).join(", ")}`).toEqual([]);
  });

  it("traduit chaque bulle d'aide ajoutée", () => {
    // Garde ciblé : les bulles expliquent des gestes irréversibles. Une bulle
    // qui afficherait sa clé brute serait pire que pas de bulle du tout.
    const bulles = referenceFr.filter((c) => c.includes(".tips") || c.includes("tipsTenant") || c.includes("tipsOwner"));
    expect(bulles.length).toBeGreaterThan(30);

    for (const [nom, arbre] of langues) {
      const traduites = new Set(cheminsDe(arbre));
      for (const bulle of bulles) {
        expect(traduites.has(bulle), `${bulle} absente de ${nom}`).toBe(true);
      }
    }
  });
});
