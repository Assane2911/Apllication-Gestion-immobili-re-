import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Link, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import AnnonceChangementPage from "./AnnonceChangementPage";

/** Deux « pages » qui posent leur titre comme le fait `Seo` : dans un effet, après le changement d'adresse. */
function Page({ titre, nom }: { titre: string; nom: string }) {
  return (
    <main>
      <h2>{nom}</h2>
      <Link to={nom === "a" ? "/b" : "/a"}>aller</Link>
      <TitreAuMontage titre={titre} />
    </main>
  );
}
function TitreAuMontage({ titre }: { titre: string }) {
  // Même mécanisme que `Seo` : le titre du document change quand la page se monte.
  document.title = titre;
  return null;
}

function monter(titreA: string, titreB: string, delai = 40) {
  return render(
    <MemoryRouter initialEntries={["/a"]}>
      <AnnonceChangementPage delaiMaxMs={delai} />
      <Routes>
        <Route path="/a" element={<Page nom="a" titre={titreA} />} />
        <Route path="/b" element={<Page nom="b" titre={titreB} />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("AnnonceChangementPage", () => {
  afterEach(() => {
    document.title = "";
  });

  it("est une zone de statut polie, que seuls les lecteurs d'écran perçoivent", () => {
    monter("Page A", "Page B");
    const zone = screen.getByRole("status");
    expect(zone).toHaveAttribute("aria-live", "polite");
    expect(zone).toHaveClass("sr-only");
  });

  it("n'annonce rien au premier chargement : le lecteur d'écran lit déjà la page qui s'ouvre", async () => {
    monter("Page A", "Page B");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("annonce le titre de la nouvelle page quand on change de page", async () => {
    monter("Locataires | ImmoPlatform Pro", "Contrats | ImmoPlatform Pro");
    await userEvent.setup().click(screen.getByRole("link", { name: "aller" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Contrats | ImmoPlatform Pro"));
  });

  it("annonce quand même la page quand les deux titres sont identiques", async () => {
    monter("ImmoPlatform Pro", "ImmoPlatform Pro");
    await userEvent.setup().click(screen.getByRole("link", { name: "aller" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("ImmoPlatform Pro"));
  });
});
