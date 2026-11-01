import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import LegalLayout, { LegalSection, slugifier } from "./LegalLayout";

function afficher(chemin = "/cgu") {
  return render(
    <MemoryRouter initialEntries={[chemin]}>
      <LegalLayout title="CGU & CGV" description="d">
        <LegalSection title="1. Objet">
          <p>Premier paragraphe.</p>
        </LegalSection>
        <LegalSection title="2. Formules d'abonnement">
          <p>Second paragraphe.</p>
        </LegalSection>
      </LegalLayout>
    </MemoryRouter>
  );
}

afterEach(() => vi.restoreAllMocks());

describe("slugifier", () => {
  it("retire accents et ponctuation", () => {
    expect(slugifier("3. Formules d'abonnement")).toBe("3-formules-d-abonnement");
    expect(slugifier("Données à caractère personnel")).toBe("donnees-a-caractere-personnel");
  });
});

describe("LegalLayout", () => {
  it("construit le sommaire à partir des sections affichées", async () => {
    afficher();
    const sommaire = await screen.findByRole("navigation", { name: "Sommaire", hidden: true });
    const liens = within(sommaire).getAllByRole("link", { hidden: true });
    expect(liens.map((l) => l.getAttribute("href"))).toEqual(["#1-objet", "#2-formules-d-abonnement"]);
    expect(within(sommaire).getByText("Formules d'abonnement")).toBeInTheDocument();
  });

  it("donne une ancre à chaque section", () => {
    afficher();
    expect(document.getElementById("1-objet")?.tagName).toBe("SECTION");
  });

  it("indique la durée de lecture", async () => {
    afficher();
    expect(await screen.findByText(/Lecture : environ \d+ min/)).toBeInTheDocument();
  });

  it("marque le document courant et propose précédent / suivant", () => {
    afficher("/cgu");
    expect(screen.getByRole("link", { name: "CGU & CGV" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Document 02 / 03")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Précédent\s*Mentions légales/ })).toHaveAttribute("href", "/mentions-legales");
    expect(screen.getByRole("link", { name: /Suivant\s*Politique de confidentialité/ })).toHaveAttribute("href", "/confidentialite");
  });

  it("n'a pas de lien « précédent » sur le premier document", () => {
    afficher("/mentions-legales");
    expect(screen.queryByText("Précédent")).toBeNull();
    expect(screen.getByText("Suivant")).toBeInTheDocument();
  });

  it("copie le lien du document et celui d'une section", async () => {
    const user = userEvent.setup();
    const ecrire = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    afficher("/cgu");

    await user.click(screen.getByRole("button", { name: "Copier le lien" }));
    expect(ecrire).toHaveBeenLastCalledWith(`${window.location.origin}/cgu`);
    expect(await screen.findByText("Lien copié")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copier le lien de la section : 1. Objet" }));
    expect(ecrire).toHaveBeenLastCalledWith(`${window.location.origin}/cgu#1-objet`);
  });

  it("lance l'impression", async () => {
    const user = userEvent.setup();
    const imprimer = vi.spyOn(window, "print").mockImplementation(() => {});
    afficher();
    await user.click(screen.getByRole("button", { name: /Imprimer ou enregistrer en PDF/ }));
    expect(imprimer).toHaveBeenCalledOnce();
  });
});
