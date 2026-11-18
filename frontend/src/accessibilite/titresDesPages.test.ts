import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Plan des titres des pages connectées (gestionnaire, propriétaire, locataire, administrateur).
 *
 * Avant : le seul `h1` de ces pages était le nom « ImmoPlatform Pro » dans le menu latéral, identique sur chaque page,
 * et le vrai titre de la page était un `h2`. Une personne qui navigue aux titres entendait donc la même chose partout,
 * et les sections (`h3`) sautaient un niveau.
 * Maintenant : le titre de la page est le `h1`, les sections sont des `h2`, leurs sous-parties des `h3`. Le nom de
 * l'application dans le menu n'est plus un titre.
 *
 * Ces garde-fous se lisent dans le code : le rendu des quatre menus est vérifié dans les tests des gabarits.
 */
const SRC = join(__dirname, "..");

function pagesConnectees(): string[] {
  return ["manager", "admin", "owner", "tenant"].flatMap((role) =>
    readdirSync(join(SRC, "pages", role))
      .filter((nom) => /Page\.tsx$/.test(nom))
      .map((nom) => join("pages", role, nom)),
  );
}

/** Le code sans les commentaires : un `<h2` cité dans une explication n'est pas une balise. */
function code(chemin: string): string {
  return readFileSync(join(SRC, chemin), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Titres de fenêtre (dialogue) : ils ont leur propre plan, ils ne comptent pas dans celui de la page. */
const TITRE_DE_FENETRE = /modal-title/;

function balisesDeTitre(source: string, niveau: number): string[] {
  return (source.match(new RegExp(`<h${niveau}(?=[\\s>])[^>]*>`, "g")) ?? []).filter((b) => !TITRE_DE_FENETRE.test(b));
}

describe("le nom de l'application dans le menu n'est pas un titre", () => {
  it("MenuLateral ne pose aucun titre", () => {
    expect(code("components/MenuLateral.tsx")).not.toMatch(/<h[1-6][\s>]/);
  });
});

describe("chaque page connectée a un titre de niveau 1, et lui seul au premier niveau", () => {
  const pages = pagesConnectees();

  it("il existe des pages à contrôler (le test ne tourne pas à vide)", () => {
    expect(pages.length).toBeGreaterThan(30);
  });

  for (const page of pages) {
    it(`${page} : un h1, et aucun h2 de la taille d'un titre de page`, () => {
      const source = code(page);
      expect(balisesDeTitre(source, 1).length, "titre de page absent").toBeGreaterThanOrEqual(1);
      const titresDePageEnH2 = balisesDeTitre(source, 2).filter((b) => /text-(?:2xl|xl)\b/.test(b));
      expect(titresDePageEnH2).toEqual([]);
    });
  }
});

describe("les niveaux ne sautent pas", () => {
  it("une page qui a des h3 (hors fenêtres) a aussi des h2 : la section n'est pas un sous-titre sans titre", () => {
    const fautives = pagesConnectees().filter((page) => {
      const source = code(page);
      return balisesDeTitre(source, 3).length > 0 && balisesDeTitre(source, 2).length === 0 && !/<(?:EmptyState|SectionReglage|DecompteCrg|ReversementsSection|FriseJournal)\b/.test(source);
    });
    expect(fautives).toEqual([]);
  });

  it("les blocs de section partagés posent des h2 (ils sont sous le h1 de la page)", () => {
    const fautifs: string[] = [];
    for (const composant of [
      "components/SectionReglage.tsx",
      "components/EmptyState.tsx",
      "components/DecompteCrg.tsx",
      "components/ReversementsSection.tsx",
      "components/FriseJournal.tsx",
      "components/DemarrageAgence.tsx",
      "components/AbonnementCalendrier.tsx",
    ]) {
      const source = code(composant);
      // Un sous-titre (h3) n'a de sens que sous un titre de section (h2) du même bloc.
      if (balisesDeTitre(source, 2).length === 0 || balisesDeTitre(source, 4).length > 0) fautifs.push(composant);
    }
    expect(fautifs).toEqual([]);
  });
});
