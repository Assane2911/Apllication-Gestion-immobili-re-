import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthContext } from "../context/auth";
import type { AuthContextValue } from "../context/auth";
import { CurrencyProvider } from "../context/CurrencyContext";
import type { AuthUser } from "../types";
import OwnerLayout from "./OwnerLayout";

function noop(): never {
  throw new Error("not implemented in this test");
}

const proprietaire: AuthUser = {
  id: "o1",
  email: "proprietaire@test.local",
  role: "OWNER",
  ownerName: "Fatou Diop",
};

function authValue(user: AuthUser | null): AuthContextValue {
  return {
    user,
    loading: false,
    login: noop,
    register: noop,
    loginWithGoogle: noop,
    verifyTwoFactor: noop,
    verifyEmail: noop,
    logout: async () => {},
    refreshUser: async () => user,
  };
}

function renderOwnerLayout(initialEntry = "/proprietaire") {
  return render(
    <AuthContext.Provider value={authValue(proprietaire)}>
      <CurrencyProvider>
          <MemoryRouter initialEntries={[initialEntry]}>
            <Routes>
              <Route path="/proprietaire" element={<OwnerLayout />}>
                <Route index element={<div>Résumé financier</div>} />
                <Route path="crg" element={<div>Contenu de la page CRG</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
      </CurrencyProvider>
    </AuthContext.Provider>
  );
}

describe("OwnerLayout", () => {
  it("affiche le nom du propriétaire connecté et le contenu de la route active", () => {
    renderOwnerLayout();

    expect(screen.getByText("Fatou Diop")).toBeInTheDocument();
    expect(screen.getByText("Résumé financier")).toBeInTheDocument();
  });

  it("propose la navigation vers le CRG et surligne l'onglet actif", () => {
    renderOwnerLayout("/proprietaire/crg");

    expect(screen.getByText("Contenu de la page CRG")).toBeInTheDocument();
    const lienCrg = screen.getByRole("link", { name: /Compte-rendu de gestion/ });
    expect(lienCrg).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Tableau de bord" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("group", { name: "Rapports" })).toContainElement(lienCrg);
  });

  it("demande confirmation, puis appelle logout", async () => {
    const user = userEvent.setup();
    const logout = vi.fn(async () => {});
    render(
      <AuthContext.Provider value={{ ...authValue(proprietaire), logout }}>
        <CurrencyProvider>
            <MemoryRouter initialEntries={["/proprietaire"]}>
              <Routes>
                <Route path="/proprietaire" element={<OwnerLayout />}>
                  <Route index element={<div>Résumé financier</div>} />
                </Route>
              </Routes>
            </MemoryRouter>
        </CurrencyProvider>
      </AuthContext.Provider>
    );

    // Confirmation avant de fermer la session : un appui involontaire ne déconnecte plus.
    const ouvrir = screen.getByRole("button", { name: /Se déconnecter/i });
    await user.click(ouvrir);
    const fenetre = screen.getByRole("dialog", { name: "Se déconnecter ?" });
    expect(logout).not.toHaveBeenCalled();

    await user.click(within(fenetre).getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();

    await user.click(ouvrir);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Se déconnecter" }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("n'a plus de bouton clair/sombre : seul le thème clair existe", () => {
    render(
      <AuthContext.Provider value={authValue(proprietaire)}>
        <CurrencyProvider>
          <MemoryRouter initialEntries={["/proprietaire"]}>
            <Routes>
              <Route path="/proprietaire" element={<OwnerLayout />}>
                <Route index element={<div>Résumé financier</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </CurrencyProvider>
      </AuthContext.Provider>
    );

    expect(screen.queryByRole("button", { name: /thème|theme|sombre|dark/i })).not.toBeInTheDocument();
  });
});

describe("OwnerLayout — titre de l'onglet", () => {
  it("porte le nom de la page affichée", () => {
    renderOwnerLayout("/proprietaire/crg");
    expect(document.title).toBe("Compte-rendu de gestion | ImmoPlatform Pro");
  });
});

describe("OwnerLayout — devise", () => {
  it("ne propose pas de sélecteur de devise, chaque montant étant affiché dans sa devise d'origine", () => {
    renderOwnerLayout();
    expect(screen.queryByRole("combobox", { name: "Monnaie de règlement" })).not.toBeInTheDocument();
  });
});
