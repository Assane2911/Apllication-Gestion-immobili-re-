import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * WCAG 2.5.8 (cibles de 24 px) : un lien ou bouton de 17 px de haut n'est conforme que si les cibles voisines sont assez
 * éloignées. Quand une rangée d'actions passe à la ligne, un écart vertical de 6 px (`gap-y-1.5`) place les centres à 23 px
 * l'un de l'autre : sous le seuil. 10 px (`gap-y-2.5`) en laisse 27.
 *
 * Mesuré dans un navigateur (espace gestionnaire, 1280 px et 360 px de large) ; le test garde cet écart là où le défaut a été vu.
 */
function source(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}

const RANGEES_D_ACTIONS = ["./pages/manager/TenantsPage.tsx", "./pages/manager/OwnersPage.tsx", "./pages/manager/ListingsPage.tsx"];

describe("rangées d'actions : espacement des cibles tactiles", () => {
  for (const chemin of RANGEES_D_ACTIONS) {
    it(`${chemin} : pas d'écart vertical de moins de 8 px entre actions qui passent à la ligne`, () => {
      const trop_serre = source(chemin).match(/flex-wrap[^"`]*\bgap-y-(?:0\.5|1|1\.5)\b/g);
      expect(trop_serre).toBeNull();
    });
  }

  it("OwnersPage : sur mobile, les actions d'une carte sont une rangée qui passe à la ligne avec un écart vertical", () => {
    const src = source("./pages/manager/OwnersPage.tsx");
    // Plus de simple `space-x-3` (le retour à la ligne y colle les lignes de 16 px l'une à l'autre).
    expect(src).not.toMatch(/className="space-x-3"/);
  });
});
