import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import PolitiqueConfidentialitePage from "./PolitiqueConfidentialitePage";

describe("PolitiqueConfidentialitePage", () => {
  it("affiche le titre et les sections principales sur le traitement des données", () => {
    render(
      <MemoryRouter>
        <PolitiqueConfidentialitePage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Politique de confidentialité", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("1. Responsable du traitement")).toBeInTheDocument();
    expect(screen.getByText("2. Données collectées")).toBeInTheDocument();
  });

  it("définit un titre d'onglet propre à la page", () => {
    render(
      <MemoryRouter>
        <PolitiqueConfidentialitePage />
      </MemoryRouter>
    );

    expect(document.title).toBe("Politique de confidentialité | ImmoPlatform Pro");
  });

  /**
   * Une politique de confidentialité n'est pas un texte décoratif : chacune de
   * ses affirmations engage l'éditeur. Les deux tests ci-dessous verrouillent
   * les deux écarts trouvés à l'audit — une promesse technique que le code ne
   * tient pas, et des destinataires réellement appelés mais non déclarés — pour
   * qu'ils ne puissent pas revenir silencieusement à la faveur d'une réécriture.
   */
  it("ne revendique pas de row-level security, que la base n'implémente pas", () => {
    const { container } = render(
      <MemoryRouter>
        <PolitiqueConfidentialitePage />
      </MemoryRouter>
    );

    // L'isolation entre agences est réelle mais appliquée par le code
    // applicatif (assertOwnership + filtres managerId), pas par une politique
    // RLS Postgres : l'annoncer comme telle serait une affirmation fausse.
    expect(container.textContent).not.toMatch(/row-level security/i);
    expect(container.textContent).toMatch(/contrôlée par le\s+code applicatif/i);
  });

  it("déclare tous les destinataires que le code appelle réellement", () => {
    const { container } = render(
      <MemoryRouter>
        <PolitiqueConfidentialitePage />
      </MemoryRouter>
    );

    const texte = container.textContent ?? "";
    // email.service.ts, whatsapp.service.ts, auth.controller.ts::loginWithGoogle,
    // instrument.ts — chacun transmet des données personnelles à un tiers.
    for (const destinataire of ["SMTP", "WhatsApp", "Google", "Sentry", "Stripe", "PayDunya", "Supabase", "Vercel"]) {
      expect(texte).toContain(destinataire);
    }
  });

  /**
   * Le Service détient des données de personnes qui n'ont pas de compte (garants d'un bail, prospects d'une annonce) et sait désormais
   * en remettre une copie et les anonymiser (voir backend/src/controllers/personne.controller.ts) : le texte doit le dire, et dire à
   * qui s'adresser. Il annonce aussi ce que devient un compte portail à la suppression d'une agence et la double authentification de
   * l'administration — trois comportements du code que la politique ne doit pas contredire.
   */
  it("déclare les garants et les prospects, leurs droits, et le sort des comptes portail", () => {
    const { container } = render(
      <MemoryRouter>
        <PolitiqueConfidentialitePage />
      </MemoryRouter>
    );

    const texte = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(texte).toContain("Données de garants");
    expect(texte).toContain("Demandes de prospects");
    expect(texte).toMatch(/garant.*prospect.*n'a pas de compte.*adresse sa demande.*au Gestionnaire/);
    expect(texte).toContain("anonymiser ses données identifiantes");
    expect(texte).toContain("que cette agence était seule à rattacher");
    expect(texte).toContain("exige une double authentification");
  });
});
