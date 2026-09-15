import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AuthContext } from "../context/auth";
import type { AuthContextValue } from "../context/auth";
import { CurrencyProvider } from "../context/CurrencyContext";
import { ThemeContext } from "../context/theme";
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
    verifyEmail: noop,
    logout: () => {},
    refreshUser: async () => user,
  };
}

function renderTenantLayout() {
  return render(
    <AuthContext.Provider value={authValue(locataire)}>
      <CurrencyProvider>
        <ThemeContext.Provider value={{ theme: "light", toggleTheme: () => {} }}>
          <MemoryRouter initialEntries={["/portail"]}>
            <Routes>
              <Route path="/portail" element={<TenantLayout />}>
                <Route index element={<div>Contenu du portail</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ThemeContext.Provider>
      </CurrencyProvider>
    </AuthContext.Provider>
  );
}

/**
 * Régression : sur mobile, le bouton « Se déconnecter » sortait complètement
 * de l'écran. Le conteneur des contrôles (langue/devise/thème/déconnexion)
 * n'acceptait pas de retour à la ligne (`flex` sans `flex-wrap`) : dès que
 * les sélecteurs de langue et de devise (du texte assez long, ex. "EUR (€) —
 * Euro") ne tenaient plus sur une seule ligne à côté du bouton thème et du
 * bouton de déconnexion, ces deux derniers étaient poussés hors du viewport
 * sans aucun moyen d'y accéder (pas de défilement horizontal). Le bouton
 * était de plus stylé uniquement au survol (`hover:`), un état qui n'existe
 * pas au doigt sur un écran tactile : même quand il restait visible, rien ne
 * le distinguait visuellement des icônes voisines avant d'être touché.
 *
 * jsdom ne calcule pas de vraie mise en page (pas de retour à la ligne flex
 * observable), donc on vérifie ici la présence des classes qui portent
 * réellement le correctif, complément à la vérification visuelle (capture
 * d'écran à 360/390px) faite en dehors de la suite de tests.
 */
describe("TenantLayout — bouton de déconnexion", () => {
  it("est toujours visible (texte non masqué) et stylé distinctement au repos, pas seulement au survol", () => {
    renderTenantLayout();
    const bouton = screen.getByRole("button", { name: /se déconnecter/i });

    expect(bouton).toBeVisible();
    // Le libellé ne doit plus être caché sur mobile (ancienne classe
    // `hidden sm:inline`), sans quoi seule une icône reste sur un petit écran.
    expect(bouton.querySelector(".hidden")).toBeNull();
    // Style rose visible au repos (pas uniquement via une classe `hover:`),
    // pour rester reconnaissable au doigt sans interaction préalable.
    expect(bouton.className).toMatch(/text-rose-600/);
    expect(bouton.className).toMatch(/bg-rose-50/);
  });

  it("permet aux contrôles (langue/devise/thème/déconnexion) de passer à la ligne au lieu de déborder hors de l'écran", () => {
    renderTenantLayout();
    const bouton = screen.getByRole("button", { name: /se déconnecter/i });
    const conteneurControles = bouton.parentElement;

    expect(conteneurControles?.className).toMatch(/flex-wrap/);
  });
});
