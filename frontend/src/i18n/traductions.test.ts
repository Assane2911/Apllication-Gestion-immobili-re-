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

/**
 * Les CGU (art. 6) ne garantissent aucune disponibilité absolue et ne promettent pas de permanence : aucun texte
 * visible ne doit donc annoncer « 24/7 », « 7j/7 » ou un taux de disponibilité garanti, dans aucune langue.
 */
describe("engagements commerciaux", () => {
  const tous: Array<[string, Arbre]> = [["fr", fr as unknown as Arbre], ...langues];
  const textes = (arbre: Arbre): string[] =>
    Object.values(arbre).flatMap((v) => (typeof v === "string" ? [v] : textes(v)));

  it.each(tous)("%s : aucune promesse de permanence 24/7 ou de taux de disponibilité garanti", (_nom, arbre) => {
    for (const texte of textes(arbre)) {
      expect(texte, texte).not.toMatch(/24\s?\/\s?7|7\s?j\s?\/\s?7|\bSLA\b|99[.,]\d\s?%/);
    }
  });
});

/**
 * Le guide de démarrage est visible pendant l'essai gratuit : les deux endroits qui décrivent l'essai (page des
 * tarifs de l'accueil, bandeau d'essai dans l'application) doivent l'annoncer, dans chaque langue.
 */
describe("guide de démarrage annoncé dans l'essai", () => {
  const motsCles: Record<string, RegExp> = {
    fr: /guide de démarrage/i,
    en: /getting started guide/i,
    es: /guía de inicio/i,
    pt: /guia de início/i,
  };
  const lire = (arbre: Arbre, chemin: string): string =>
    chemin.split(".").reduce<string | Arbre>((noeud, cle) => (noeud as Arbre)[cle], arbre) as string;
  const toutes: Array<[string, Arbre]> = [["fr", fr as unknown as Arbre], ...langues];

  it.each(toutes)("%s : la page des tarifs et le bandeau d'essai mentionnent le guide", (nom, arbre) => {
    expect(lire(arbre, "landing.pricing.subtitle")).toMatch(motsCles[nom]);
    expect(lire(arbre, "components.trialBanner.trialDesc")).toMatch(motsCles[nom]);
  });
});
