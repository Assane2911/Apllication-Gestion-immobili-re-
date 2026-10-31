import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthContext } from "../context/auth";
import type { AuthContextValue } from "../context/auth";
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
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<div>Tableau de bord admin</div>} />
              <Route path="parametres" element={<div>Paramètres admin</div>} />
              <Route path="journal" element={<div>Journal admin</div>} />
              <Route path="gestionnaires/:id" element={<div>Fiche gestionnaire</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
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
    // Même onglet actif que dans les espaces locataire et propriétaire (voir EnteteEspace).
    expect(lienParametres.className).toMatch(/from-brand-600/);
    expect(lienParametres.className).toMatch(/text-white/);
    expect(lienParametres).toHaveAttribute("aria-current", "page");
  });

  it("demande confirmation, puis appelle logout", async () => {
    const user = userEvent.setup();
    const logout = vi.fn(async () => {});
    renderAdminLayout("/admin", logout);

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
      <AuthContext.Provider value={authValue(admin)}>
        <MemoryRouter initialEntries={["/admin"]}>
          <Routes>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<div>Tableau de bord admin</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    );

    expect(screen.queryByRole("button", { name: /thème|theme|sombre|dark/i })).not.toBeInTheDocument();
  });
});

describe("AdminLayout — titre de l'onglet", () => {
  it("porte le nom de la page affichée", () => {
    renderAdminLayout("/admin/journal");
    expect(document.title).toBe("Journal d'audit | ImmoPlatform Pro");
  });

  it("suit la page quand on change d'entrée de navigation", () => {
    const { unmount } = renderAdminLayout("/admin");
    const accueil = document.title;
    unmount();
    renderAdminLayout("/admin/parametres");
    expect(accueil).toMatch(/ \| ImmoPlatform Pro$/);
    expect(document.title).not.toBe(accueil);
  });

  it("la fiche d'un gestionnaire garde le libellé de sa section, pas celui du tableau de bord", () => {
    renderAdminLayout("/admin/gestionnaires/abc123");
    expect(document.title).toBe("Gestionnaires | ImmoPlatform Pro");
  });
});
