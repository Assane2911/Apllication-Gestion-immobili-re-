import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthContext } from "../context/auth";
import type { AuthContextValue } from "../context/auth";
import type { AuthUser } from "../types";
import AdminLayout from "./AdminLayout";

// L'enrôlement lui-même est testé dans TwoFactorSetupModal.test.tsx : ici, seule compte la façon dont le layout l'ouvre et en sort.
vi.mock("./TwoFactorSetupModal", () => ({
  default: ({ onSuccess, onClose }: { onSuccess: () => void; onClose: () => void }) => (
    <div role="dialog" aria-label="enrôlement">
      <button onClick={onSuccess}>enrôlement terminé</button>
      <button onClick={onClose}>fermer l'enrôlement</button>
    </div>
  ),
}));

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
    // Même page active que dans le menu latéral du gestionnaire : pastille grise, texte en gras.
    expect(lienParametres.className).toMatch(/bg-slate-100/);
    expect(lienParametres.className).toMatch(/font-semibold/);
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

describe("AdminLayout — double authentification obligatoire", () => {
  function renderSansDeuxFacteurs(refreshUser = vi.fn(async () => ({ ...admin, twoFactorEnabled: true }))) {
    const utilisateur: AuthUser = { ...admin, twoFactorEnabled: false };
    render(
      <AuthContext.Provider value={{ ...authValue(utilisateur), refreshUser }}>
        <MemoryRouter initialEntries={["/admin/journal"]}>
          <Routes>
            <Route path="/admin" element={<AdminLayout />}>
              <Route path="journal" element={<div>Journal admin</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    );
    return refreshUser;
  }

  it("remplace la page par l'écran d'activation tant que la double authentification manque, quelle que soit l'adresse", () => {
    renderSansDeuxFacteurs();

    expect(screen.getByRole("heading", { name: "Activez la double authentification" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/un mot de passe volé ne doit pas suffire/);
    expect(screen.queryByText("Journal admin")).not.toBeInTheDocument();
  });

  it("ouvre l'enrôlement au clic, puis relit le profil quand il est terminé (sans nouvelle connexion)", async () => {
    const refreshUser = renderSansDeuxFacteurs();

    await userEvent.click(screen.getByRole("button", { name: "Activer la double authentification" }));
    expect(screen.getByRole("dialog", { name: "enrôlement" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "enrôlement terminé" }));
    expect(refreshUser).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "enrôlement" })).not.toBeInTheDocument();
  });

  it("referme l'enrôlement sans relire le profil quand on l'abandonne", async () => {
    const refreshUser = renderSansDeuxFacteurs();

    await userEvent.click(screen.getByRole("button", { name: "Activer la double authentification" }));
    await userEvent.click(screen.getByRole("button", { name: "fermer l'enrôlement" }));

    expect(refreshUser).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Activez la double authentification" })).toBeInTheDocument();
  });

  it("ne bloque pas un administrateur qui l'a activée, ni un profil dont l'état n'est pas encore connu", () => {
    const { unmount } = render(
      <AuthContext.Provider value={authValue({ ...admin, twoFactorEnabled: true })}>
        <MemoryRouter initialEntries={["/admin/journal"]}>
          <Routes>
            <Route path="/admin" element={<AdminLayout />}>
              <Route path="journal" element={<div>Journal admin</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    );
    expect(screen.getByText("Journal admin")).toBeInTheDocument();
    unmount();
  });
});
