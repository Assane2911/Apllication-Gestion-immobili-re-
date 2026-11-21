import { describe, expect, it } from "vitest";
import { TEXTES_ICAL } from "./agendaIcal.textes";
import { TEXTES_SUITE } from "./email.suite.textes";

/**
 * Les textes traduits des e-mails et du calendrier : le français est le texte d'origine, l'anglais, l'espagnol et le
 * portugais (du Portugal) en sont la traduction. Une phrase recopiée en français dans une autre langue, un gabarit mal
 * rempli (« undefined », « [object Object] ») ou un mot du portugais du Brésil arriveraient tels quels chez un locataire
 * ou un propriétaire.
 */

type Feuille = { chemin: string; valeur: string };

/** Toutes les phrases d'un jeu de textes : chaînes telles quelles, fonctions appelées avec des valeurs repérables. */
function phrases(noeud: unknown, chemin = ""): Feuille[] {
  if (typeof noeud === "string") return [{ chemin, valeur: noeud }];
  if (typeof noeud === "function") {
    const appel = (...args: unknown[]) => String((noeud as (...a: unknown[]) => unknown)(...args));
    const chaines = Array.from({ length: noeud.length }, (_, i) => `§${i}§`);
    let valeur: string;
    try {
      valeur = appel(...chaines);
    } catch {
      valeur = appel(...Array.from({ length: noeud.length }, () => 2));
    }
    return [{ chemin, valeur }];
  }
  if (Array.isArray(noeud)) return noeud.flatMap((v, i) => phrases(v, `${chemin}[${i}]`));
  if (noeud && typeof noeud === "object") return Object.entries(noeud).flatMap(([cle, v]) => phrases(v, chemin ? `${chemin}.${cle}` : cle));
  return [];
}

const LANGUES = ["en", "es", "pt"] as const;

/** Ce qui peut légitimement être identique au français : le nom du produit, des symboles, des nombres, un terme de paiement international. */
const IDENTIQUE_PERMIS = /^[\s\W\d_]*(ImmoPlatform Pro|Mobile Money)?[\s\W\d_]*$/i;

/** Mots du portugais du Brésil, à remplacer par leur équivalent du Portugal. */
const BRESILIEN = /\b(aluguel|alugu[eé]is|celular|usu[aá]rio|boleto|ônibus|banheiro)\b/i;

const ENSEMBLES: Array<[string, Record<string, unknown>]> = [
  ["e-mails (lot 2B)", TEXTES_SUITE as unknown as Record<string, unknown>],
  ["calendrier iCal", TEXTES_ICAL as unknown as Record<string, unknown>],
];

for (const [nom, textes] of ENSEMBLES) {
  describe(`textes traduits : ${nom}`, () => {
    const fr = phrases(textes.fr);

    it("le français a des phrases à comparer", () => {
      expect(fr.length).toBeGreaterThan(10);
    });

    for (const langue of LANGUES) {
      describe(langue, () => {
        const traduites = phrases(textes[langue]);

        it("a exactement les mêmes phrases que le français", () => {
          expect(traduites.map((p) => p.chemin)).toEqual(fr.map((p) => p.chemin));
        });

        it("n'a aucune phrase vide ni gabarit mal rempli", () => {
          for (const { chemin, valeur } of traduites) {
            expect(valeur.trim().length, `${langue}.${chemin} est vide`).toBeGreaterThan(0);
            expect(valeur, `${langue}.${chemin} contient un gabarit non rempli`).not.toMatch(/undefined|null|\[object|\$\{|%s|\{\{/);
          }
        });

        it("n'a aucune phrase restée en français", () => {
          const restees = traduites.filter((p, i) => p.valeur === fr[i].valeur && !IDENTIQUE_PERMIS.test(p.valeur)).map((p) => p.chemin);
          expect(restees, `phrases identiques au français en ${langue}`).toEqual([]);
        });
      });
    }

    it("le portugais n'emploie aucun mot du portugais du Brésil", () => {
      const fautes = phrases(textes.pt).filter((p) => BRESILIEN.test(p.valeur)).map((p) => `${p.chemin} : ${p.valeur}`);
      expect(fautes).toEqual([]);
    });
  });
}
