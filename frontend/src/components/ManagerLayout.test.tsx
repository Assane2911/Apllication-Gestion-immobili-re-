import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthContext } from "../context/auth";
import type { AuthContextValue } from "../context/auth";
import { CurrencyProvider } from "../context/CurrencyContext";
import { ThemeContext } from "../context/theme";
import type { AuthUser } from "../types";
import ManagerLayout from "./ManagerLayout";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    api: { get: vi.fn().mockResolvedValue({ data: { notifications: [], count: 0, unseenCount: 0, unreadCount: 0, results: [] } }), post: vi.fn() },
  };
});

function noop(): never {
  throw new Error("not implemented in this test");
}

const gestionnaire: AuthUser = { id: "m1", email: "gestionnaire@test.local", role: "MANAGER" };
const abonnement = (plan: "STARTER" | "PRO" | "ENTERPRISE"): NonNullable<AuthUser["subscription"]> => ({
  status: "ACTIVE",
  plan,
  trialDaysRemaining: 0,
  isTrialActive: false,
  isSubscriptionActive: true,
  isExpired: false,
});
const agence: AuthUser = { ...gestionnaire, id: "m2", subscription: abonnement("ENTERPRISE") };

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

function renderManagerLayout(entree: string, utilisateur: AuthUser = gestionnaire) {
  return render(
    <AuthContext.Provider value={authValue(utilisateur)}>
      <CurrencyProvider>
        <ThemeContext.Provider value={{ theme: "light", toggleTheme: () => {} }}>
          <MemoryRouter initialEntries={[entree]}>
            <Routes>
              <Route element={<ManagerLayout />}>
                <Route path="/dashboard" element={<div>Tableau</div>} />
                <Route path="/tenants" element={<div>Locataires</div>} />
                <Route path="/proprietaires/:ownerId/crg" element={<div>CRG</div>} />
                <Route path="/proprietaires" element={<div>Propriétaires</div>} />
                <Route path="/guide-demarrage" element={<div>Guide</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ThemeContext.Provider>
      </CurrencyProvider>
    </AuthContext.Provider>
  );
}

describe("ManagerLayout — titre de l'onglet", () => {
  it("porte le nom de la page affichée, pour qu'un changement de page soit annoncé et reconnaissable", () => {
    renderManagerLayout("/tenants");
    expect(document.title).toBe("Locataires | ImmoPlatform Pro");
  });

  it("suit la page quand on passe d'une entrée de navigation à une autre", () => {
    const { unmount } = renderManagerLayout("/dashboard");
    expect(document.title).toBe("Tableau de bord | ImmoPlatform Pro");
    unmount();
    renderManagerLayout("/proprietaires");
    expect(document.title).toBe("Propriétaires | ImmoPlatform Pro");
  });

  it("le compte-rendu de gestion d'un propriétaire a son propre libellé, pas celui de la liste", () => {
    renderManagerLayout("/proprietaires/abc123/crg");
    expect(document.title).toBe("Compte-rendu de gestion | ImmoPlatform Pro");
  });

  it("le guide de démarrage est dans le menu de la formule Agence et titre l'onglet", () => {
    renderManagerLayout("/guide-demarrage", agence);
    expect(document.title).toBe("Guide de démarrage | ImmoPlatform Pro");
    expect(screen.getByRole("link", { name: "Guide de démarrage" })).toHaveAttribute("href", "/guide-demarrage");
  });

  it.each([
    ["sans abonnement chargé", gestionnaire],
    ["Starter", { ...gestionnaire, subscription: abonnement("STARTER") }],
    ["Professionnel", { ...gestionnaire, subscription: abonnement("PRO") }],
  ])("le guide de démarrage n'apparaît pas dans le menu : %s", (_nom, utilisateur) => {
    renderManagerLayout("/dashboard", utilisateur as AuthUser);
    expect(screen.queryByRole("link", { name: "Guide de démarrage" })).not.toBeInTheDocument();
  });

  it("la recherche globale a un nom accessible, pas seulement un texte d'exemple", () => {
    renderManagerLayout("/dashboard");
    expect(screen.getByRole("textbox", { name: "Recherche globale" })).toBeInTheDocument();
  });
});
