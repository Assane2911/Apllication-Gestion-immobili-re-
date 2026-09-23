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
});
