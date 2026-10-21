import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { describe, expect, it } from "vitest";
import HistoriqueProvider from "../context/HistoriqueContext";
import BoutonsHistorique from "./BoutonsHistorique";

/**
 * Boutons « Retour » / « Suivant » des en-têtes : l'application mobile n'a pas les boutons du navigateur, et sur
 * ordinateur ils manquent à qui navigue dans l'espace de gestion.
 */
function Application() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <div>
      <p data-testid="chemin">{pathname}</p>
      <button onClick={() => navigate("/a")}>aller en A</button>
      <button onClick={() => navigate("/b")}>aller en B</button>
      <BoutonsHistorique />
    </div>
  );
}

function rendre(entree = "/") {
  return render(
    <MemoryRouter initialEntries={[entree]}>
      <HistoriqueProvider>
        <Routes>
          <Route path="*" element={<Application />} />
        </Routes>
      </HistoriqueProvider>
    </MemoryRouter>
  );
}

const chemin = () => screen.getByTestId("chemin").textContent;

describe("BoutonsHistorique", () => {
  it("deux boutons nommés pour les lecteurs d'écran, tous deux inactifs sans historique", () => {
    rendre("/une/page");
    expect(screen.getByRole("button", { name: "Retour" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Suivant" })).toBeDisabled();
  });

  it("Retour devient actif après une navigation et ramène à la page précédente ; Suivant la rejoue", async () => {
    const user = userEvent.setup();
    rendre("/");
    await user.click(screen.getByRole("button", { name: "aller en A" }));
    await user.click(screen.getByRole("button", { name: "aller en B" }));
    expect(screen.getByRole("button", { name: "Retour" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Suivant" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Retour" }));
    expect(chemin()).toBe("/a");
    expect(screen.getByRole("button", { name: "Suivant" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Suivant" }));
    expect(chemin()).toBe("/b");
    expect(screen.getByRole("button", { name: "Suivant" })).toBeDisabled();
  });

  it("dans un en-tête, Retour sans page précédente est inactif : renvoyer à l'accueil ne ferait que recharger la page", () => {
    rendre("/tableau-de-bord");
    expect(screen.getByRole("button", { name: "Retour" })).toBeDisabled();
  });

  it("des boutons assez grands pour le doigt (36 px)", () => {
    rendre();
    for (const nom of ["Retour", "Suivant"]) {
      expect(screen.getByRole("button", { name: nom }).className).toMatch(/(^|\s)w-9(\s|$)/);
      expect(screen.getByRole("button", { name: nom }).className).toMatch(/(^|\s)h-9(\s|$)/);
    }
  });
});
