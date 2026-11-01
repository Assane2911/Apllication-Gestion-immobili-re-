import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AuthContext } from "../context/auth";
import type { AuthContextValue } from "../context/auth";
import { CurrencyProvider } from "../context/CurrencyContext";
import type { AuthUser } from "../types";
import TenantLayout from "./TenantLayout";

function noop(): never {
  throw new Error("not implemented in this test");
}

const locataire: AuthUser = {
  id: "t1",
  email: "locataire@test.local",
  role: "TENANT",
  tenantName: "Fatou Diop",
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

function renderTenantLayout() {
  return render(
    <AuthContext.Provider value={authValue(locataire)}>
      <CurrencyProvider>
          <MemoryRouter initialEntries={["/portail"]}>
            <Routes>
              <Route path="/portail" element={<TenantLayout />}>
                <Route index element={<div>Contenu du portail</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
      </CurrencyProvider>
    </AuthContext.Provider>
  );
}

describe("TenantLayout — menu latéral", () => {
  it("propose les quatre pages du portail dans le menu latéral, rangées en rubriques", () => {
    renderTenantLayout();

    for (const nom of ["Mon logement", "Mes loyers", "Messagerie", "Signaler un problème"]) {
      expect(screen.getByRole("link", { name: nom })).toBeInTheDocument();
    }
    expect(screen.getByRole("group", { name: "Échanges" })).toBeInTheDocument();
    // La page affichée est signalée comme page courante.
    expect(screen.getByRole("link", { name: "Mon logement" })).toHaveAttribute("aria-current", "page");
  });

  it("affiche le nom du locataire connecté et garde le contenu de la route active", () => {
    renderTenantLayout();
    expect(screen.getByText("Fatou Diop")).toBeInTheDocument();
    expect(screen.getByText("Contenu du portail")).toBeInTheDocument();
  });

  it("garde un bouton de déconnexion accessible, qui demande confirmation avant de fermer la session", async () => {
    renderTenantLayout();
    const bouton = screen.getByRole("button", { name: /se déconnecter/i });
    expect(bouton).toBeInTheDocument();

    await userEvent.setup().click(bouton);
    expect(screen.getByRole("dialog", { name: "Se déconnecter ?" })).toBeInTheDocument();
  });
});

describe("TenantLayout — titre de l'onglet", () => {
  it("porte le nom de la page affichée, pour qu'un changement de page soit annoncé et reconnaissable", () => {
    render(
      <AuthContext.Provider value={authValue(locataire)}>
        <CurrencyProvider>
            <MemoryRouter initialEntries={["/portail/paiements"]}>
              <Routes>
                <Route path="/portail" element={<TenantLayout />}>
                  <Route path="paiements" element={<div>Mes loyers</div>} />
                </Route>
              </Routes>
            </MemoryRouter>
        </CurrencyProvider>
      </AuthContext.Provider>
    );
    expect(document.title).toBe("Mes loyers | ImmoPlatform Pro");
  });

  it("n'affiche plus en dur « Espace résident » : le libellé suit la langue", () => {
    renderTenantLayout();
    expect(screen.getByText("Espace résident")).toBeInTheDocument();
  });
});

/**
 * Chaque montant du portail locataire s'affiche dans la devise de son bail ou de sa facture : un sélecteur
 * « EUR » à côté de montants en FCFA ne changeait rien et laissait croire l'inverse.
 */
describe("TenantLayout — devise", () => {
  it("ne propose pas de sélecteur de devise, les montants étant dans la devise du contrat", () => {
    renderTenantLayout();
    expect(screen.queryByRole("combobox", { name: "Monnaie de règlement" })).not.toBeInTheDocument();
  });
});
