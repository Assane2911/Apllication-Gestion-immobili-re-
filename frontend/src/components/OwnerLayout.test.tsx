import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthContext } from "../context/auth";
import type { AuthContextValue } from "../context/auth";
import { CurrencyProvider } from "../context/CurrencyContext";
import { ThemeContext } from "../context/theme";
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
    verifyEmail: noop,
    logout: async () => {},
    refreshUser: async () => user,
  };
}

function renderOwnerLayout(initialEntry = "/proprietaire") {
  return render(
    <AuthContext.Provider value={authValue(proprietaire)}>
      <CurrencyProvider>
        <ThemeContext.Provider value={{ theme: "light", toggleTheme: () => {} }}>
          <MemoryRouter initialEntries={[initialEntry]}>
            <Routes>
              <Route path="/proprietaire" element={<OwnerLayout />}>
                <Route index element={<div>Résumé financier</div>} />
                <Route path="crg" element={<div>Contenu de la page CRG</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ThemeContext.Provider>
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
    expect(lienCrg.className).toMatch(/from-brand-600/);
  });

  it("appelle logout au clic sur le bouton de déconnexion", async () => {
    const user = userEvent.setup();
    const logout = vi.fn(async () => {});
    render(
      <AuthContext.Provider value={{ ...authValue(proprietaire), logout }}>
        <CurrencyProvider>
          <ThemeContext.Provider value={{ theme: "light", toggleTheme: () => {} }}>
            <MemoryRouter initialEntries={["/proprietaire"]}>
              <Routes>
                <Route path="/proprietaire" element={<OwnerLayout />}>
                  <Route index element={<div>Résumé financier</div>} />
                </Route>
              </Routes>
            </MemoryRouter>
          </ThemeContext.Provider>
        </CurrencyProvider>
      </AuthContext.Provider>
    );

    await user.click(screen.getByRole("button", { name: /Se déconnecter/i }));
    expect(logout).toHaveBeenCalled();
  });

  it("bascule le thème au clic sur le bouton clair/sombre", async () => {
    const user = userEvent.setup();
    const toggleTheme = vi.fn();
    render(
      <AuthContext.Provider value={authValue(proprietaire)}>
        <CurrencyProvider>
          <ThemeContext.Provider value={{ theme: "light", toggleTheme }}>
            <MemoryRouter initialEntries={["/proprietaire"]}>
              <Routes>
                <Route path="/proprietaire" element={<OwnerLayout />}>
                  <Route index element={<div>Résumé financier</div>} />
                </Route>
              </Routes>
            </MemoryRouter>
          </ThemeContext.Provider>
        </CurrencyProvider>
      </AuthContext.Provider>
    );

    await user.click(screen.getByRole("button", { name: /Basculer le thème/i }));
    expect(toggleTheme).toHaveBeenCalled();
  });
});
