import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthContext } from "../context/auth";
import type { AuthContextValue } from "../context/auth";
import { ThemeContext } from "../context/theme";
import type { AuthUser } from "../types";
import AdminLayout from "./AdminLayout";

function noop(): never {
  throw new Error("not implemented in this test");
}

const admin: AuthUser = {
  id: "a1",
  email: "admin@test.local",
  role: "ADMIN",
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

function renderAdminLayout(initialEntry = "/admin", logout = async () => {}) {
  return render(
    <AuthContext.Provider value={{ ...authValue(admin), logout }}>
      <ThemeContext.Provider value={{ theme: "light", toggleTheme: () => {} }}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<div>Tableau de bord admin</div>} />
              <Route path="parametres" element={<div>Paramètres admin</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeContext.Provider>
    </AuthContext.Provider>
  );
}

describe("AdminLayout", () => {
  it("affiche l'email de l'administrateur connecté et le contenu de la route active", () => {
    renderAdminLayout();

    expect(screen.getByText("admin@test.local")).toBeInTheDocument();
    expect(screen.getByText("Tableau de bord admin")).toBeInTheDocument();
  });

  it("propose la navigation vers les paramètres et surligne l'onglet actif", () => {
    renderAdminLayout("/admin/parametres");

    expect(screen.getByText("Paramètres admin")).toBeInTheDocument();
    const lienParametres = screen.getByRole("link", { name: /Paramètres/ });
    expect(lienParametres.className).toMatch(/bg-brand-600/);
  });

  it("appelle logout au clic sur le bouton de déconnexion", async () => {
    const user = userEvent.setup();
    const logout = vi.fn(async () => {});
    renderAdminLayout("/admin", logout);

    await user.click(screen.getByRole("button", { name: /Se déconnecter/i }));
    expect(logout).toHaveBeenCalled();
  });

  it("bascule le thème au clic sur le bouton clair/sombre", async () => {
    const user = userEvent.setup();
    const toggleTheme = vi.fn();
    render(
      <AuthContext.Provider value={authValue(admin)}>
        <ThemeContext.Provider value={{ theme: "light", toggleTheme }}>
          <MemoryRouter initialEntries={["/admin"]}>
            <Routes>
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<div>Tableau de bord admin</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ThemeContext.Provider>
      </AuthContext.Provider>
    );

    await user.click(screen.getByRole("button", { name: /Basculer le thème/i }));
    expect(toggleTheme).toHaveBeenCalled();
  });
});
