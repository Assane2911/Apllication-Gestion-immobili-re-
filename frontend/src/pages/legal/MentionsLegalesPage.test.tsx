import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { COMPANY } from "../../legal/companyInfo";
import MentionsLegalesPage from "./MentionsLegalesPage";

describe("MentionsLegalesPage", () => {
  it("affiche le titre et les informations légales de l'éditeur", () => {
    render(
      <MemoryRouter>
        <MentionsLegalesPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Mentions légales", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("1. Éditeur du site")).toBeInTheDocument();
    expect(screen.getByText(COMPANY.fullName)).toBeInTheDocument();
    expect(screen.getByText(COMPANY.siret, { exact: false })).toBeInTheDocument();
  });
});
