import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "../../context/ThemeContext";
import { describe, expect, it } from "vitest";
import CGUPage from "./CGUPage";
import MentionsLegalesPage from "./MentionsLegalesPage";
import PolitiqueConfidentialitePage from "./PolitiqueConfidentialitePage";

/**
 * Les trois pages légales lisent toutes companyInfo.ts. Une valeur laissée en
 * chantier dans ce fichier s'affiche donc en clair, en production, sur les
 * pages mêmes où un prospect vient vérifier à qui il confie ses données — et
 * la mention légale obligatoire devient alors pire qu'absente.
 *
 * C'était le cas de l'adresse, affichée « [À COMPLÉTER — adresse à définir une
 * fois la société finalisée...] » tant que la société n'est pas immatriculée,
 * et insérée telle quelle au milieu d'une phrase de la politique de
 * confidentialité. Elle porte désormais une formulation transitoire qui dit
 * par quel moyen obtenir l'adresse — ce qui est l'objet de l'obligation — en
 * attendant la vraie.
 */
const PAGES = [
  ["Mentions légales", MentionsLegalesPage],
  ["CGU/CGV", CGUPage],
  ["Politique de confidentialité", PolitiqueConfidentialitePage],
] as const;

describe("Pages légales", () => {
  it.each(PAGES)("%s n'affiche aucun marqueur de contenu à compléter", (_nom, Page) => {
    const { container } = render(
      <ThemeProvider><MemoryRouter>
        <Page />
      </MemoryRouter></ThemeProvider>
    );

    const texte = container.textContent ?? "";
    for (const marqueur of ["À COMPLÉTER", "A COMPLETER", "TODO", "FIXME", "[]", "XXX", "Lorem"]) {
      expect(texte).not.toContain(marqueur);
    }
  });

  it("indique une adresse d'éditeur, même en l'absence d'adresse définitive", () => {
    // L'obligation porte sur la possibilité de joindre l'éditeur : la ligne
    // doit toujours exister et dire quelque chose d'exploitable.
    const { container } = render(
      <ThemeProvider><MemoryRouter>
        <MentionsLegalesPage />
      </MemoryRouter></ThemeProvider>
    );

    const texte = container.textContent ?? "";
    expect(texte).toMatch(/Adresse\s*:\s*\S/);
    expect(texte).toContain("assane@immoplatformpro.com");
  });

  it("présente l'éditeur comme la LLC immatriculée, avec son EIN, son État et son adresse — plus comme une société « en cours de formation »", () => {
    const { container } = render(
      <ThemeProvider><MemoryRouter>
        <MentionsLegalesPage />
      </MemoryRouter></ThemeProvider>
    );

    const texte = container.textContent ?? "";
    expect(texte).toContain("ImmoPlatform Pro LLC");
    expect(texte).toContain("Wyoming");
    expect(texte).toContain("EIN");
    expect(texte).toContain("30-1510500");
    expect(texte).toContain("30 N Gould St");
    expect(texte).toContain("Sheridan");
    expect(texte).toMatch(/Représentant légal\s*:\s*Imame Assane Thiam/);
    expect(texte).toMatch(/Directeur de la publication\s*:\s*Imame Assane Thiam/);
    for (const perime of ["en cours de formation", "en cours d'immatriculation", "Personne physique", "communiquée sur demande"]) {
      expect(texte).not.toContain(perime);
    }
  });

  it.each(PAGES)("%s ne parle plus d'une société en cours de constitution", (_nom, Page) => {
    const { container } = render(
      <ThemeProvider><MemoryRouter>
        <Page />
      </MemoryRouter></ThemeProvider>
    );
    const texte = container.textContent ?? "";
    expect(texte).not.toMatch(/en cours (de formation|d'immatriculation|de constitution)/);
    expect(texte).toContain("ImmoPlatform Pro LLC");
  });
});
