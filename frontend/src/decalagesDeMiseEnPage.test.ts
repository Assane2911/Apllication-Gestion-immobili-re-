import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Décalage cumulé de mise en page (CLS, seuil « bon » : 0,1). Mesuré dans un navigateur (mobile, CPU ×4, 4G lente) sur les 38 pages
 * connectées : 25 dépassaient 0,1, jusqu'à 0,73 (portail locataire), 0,65 (incidents), 0,62 (locataires), 0,48 (factures).
 *
 * Cause commune : le cartouche de feuille, en pied de page, s'affichait EN PLEIN ÉCRAN tant que la liste était vide ou en chargement,
 * puis était repoussé hors de l'écran à l'arrivée des données. Chaque mise en page pose donc la page dans une `ZoneDePage` (hauteur
 * minimale : l'écran), de sorte que le cartouche commence toujours sous la ligne de flottaison. Même cause sur la vitrine publique,
 * dont le pied de page montait à 0,19.
 */
function source(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}

describe("décalages de mise en page : un pied de page ne bouge pas sous les yeux de l'utilisateur", () => {
  const mises = readdirSync(resolve(__dirname, "components")).filter((f) => /Layout\.tsx$/.test(f) && source(`./components/${f}`).includes("<CartouchePlan"));

  it("trouve les quatre mises en page qui posent un cartouche (gestionnaire, propriétaire, locataire, administration)", () => {
    expect(mises.sort()).toEqual(["AdminLayout.tsx", "ManagerLayout.tsx", "OwnerLayout.tsx", "TenantLayout.tsx"]);
  });

  for (const fichier of ["AdminLayout.tsx", "ManagerLayout.tsx", "OwnerLayout.tsx", "TenantLayout.tsx"]) {
    it(`${fichier} : la page (Outlet) est dans une ZoneDePage, avant le cartouche`, () => {
      const src = source(`./components/${fichier}`);
      expect(src).toMatch(/<ZoneDePage>[\s\S]*<Outlet \/>[\s\S]*<\/ZoneDePage>[\s\S]*<CartouchePlan/);
    });
  }

  it("ZoneDePage a pour hauteur minimale celle de l'écran", () => {
    expect(source("./components/ZoneDePage.tsx")).toMatch(/className="min-h-svh"/);
  });

  for (const fichier of ["pages/VitrinePage.tsx", "pages/VitrineListingPage.tsx"]) {
    it(`${fichier} : le contenu des annonces a une hauteur minimale d'écran, le pied de page reste sous la ligne de flottaison`, () => {
      expect(source(`./${fichier}`)).toMatch(/<main id="contenu-principal" tabIndex=\{-1\} className="[^"]*\bmin-h-svh\b[^"]*max-w-6xl/);
    });
  }
});
