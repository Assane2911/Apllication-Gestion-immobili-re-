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
    loginWithGoogle: noop,
    verifyTwoFactor: noop,
    verifyEmail: noop,
    logout: async () => {},
    refreshUser: async () => user,
  };
}

function rendre(user: AuthUser | null, chemin: string, role: "MANAGER" | "TENANT" = "MANAGER") {
  return render(
    <AuthContext.Provider value={authValue(user)}>
      <MemoryRouter initialEntries={[chemin]}>
        <Routes>
          <Route path="/dashboard" element={<ProtectedRoute role={role}><div>Tableau de bord</div></ProtectedRoute>} />
          <Route path="/subscription" element={<ProtectedRoute role={role}><div>Abonnement</div></ProtectedRoute>} />
          <Route path="/pays" element={<ProtectedRoute role={role}><div>Choix du pays</div></ProtectedRoute>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

/**
 * Le pays de l'agence fixe les règles de location qui lui sont appliquées : un gestionnaire qui ne l'a pas encore
 * choisi (compte créé par Google, ou d'avant ce champ) est envoyé le choisir avant tout autre écran.
 */
describe("ProtectedRoute — pays de l'agence obligatoire", () => {
  const gestionnaire = (pays: string | null | undefined): AuthUser => ({ id: "m1", email: "m@test.local", role: "MANAGER", country: pays });

  it("renvoie un gestionnaire sans pays vers le choix du pays", () => {
    rendre(gestionnaire(null), "/dashboard");

    expect(screen.getByText("Choix du pays")).toBeInTheDocument();
    expect(screen.queryByText("Tableau de bord")).not.toBeInTheDocument();
  });

  it("laisse passer un gestionnaire qui a choisi son pays", () => {
    rendre(gestionnaire("SN"), "/dashboard");

    expect(screen.getByText("Tableau de bord")).toBeInTheDocument();
  });

  it("n'envoie pas en boucle vers la page du choix du pays", () => {
    rendre(gestionnaire(null), "/pays");

    expect(screen.getByText("Choix du pays")).toBeInTheDocument();
  });

  it("ne tient pas pour « non choisi » un profil gardé en mémoire avant ce champ : il est rafraîchi au chargement", () => {
    rendre(gestionnaire(undefined), "/dashboard");

    expect(screen.getByText("Tableau de bord")).toBeInTheDocument();
  });

  it("passe avant l'abonnement : le prix dépend de la devise, donc du pays", () => {
    const expire = { ...gestionnaire(null), subscription: { isExpired: true } } as unknown as AuthUser;
    rendre(expire, "/dashboard");

    expect(screen.getByText("Choix du pays")).toBeInTheDocument();
    expect(screen.queryByText("Abonnement")).not.toBeInTheDocument();
  });

  it("ne concerne que le gestionnaire : un locataire sans pays n'est pas renvoyé le choisir", () => {
    const locataire: AuthUser = { id: "t1", email: "t@test.local", role: "TENANT", country: null };
    rendre(locataire, "/dashboard", "TENANT");

    expect(screen.getByText("Tableau de bord")).toBeInTheDocument();
  });
});
