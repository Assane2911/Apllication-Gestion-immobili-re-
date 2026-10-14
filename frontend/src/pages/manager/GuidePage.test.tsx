import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AuthContext } from "../../context/auth";
import type { AuthContextValue } from "../../context/auth";
import type { AuthUser } from "../../types";
import GuidePage from "./GuidePage";

function noop(): never {
  throw new Error("not implemented in this test");
}

function utilisateur(plan: "STARTER" | "PRO" | "ENTERPRISE", essai = false): AuthUser {
  return {
    id: "m1",
    email: "gestionnaire@test.local",
    role: "MANAGER",
    subscription: {
      status: essai ? "TRIAL" : "ACTIVE",
      plan,
      trialDaysRemaining: essai ? 10 : 0,
      isTrialActive: essai,
      isSubscriptionActive: !essai,
      isExpired: false,
    },
  };
}

function renderGuide(user: AuthUser) {
  const auth: AuthContextValue = {
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
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={["/guide-demarrage"]}>
        <Routes>
          <Route path="/guide-demarrage" element={<GuidePage />} />
          <Route path="/dashboard" element={<div>Tableau de bord</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

describe("GuidePage — guide de démarrage de la formule Agence", () => {
  it("présente huit étapes numérotées, dans l'ordre où une nouvelle agence en a besoin", () => {
    renderGuide(utilisateur("ENTERPRISE"));
    expect(screen.getByRole("heading", { name: "Guide de démarrage", level: 2 })).toBeInTheDocument();
    const etapes = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(etapes).toHaveLength(8);
    const titres = etapes.map((e) => within(e).getByRole("heading", { level: 3 }).textContent);
    expect(titres[0]).toBe("Renseignez votre agence");
    expect(titres[1]).toBe("Importez vos données existantes");
    expect(titres[7]).toBe("Choisissez votre formule");
  });

  it("chaque étape renvoie à la page qui la réalise, import avant bail", () => {
    renderGuide(utilisateur("ENTERPRISE"));
    const liens = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(liens).toEqual(["/agency", "/import", "/properties", "/contracts", "/tenants", "/invoices", "/agency", "/subscription"]);
  });

  it("nomme la destination de chaque lien pour un lecteur d'écran, pas seulement « Ouvrir »", () => {
    renderGuide(utilisateur("ENTERPRISE"));
    expect(screen.getByRole("link", { name: /Ouvrir.*Importez vos données existantes/ })).toHaveAttribute("href", "/import");
  });

  it("reste ouverte pendant l'essai gratuit : c'est alors qu'une nouvelle agence en a besoin", () => {
    renderGuide(utilisateur("STARTER", true));
    expect(screen.getByRole("heading", { name: "Guide de démarrage", level: 2 })).toBeInTheDocument();
  });

  it.each(["STARTER", "PRO"] as const)("renvoie au tableau de bord un gestionnaire de la formule %s hors essai : le guide est propre à la formule Agence", (plan) => {
    renderGuide(utilisateur(plan));
    expect(screen.queryByRole("heading", { name: "Guide de démarrage" })).not.toBeInTheDocument();
    expect(screen.getByText("Tableau de bord")).toBeInTheDocument();
  });
});
