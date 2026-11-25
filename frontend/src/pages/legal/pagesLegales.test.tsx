import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
      <MemoryRouter>
        <Page />
      </MemoryRouter>
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
      <MemoryRouter>
        <MentionsLegalesPage />
      </MemoryRouter>
    );

    const texte = container.textContent ?? "";
    expect(texte).toMatch(/Adresse\s*:\s*\S/);
    expect(texte).toContain("contact@immoplatformpro.com");
  });

  it("présente l'éditeur comme la LLC immatriculée, avec son État et son adresse, sans publier son EIN — plus comme une société « en cours de formation »", () => {
    const { container } = render(
      <MemoryRouter>
        <MentionsLegalesPage />
      </MemoryRouter>
    );

    const texte = container.textContent ?? "";
    expect(texte).toContain("ImmoPlatform Pro LLC");
    expect(texte).toContain("Wyoming");
    // L'EIN est un identifiant fiscal sensible : il ne figure sur aucune page publique, ni sous son nom, ni sous la forme NN-NNNNNNN.
    expect(texte).not.toContain("EIN");
    expect(texte).not.toMatch(/\b\d{2}-\d{7}\b/);
    expect(texte).toContain("30 N Gould St");
    expect(texte).toContain("Sheridan");
    expect(texte).toMatch(/Représentant légal\s*:\s*Imame Assane Thiam/);
    expect(texte).toMatch(/Directeur de la publication\s*:\s*Imame Assane Thiam/);
    for (const perime of ["en cours de formation", "en cours d'immatriculation", "Personne physique", "communiquée sur demande"]) {
      expect(texte).not.toContain(perime);
    }
  });

  it("les CGU/CGV ne présentent pas PayDunya comme moyen de payer l'abonnement tant que le compte de l'éditeur n'est pas actif", () => {
    const { container } = render(
      <MemoryRouter>
        <CGUPage />
      </MemoryRouter>
    );

    const texte = (container.textContent ?? "").replace(/\s+/g, " ");
    // L'abonnement se paie par virement et, lorsqu'elle est proposée, par carte via Stripe.
    expect(texte).toContain("virement bancaire et, lorsqu'il est proposé dans l'interface, paiement par carte bancaire via Stripe");
    expect(texte).not.toMatch(/mobile money et carte bancaire par PayDunya/);
    expect(texte).toContain("Le compte Stripe de l'éditeur ne sert qu'à régler l'abonnement");
    expect(texte).not.toMatch(/comptes Stripe et PayDunya de l'éditeur/);
    // La fonction existe encore côté agence (son PROPRE compte PayDunya, identifiants chiffrés) : elle reste décrite.
    expect(texte).toContain("avec son propre compte PayDunya");
    expect(texte).toContain("Les identifiants PayDunya que le Gestionnaire enregistre pour son agence sont conservés chiffrés");
  });

  it.each(PAGES)("%s ne parle plus d'une société en cours de constitution", (_nom, Page) => {
    const { container } = render(
      <MemoryRouter>
        <Page />
      </MemoryRouter>
    );
    const texte = container.textContent ?? "";
    expect(texte).not.toMatch(/en cours (de formation|d'immatriculation|de constitution)/);
    expect(texte).toContain("ImmoPlatform Pro LLC");
  });
});
