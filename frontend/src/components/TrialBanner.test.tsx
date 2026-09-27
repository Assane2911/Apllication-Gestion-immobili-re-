import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AuthContext } from "../context/auth";
import type { AuthContextValue } from "../context/auth";
import type { AuthUser, SubscriptionInfo } from "../types";
import TrialBanner from "./TrialBanner";

function noop(): never {
  throw new Error("not implemented in this test");
}

function subscription(overrides: Partial<SubscriptionInfo> = {}): SubscriptionInfo {
  return {
    status: "TRIAL",
    plan: "STARTER",
    trialDaysRemaining: 10,
    isTrialActive: true,
    isSubscriptionActive: false,
    isExpired: false,
    ...overrides,
  };
}

function gestionnaire(subscriptionOverrides?: Partial<SubscriptionInfo> | null): AuthUser {
  return {
    id: "m1",
    email: "gestionnaire@test.local",
    role: "MANAGER",
    subscription: subscriptionOverrides === null ? null : subscription(subscriptionOverrides),
  };
}

function authValue(user: AuthUser | null): AuthContextValue {
  return {
    user,
    loading: false,
    login: noop,
    register: noop,
    loginWithGoogle: noop,
    verifyEmail: noop,
    logout: async () => {},
    refreshUser: async () => user,
  };
}

function renderBanner(user: AuthUser | null) {
  return render(
    <AuthContext.Provider value={authValue(user)}>
      <MemoryRouter>
        <TrialBanner />
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

describe("TrialBanner", () => {
  it("ne rend rien pour un rôle autre que gestionnaire", () => {
    const { container } = renderBanner({ id: "t1", email: "locataire@test.local", role: "TENANT" });
    expect(container).toBeEmptyDOMElement();
  });

  it("ne rend rien quand le gestionnaire n'a pas d'information d'abonnement", () => {
    const { container } = renderBanner(gestionnaire(null));
    expect(container).toBeEmptyDOMElement();
  });

  it("affiche le bandeau d'expiration avec un lien de déblocage quand l'abonnement est expiré", () => {
    renderBanner(gestionnaire({ isExpired: true, isTrialActive: false, status: "EXPIRED" }));

    expect(screen.getByText("Période d'essai expirée")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Débloquer mon compte/ })).toHaveAttribute("href", "/subscription");
  });

  it("affiche le nombre de jours d'essai restants (pluriel)", () => {
    renderBanner(gestionnaire({ trialDaysRemaining: 10 }));
    expect(screen.getByText("Il vous reste 10 jours d'essai gratuit")).toBeInTheDocument();
  });

  it("affiche un message dédié le dernier jour d'essai", () => {
    renderBanner(gestionnaire({ trialDaysRemaining: 0 }));
    expect(screen.getByText("Dernier jour d'essai !")).toBeInTheDocument();
  });

  it("affiche le bandeau d'abonnement actif avec le plan souscrit", () => {
    renderBanner(gestionnaire({ status: "ACTIVE", isTrialActive: false, plan: "PRO" }));

    expect(screen.getByText(/Plan PRO/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Gérer mon abonnement" })).toHaveAttribute("href", "/subscription");
  });

  it("ne rend rien pour un abonnement annulé (ni essai, ni expiré, ni actif)", () => {
    const { container } = renderBanner(gestionnaire({ status: "CANCELLED", isTrialActive: false, isExpired: false }));
    expect(container).toBeEmptyDOMElement();
  });
});
