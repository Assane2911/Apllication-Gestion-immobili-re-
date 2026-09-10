import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import CGUPage from "./CGUPage";

describe("CGUPage", () => {
  it("affiche le titre et les sections principales", () => {
    render(
      <MemoryRouter>
        <CGUPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Conditions Générales d'Utilisation et de Vente", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("1. Objet")).toBeInTheDocument();
    expect(screen.getByText("3. Formules d'abonnement et essai gratuit")).toBeInTheDocument();
  });
});
