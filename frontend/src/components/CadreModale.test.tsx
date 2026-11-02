import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CadreModale from "./CadreModale";

function afficher(props: Partial<React.ComponentProps<typeof CadreModale>> = {}) {
  const onClose = vi.fn();
  render(
    <CadreModale titre="Mon titre" titreId="mon-titre" sousTitre="Un sous-titre" onClose={onClose} {...props}>
      <button type="button">Action</button>
    </CadreModale>
  );
  return { onClose };
}

describe("CadreModale", () => {
  it("est une fenêtre nommée par son titre, avec son sous-titre et son contenu", () => {
    afficher();
    const fenetre = screen.getByRole("dialog", { name: "Mon titre" });
    expect(fenetre).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Un sous-titre")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Action" })).toBeInTheDocument();
  });

  it("se ferme par la croix et par Échap", async () => {
    const user = userEvent.setup();
    const { onClose } = afficher();
    await user.click(screen.getByRole("button", { name: "Fermer" }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("ne se ferme pas tant qu'elle n'est pas fermable (enregistrement en cours)", async () => {
    const user = userEvent.setup();
    const { onClose } = afficher({ fermable: false });
    expect(screen.getByRole("button", { name: "Fermer" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("peut se passer de croix, et prend la teinte rouge d'une action destructive", () => {
    afficher({ boutonFermer: false, danger: true });
    expect(screen.queryByRole("button", { name: "Fermer" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog").className).toContain("border-rose-700");
  });
});
