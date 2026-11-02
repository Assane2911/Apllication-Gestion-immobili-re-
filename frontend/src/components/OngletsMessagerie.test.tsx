import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { NonLusContext } from "../context/nonLus";
import OngletsMessagerie from "./OngletsMessagerie";

const afficher = (valeur = { count: 0, tenants: 0, owners: 0 }) =>
  render(
    <MemoryRouter initialEntries={["/messages"]}>
      <NonLusContext.Provider value={valeur}>
        <OngletsMessagerie />
      </NonLusContext.Provider>
    </MemoryRouter>
  );

describe("OngletsMessagerie — messages non lus", () => {
  it("montre sur chaque onglet les messages non lus de ce type de discussion", () => {
    afficher({ count: 5, tenants: 2, owners: 3 });
    expect(screen.getByRole("link", { name: /Locataires/ })).toHaveAccessibleName("Locataires, 2 message(s) non lu(s)");
    expect(screen.getByRole("link", { name: /Propriétaires/ })).toHaveAccessibleName("Propriétaires, 3 message(s) non lu(s)");
  });

  it("n'ajoute rien sur un onglet sans message non lu", () => {
    afficher({ count: 3, tenants: 0, owners: 3 });
    expect(screen.getByRole("link", { name: "Locataires" })).toBeInTheDocument();
  });

  it("n'affiche aucun compteur hors du contexte du gestionnaire", () => {
    render(
      <MemoryRouter>
        <OngletsMessagerie />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Locataires" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Propriétaires" })).toBeInTheDocument();
  });
});
