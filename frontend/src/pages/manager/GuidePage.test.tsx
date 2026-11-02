import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
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

describe("GuidePage — avancement", () => {
  beforeEach(() => localStorage.clear());

  it("démarre à zéro et désigne la première étape comme la prochaine", () => {
    renderGuide(utilisateur("ENTERPRISE"));
    expect(screen.getByText("0 étape(s) sur 8 faites")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    const premiere = screen.getAllByRole("listitem")[0];
    expect(premiere).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Prochaine étape", { exact: false }).parentElement).toHaveTextContent("Renseignez votre agence");
  });

  it("coche une étape, avance la jauge, passe à la suivante et garde la coche d'une visite à l'autre", async () => {
    const user = userEvent.setup();
    const { unmount } = renderGuide(utilisateur("ENTERPRISE"));
    await user.click(screen.getByRole("button", { name: /Marquer comme faite.*Renseignez votre agence/ }));

    expect(screen.getByText("1 étape(s) sur 8 faites")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getAllByRole("listitem")[1]).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: /Rouvrir.*Renseignez votre agence/ })).toHaveAttribute("aria-pressed", "true");
    unmount();

    renderGuide(utilisateur("ENTERPRISE"));
    expect(screen.getByText("1 étape(s) sur 8 faites")).toBeInTheDocument();
  });

  it("rouvre une étape, réinitialise tout et félicite quand tout est fait", async () => {
    const user = userEvent.setup();
    renderGuide(utilisateur("ENTERPRISE"));
    for (const bouton of screen.getAllByRole("button", { name: /Marquer comme faite/ })) await user.click(bouton);
    expect(screen.getByText("8 étape(s) sur 8 faites")).toBeInTheDocument();
    expect(screen.getByText(/Tout est fait : votre agence est prête/)).toBeInTheDocument();
    expect(document.querySelector('[aria-current="step"]')).toBeNull();

    await user.click(screen.getByRole("button", { name: /Rouvrir.*Choisissez votre formule/ }));
    expect(screen.getByText("7 étape(s) sur 8 faites")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")[7]).toHaveAttribute("aria-current", "step");

    await user.click(screen.getByRole("button", { name: "Tout réinitialiser" }));
    expect(screen.getByText("0 étape(s) sur 8 faites")).toBeInTheDocument();
  });

  it("ignore un stockage corrompu", () => {
    localStorage.setItem("immoplatform.guide.etapes", "{pas du json");
    renderGuide(utilisateur("ENTERPRISE"));
    expect(screen.getByText("0 étape(s) sur 8 faites")).toBeInTheDocument();
  });
});
