import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { changerLangue } from "../i18n";
import LienCourriel from "./LienCourriel";

describe("LienCourriel", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await changerLangue("fr");
  });

  it("affiche l'adresse comme lien d'écriture", () => {
    render(<LienCourriel adresse="awa@exemple.sn" titre="Écrire à Awa" />);
    const lien = screen.getByRole("link", { name: "awa@exemple.sn" });
    expect(lien).toHaveAttribute("href", "mailto:awa@exemple.sn");
    expect(lien).toHaveAttribute("title", "Écrire à Awa");
  });

  it("le bouton copie l'adresse et le dit", async () => {
    // user-event pose son propre presse-papiers à l'appel de setup() : le simulateur vient APRÈS.
    const user = userEvent.setup();
    const ecrire = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: ecrire }, configurable: true });
    render(<LienCourriel adresse="awa@exemple.sn" />);

    await user.click(screen.getByRole("button", { name: "Copier l'adresse awa@exemple.sn" }));

    expect(ecrire).toHaveBeenCalledWith("awa@exemple.sn");
    expect(screen.getByRole("status")).toHaveTextContent("Adresse copiée");
  });

  it("quand la copie est refusée, le dit au lieu de rester muet", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("refusé")) }, configurable: true });
    render(<LienCourriel adresse="awa@exemple.sn" />);

    await user.click(screen.getByRole("button", { name: /Copier l'adresse/ }));

    const statut = screen.getByRole("status");
    expect(statut).toHaveTextContent("Copie impossible : sélectionnez l'adresse");
    // Le message d'échec est VISIBLE (pas réservé aux lecteurs d'écran).
    expect(statut.className).not.toContain("sr-only");
  });

  it("est écrit dans la langue choisie", async () => {
    await changerLangue("en");
    render(<LienCourriel adresse="awa@exemple.sn" />);
    expect(screen.getByRole("button", { name: "Copy the address awa@exemple.sn" })).toBeInTheDocument();
  });
});
