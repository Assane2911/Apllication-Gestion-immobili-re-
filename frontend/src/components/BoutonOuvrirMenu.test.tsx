import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import BoutonOuvrirMenu from "./BoutonOuvrirMenu";

const afficher = (enAttente?: number, onClick = vi.fn()) =>
  render(<BoutonOuvrirMenu onClick={onClick} enAttente={enAttente} className="w-9 h-9" />);

describe("BoutonOuvrirMenu", () => {
  it("n'affiche aucune pastille quand rien n'est en attente, et garde son nom habituel", () => {
    afficher(0);
    expect(screen.getByRole("button", { name: "Ouvrir le menu" })).toBeInTheDocument();
    expect(screen.queryByTestId("pastille-bouton-menu")).not.toBeInTheDocument();
  });

  it("affiche le total en attente et le dit aux lecteurs d'écran dans le nom du bouton", () => {
    afficher(4);
    expect(screen.getByTestId("pastille-bouton-menu")).toHaveTextContent("4");
    expect(screen.getByRole("button", { name: "Ouvrir le menu, 4 élément(s) en attente" })).toBeInTheDocument();
  });

  it("plafonne l'affichage à 99+", () => {
    afficher(250);
    expect(screen.getByTestId("pastille-bouton-menu")).toHaveTextContent("99+");
  });

  it("ouvre le menu au clic", async () => {
    const onClick = vi.fn();
    afficher(2, onClick);
    await userEvent.click(screen.getByRole("button", { name: /Ouvrir le menu/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
