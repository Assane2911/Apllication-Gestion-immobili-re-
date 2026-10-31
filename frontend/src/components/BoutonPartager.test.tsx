import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BoutonPartager from "./BoutonPartager";

const rendre = () => render(<BoutonPartager url="https://www.immoplatformpro.com/inscription?ref=ABC" titre="ImmoPlatform Pro" texte="Essayez-le" />);

describe("BoutonPartager", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ouvre le menu de partage du système quand il existe", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, share });
    rendre();
    fireEvent.click(screen.getByRole("button", { name: "Partager" }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({ title: "ImmoPlatform Pro", text: "Essayez-le", url: "https://www.immoplatformpro.com/inscription?ref=ABC" }));
  });

  it("à défaut, copie le lien et le dit", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, share: undefined, clipboard: { writeText } });
    rendre();
    fireEvent.click(screen.getByRole("button", { name: "Partager" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://www.immoplatformpro.com/inscription?ref=ABC"));
    expect(await screen.findByRole("button", { name: "Lien copié !" })).toBeInTheDocument();
  });

  it("fermer le menu de partage sans rien choisir ne copie rien et n'affiche aucune erreur", async () => {
    const writeText = vi.fn();
    const share = vi.fn().mockRejectedValue(new DOMException("annulé", "AbortError"));
    vi.stubGlobal("navigator", { ...navigator, share, clipboard: { writeText } });
    rendre();
    fireEvent.click(screen.getByRole("button", { name: "Partager" }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Partager" })).toBeInTheDocument();
  });

  it("si le partage échoue pour une autre raison, retombe sur la copie du lien", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const share = vi.fn().mockRejectedValue(new DOMException("refusé", "NotAllowedError"));
    vi.stubGlobal("navigator", { ...navigator, share, clipboard: { writeText } });
    rendre();
    fireEvent.click(screen.getByRole("button", { name: "Partager" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
  });
});
