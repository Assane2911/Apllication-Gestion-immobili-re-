import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BandeauChiffres from "./BandeauChiffres";

/**
 * Le fond de la grille est le filet gris : une dernière rangée incomplète laissait apparaître une grande case grise vide
 * (ex. trois chiffres sur quatre colonnes, vu sur l'historique d'abonnement). Des cases de remplissage blanches la comblent.
 */
const cases = (n: number) => Array.from({ length: n }, (_, i) => ({ libelle: `Chiffre ${i}`, valeur: i }));
const remplissages = (n: number) => {
  const { container } = render(<BandeauChiffres etiquette="Synthèse" cases={cases(n)} />);
  return Array.from(container.querySelectorAll("[data-remplissage]"), (e) => e.className);
};

describe("BandeauChiffres : rangée complétée", () => {
  it("ne remplit rien quand les cases tombent juste", () => {
    expect(remplissages(4)).toHaveLength(0);
    expect(remplissages(8)).toHaveLength(0);
  });

  it("complète trois cases par une case blanche à partir de la largeur large, sans rien ajouter sur téléphone (3 = 2 + 1... une case)", () => {
    const vides = remplissages(3);
    // Trois cases : sur deux colonnes il manque 1 case, sur quatre colonnes il manque 1 case.
    expect(vides).toHaveLength(1);
    expect(vides[0]).not.toContain("max-lg:hidden");
    expect(vides[0]).not.toContain("lg:hidden");
  });

  it("complète deux cases sur quatre colonnes seulement (deux colonnes sur téléphone : rangée pleine)", () => {
    const vides = remplissages(2);
    expect(vides).toHaveLength(2);
    expect(vides.every((c) => c.includes("max-lg:hidden"))).toBe(true);
  });

  it("complète cinq cases : une case sur téléphone, trois sur large", () => {
    const vides = remplissages(5);
    expect(vides).toHaveLength(3);
    expect(vides[0]).not.toContain("max-lg:hidden");
    expect(vides[1]).toContain("max-lg:hidden");
    expect(vides[2]).toContain("max-lg:hidden");
  });

  it("ne produit aucun élément lisible par un lecteur d'écran dans les remplissages", () => {
    const { container } = render(<BandeauChiffres etiquette="Synthèse" cases={cases(3)} />);
    expect(container.querySelector("[data-remplissage]")?.getAttribute("aria-hidden")).toBe("true");
  });
});
