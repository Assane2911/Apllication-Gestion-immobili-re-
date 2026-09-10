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
});
