import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DialogueDeconnexion from "./DialogueDeconnexion";

/**
 * Un appui involontaire sur « Se déconnecter » (le bouton est collé à d'autres sur téléphone) fermait la session sans
 * rien demander. La fenêtre de confirmation laisse le choix, et Annuler est la réponse par défaut.
 */
describe("DialogueDeconnexion", () => {
  it("demande confirmation, dans une fenêtre nommée, et met le focus sur « Annuler »", () => {
    render(<DialogueDeconnexion onAnnuler={() => {}} onConfirmer={() => {}} />);
    const fenetre = screen.getByRole("dialog", { name: "Se déconnecter ?" });
    expect(within(fenetre).getByText(/Votre session sera fermée sur cet appareil/)).toBeInTheDocument();
    expect(within(fenetre).getByRole("button", { name: "Annuler" })).toHaveFocus();
  });

  it("« Se déconnecter » confirme, « Annuler » renonce", async () => {
    const user = userEvent.setup();
    const onConfirmer = vi.fn();
    const onAnnuler = vi.fn();
    render(<DialogueDeconnexion onAnnuler={onAnnuler} onConfirmer={onConfirmer} />);
    const fenetre = screen.getByRole("dialog");

    await user.click(within(fenetre).getByRole("button", { name: "Annuler" }));
    expect(onAnnuler).toHaveBeenCalledTimes(1);
    expect(onConfirmer).not.toHaveBeenCalled();

    await user.click(within(fenetre).getByRole("button", { name: "Se déconnecter" }));
    expect(onConfirmer).toHaveBeenCalledTimes(1);
  });

  it("Échap équivaut à « Annuler » : on ne déconnecte jamais par défaut", async () => {
    const user = userEvent.setup();
    const onConfirmer = vi.fn();
    const onAnnuler = vi.fn();
    render(<DialogueDeconnexion onAnnuler={onAnnuler} onConfirmer={onConfirmer} />);

    await user.keyboard("{Escape}");
    expect(onAnnuler).toHaveBeenCalledTimes(1);
    expect(onConfirmer).not.toHaveBeenCalled();
  });
});
