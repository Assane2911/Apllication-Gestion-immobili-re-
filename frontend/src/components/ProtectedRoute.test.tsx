import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AuthContext } from "../context/auth";
import type { AuthContextValue } from "../context/auth";
import type { AuthUser } from "../types";
import ProtectedRoute from "./ProtectedRoute";

function noop(): never {
  throw new Error("not implemented in this test");
}

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

function renderProtected(user: AuthUser | null, role: "MANAGER" | "TENANT" | "ADMIN", initialPath = "/prive") {
  return render(
    <AuthContext.Provider value={authValue(user)}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/prive"
            element={
              <ProtectedRoute role={role}>
                <div>Contenu protégé</div>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<div>Page de connexion</div>} />
          <Route path="/dashboard" element={<div>Accueil gestionnaire</div>} />
          <Route path="/portail" element={<div>Portail locataire</div>} />
          <Route path="/subscription" element={<div>Page abonnement</div>} />
          <Route path="/admin" element={<div>Espace admin</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

const managerActif: AuthUser = {
  id: "m1",
  email: "gestionnaire@test.local",
  role: "MANAGER",
  subscription: {
    status: "TRIAL",
    plan: "STARTER",
    trialDaysRemaining: 5,
    isTrialActive: true,
    isSubscriptionActive: false,
    isExpired: false,
  },
};

const adminActif: AuthUser = {
  id: "a1",
  email: "admin@immoplatformpro.com",
  role: "ADMIN",
};

describe("ProtectedRoute", () => {
  it("redirige vers /login si personne n'est connecté", () => {
    renderProtected(null, "MANAGER");
    expect(screen.getByText("Page de connexion")).toBeInTheDocument();
  });

  it("laisse passer un gestionnaire connecté avec un abonnement actif", () => {
    renderProtected(managerActif, "MANAGER");
    expect(screen.getByText("Contenu protégé")).toBeInTheDocument();
  });

  it("redirige un locataire qui tente d'accéder à une page réservée aux gestionnaires", () => {
    const locataire: AuthUser = { id: "t1", email: "locataire@test.local", role: "TENANT" };
    renderProtected(locataire, "MANAGER");
    expect(screen.getByText("Portail locataire")).toBeInTheDocument();
  });

  it("redirige un gestionnaire qui tente d'accéder à une page réservée aux locataires", () => {
    renderProtected(managerActif, "TENANT");
    expect(screen.getByText("Accueil gestionnaire")).toBeInTheDocument();
  });

  it("laisse passer un administrateur connecté sur l'espace admin", () => {
    renderProtected(adminActif, "ADMIN");
    expect(screen.getByText("Contenu protégé")).toBeInTheDocument();
  });

  it("redirige un gestionnaire qui tente d'accéder à l'espace admin", () => {
    renderProtected(managerActif, "ADMIN");
    expect(screen.getByText("Accueil gestionnaire")).toBeInTheDocument();
  });

  it("redirige un administrateur qui tente d'accéder à une page réservée aux gestionnaires", () => {
    renderProtected(adminActif, "MANAGER");
    expect(screen.getByText("Espace admin")).toBeInTheDocument();
  });

  it("bloque un gestionnaire dont l'abonnement a expiré (paywall)", () => {
    const managerExpire: AuthUser = {
      ...managerActif,
      subscription: { ...managerActif.subscription!, isExpired: true, isTrialActive: false },
    };
    renderProtected(managerExpire, "MANAGER");
    expect(screen.getByText("Page abonnement")).toBeInTheDocument();
  });

  it("n'entre pas en boucle de redirection quand le gestionnaire expiré est déjà sur /subscription", () => {
    const managerExpire: AuthUser = {
      ...managerActif,
      subscription: { ...managerActif.subscription!, isExpired: true, isTrialActive: false },
    };
    render(
      <AuthContext.Provider value={authValue(managerExpire)}>
        <MemoryRouter initialEntries={["/subscription"]}>
          <Routes>
            <Route
              path="/subscription"
              element={
                <ProtectedRoute role="MANAGER">
                  <div>Page abonnement (contenu réel)</div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    );
    expect(screen.getByText("Page abonnement (contenu réel)")).toBeInTheDocument();
  });
});
