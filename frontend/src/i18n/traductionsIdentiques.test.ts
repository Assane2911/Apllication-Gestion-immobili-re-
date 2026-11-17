import { describe, expect, it } from "vitest";
import en from "./locales/en";
import es from "./locales/es";
import fr from "./locales/fr";
import pt from "./locales/pt";

/**
 * Une clé présente dans une langue mais dont le texte est IDENTIQUE au français est presque toujours une copie oubliée : le script ou la
 * main qui ajoute les clés duplique le français « en attendant », et personne n'y revient (traductions.test.ts ne regarde que la présence
 * des clés, jamais leur contenu). Exemple trouvé : le titre « Interface Multilingue » de l'accueil, resté en français en portugais.
 *
 * Un mot seul est le plus souvent un mot commun aux langues (Date, Agenda, Email, Notes, Type, Total…) ou un sigle (IBAN) : toléré. Un
 * texte de DEUX MOTS OU PLUS identique au français doit être un nom propre ou un terme technique, déclaré ici.
 */
type Arbre = { [cle: string]: string | Arbre };

function aplatir(objet: Arbre, prefixe = ""): Record<string, string> {
  return Object.entries(objet).reduce<Record<string, string>>((acc, [cle, valeur]) => {
    const chemin = prefixe ? `${prefixe}.${cle}` : cle;
    return typeof valeur === "string" ? { ...acc, [chemin]: valeur } : { ...acc, ...aplatir(valeur, chemin) };
  }, {});
}

/** Textes de plusieurs mots qui s'écrivent pareil dans les quatre langues : noms de produit et termes bancaires internationaux. */
const IDENTIQUES_VOULUS = new Set(["ImmoPlatform Pro", "Mobile Money", "Mobile money", "BIC / SWIFT"]);

function motsDuTexte(valeur: string): string[] {
  return valeur.replace(/\{\{[^}]*\}\}/g, "").match(/[A-Za-zÀ-ÿ]{2,}/g) ?? [];
}

const francais = aplatir(fr as unknown as Arbre);

describe("traductions : aucun texte de plusieurs mots n'est resté en français", () => {
  for (const [nom, arbre] of [
    ["en", en],
    ["es", es],
    ["pt", pt],
  ] as const) {
    it(`${nom} : pas de texte identique au français (hors noms propres et termes techniques déclarés)`, () => {
      const traduit = aplatir(arbre as unknown as Arbre);
      const copies = Object.entries(francais)
        .filter(([cle, valeur]) => traduit[cle] === valeur && motsDuTexte(valeur).length >= 2 && !IDENTIQUES_VOULUS.has(valeur))
        .map(([cle, valeur]) => `${cle} = « ${valeur} »`);
      expect(copies, `Textes restés en français en ${nom} :\n${copies.join("\n")}`).toEqual([]);
    });
  }
});
