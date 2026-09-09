import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Capacitor } from "@capacitor/core";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import type { AuthUser, SubscriptionInfo, SubscriptionPlanDetail } from "../../types";
import SubscriptionPage from "./SubscriptionPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

// Sans ce mock, Capacitor.isNativePlatform() tourne avec son implémentation
// web réelle (toujours `false` sous jsdom) : la branche mobile ajoutée pour
// la conformité App Store/Play Store (grille de plans masquée, message de
// repli) n'était alors exercée par AUCUN test. Défaut à `false` (web) pour
// que tous les tests existants continuent d'exercer la branche web sans
// changement ; les tests dédiés ci-dessous le passent à `true`.
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
  },
}));

const mockedApi = vi.mocked(api, { deep: true });
const mockedIsNativePlatform = vi.mocked(Capacitor.isNativePlatform);

function plan(overrides: Partial<SubscriptionPlanDetail> = {}): SubscriptionPlanDetail {
  return {
    id: "STARTER",
    name: "Starter",
    description: "Pour débuter en toute simplicité",
    monthlyPrice: 19,
    annualPrice: 182,
    maxProperties: 5,
    popular: false,
    features: ["5 biens", "Support par email"],
    ...overrides,
  };
}

function subscription(overrides: Partial<SubscriptionInfo> = {}): SubscriptionInfo {
  return {
    status: "TRIAL",
    plan: "STARTER",
    trialEndsAt: "2026-09-20T00:00:00.000Z",
    subscriptionEndsAt: null,
    trialDaysRemaining: 7,
    isTrialActive: true,
    isSubscriptionActive: false,
    isExpired: false,
    ...overrides,
  };
}

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "mgr-1",
    email: "gestionnaire@example.com",
    role: "MANAGER",
    subscription: subscription(),
    ...overrides,
  };
}

// Seed un utilisateur déjà connecté (sans "token" : évite que le refreshUser()
// déclenché au montage d'AuthProvider n'appelle /auth/me, ce qui simplifierait
// artificiellement les enchaînements d'appels mockés ci-dessous).
function seedUser(user: AuthUser) {
  localStorage.setItem("user", JSON.stringify(user));
}

function renderPage() {
  return render(
    <AuthProvider>
      <SubscriptionPage />
    </AuthProvider>
  );
}

describe("SubscriptionPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    mockedIsNativePlatform.mockReturnValue(false);
  });

  it("affiche le statut d'essai et les formules disponibles", async () => {
    seedUser(authUser());
    mockedApi.get.mockResolvedValueOnce({ data: [plan({ id: "STARTER" }), plan({ id: "PRO", name: "Pro", monthlyPrice: 39 })] });
    mockedApi.get.mockResolvedValueOnce({ data: { history: [] } });

    renderPage();

    await waitFor(() => expect(screen.getByText("Essai : 7 j restant(s)")).toBeInTheDocument());
    expect(screen.getByText("Starter")).toBeInTheDocument();
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("19 €")).toBeInTheDocument();
    expect(screen.getByText("39 €")).toBeInTheDocument();
  });

  it("désactive le bouton de la formule déjà active", async () => {
    seedUser(authUser({ subscription: subscription({ status: "ACTIVE", plan: "PRO", isTrialActive: false, isSubscriptionActive: true, subscriptionEndsAt: "2026-10-01T00:00:00.000Z" }) }));
    mockedApi.get.mockResolvedValueOnce({ data: [plan({ id: "STARTER" }), plan({ id: "PRO", name: "Pro", monthlyPrice: 39 })] });
    mockedApi.get.mockResolvedValueOnce({ data: { history: [] } });

    renderPage();

    await waitFor(() => expect(screen.getByText("Formule PRO Active")).toBeInTheDocument());
    const currentPlanBtn = screen.getByRole("button", { name: "Votre formule actuelle" });
    expect(currentPlanBtn).toBeDisabled();
    expect(screen.getByRole("button", { name: "Choisir Starter" })).not.toBeDisabled();
  });

  it("le basculement facturation annuelle change le prix affiché", async () => {
    const user = userEvent.setup();
    seedUser(authUser());
    mockedApi.get.mockResolvedValueOnce({ data: [plan({ id: "STARTER", monthlyPrice: 19, annualPrice: 180 })] });
    mockedApi.get.mockResolvedValueOnce({ data: { history: [] } });

    renderPage();
    await waitFor(() => expect(screen.getByText("19 €")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Facturation Annuelle/ }));

    await waitFor(() => expect(screen.getByText("15 €")).toBeInTheDocument()); // 180 / 12 arrondi
    expect(screen.getByText("(facturé 180 € / an)")).toBeInTheDocument();
  });

  it("souscription en mode démo : envoie la requête, affiche la confirmation et recharge", async () => {
    const user = userEvent.setup();
    seedUser(authUser());
    mockedApi.get.mockResolvedValueOnce({ data: [plan({ id: "STARTER" })] });
    mockedApi.get.mockResolvedValueOnce({ data: { history: [] } });
    mockedApi.post.mockResolvedValueOnce({ data: { message: "Abonnement activé avec succès !" } });
    mockedApi.get.mockResolvedValueOnce({ data: [plan({ id: "STARTER" })] });
    mockedApi.get.mockResolvedValueOnce({ data: { history: [] } });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Choisir Starter" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Choisir Starter" }));
    // PAYDUNYA est sélectionné par défaut, donc on choisit explicitement DEMO.
    await user.click(screen.getByRole("radio", { name: /Mode démo/ }));
    await user.click(screen.getByRole("button", { name: "Confirmer et Activer l'Abonnement" }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/subscription/subscribe", {
        plan: "STARTER",
        billingCycle: "MONTHLY",
        paymentMethod: "DEMO",
        bankReference: undefined,
      })
    );
    await waitFor(() => expect(screen.getByText("Abonnement activé avec succès !")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Confirmer et Activer l'Abonnement" })).not.toBeInTheDocument();
  });

  it("virement bancaire : transmet la référence saisie", async () => {
    const user = userEvent.setup();
    seedUser(authUser());
    mockedApi.get.mockResolvedValueOnce({ data: [plan({ id: "STARTER" })] });
    mockedApi.get.mockResolvedValueOnce({ data: { history: [] } });
    mockedApi.post.mockResolvedValueOnce({ data: { message: "Virement déclaré, en attente de validation." } });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Choisir Starter" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Choisir Starter" }));

    await user.click(screen.getByRole("radio", { name: /Virement bancaire/ }));
    await user.type(screen.getByPlaceholderText("Ex: VIR-2026-08-01"), "VIR-2026-09-01");
    await user.click(screen.getByRole("button", { name: "Confirmer et Activer l'Abonnement" }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/subscription/subscribe", {
        plan: "STARTER",
        billingCycle: "MONTHLY",
        paymentMethod: "BANK_TRANSFER",
        bankReference: "VIR-2026-09-01",
      })
    );
  });

  it("redirige vers l'URL PayDunya quand le paiement nécessite une action", async () => {
    const user = userEvent.setup();
    let hrefSet = "";
    Object.defineProperty(window, "location", {
      value: {
        ...window.location,
        get href() {
          return hrefSet;
        },
        set href(v: string) {
          hrefSet = v;
        },
      },
      writable: true,
    });

    seedUser(authUser());
    mockedApi.get.mockResolvedValueOnce({ data: [plan({ id: "STARTER" })] });
    mockedApi.get.mockResolvedValueOnce({ data: { history: [] } });
    mockedApi.post.mockResolvedValueOnce({
      data: { payment: { method: "PAYDUNYA", status: "REQUIRES_ACTION", redirectUrl: "https://paydunya.example/checkout" } },
    });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Choisir Starter" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Choisir Starter" }));

    await user.click(screen.getByRole("radio", { name: /PayDunya/ }));
    await user.click(screen.getByRole("button", { name: "Confirmer et Activer l'Abonnement" }));

    await waitFor(() => expect(hrefSet).toBe("https://paydunya.example/checkout"));
  });

  it("affiche l'historique des paiements d'abonnement quand il existe", async () => {
    seedUser(authUser());
    mockedApi.get.mockResolvedValueOnce({ data: [plan({ id: "STARTER" })] });
    mockedApi.get.mockResolvedValueOnce({
      data: {
        history: [
          {
            id: "h1",
            plan: "STARTER",
            amount: 19,
            billingCycle: "MONTHLY",
            status: "PAID",
            paymentMethod: "DEMO",
            paymentRef: "ref-1",
            startDate: "2026-08-01T00:00:00.000Z",
            endDate: "2026-09-01T00:00:00.000Z",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ],
      },
    });

    renderPage();

    await waitFor(() => expect(screen.getByText("Historique de vos factures d'abonnement")).toBeInTheDocument());
    const table = screen.getByRole("table");
    expect(within(table).getByText("19 €")).toBeInTheDocument();
    expect(within(table).getByText("PAID")).toBeInTheDocument();
  });

  it("affiche une erreur si le chargement des formules échoue", async () => {
    seedUser(authUser());
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());
  });

  it("sur mobile natif (Capacitor), masque la grille de plans et affiche le message de repli", async () => {
    mockedIsNativePlatform.mockReturnValue(true);
    seedUser(authUser()); // TRIAL par défaut, donc pas encore "ACTIVE"
    mockedApi.get.mockResolvedValueOnce({ data: [plan({ id: "STARTER" }), plan({ id: "PRO", name: "Pro" })] });
    mockedApi.get.mockResolvedValueOnce({ data: { history: [] } });

    renderPage();

    await waitFor(() => expect(screen.getByText("Essai : 7 j restant(s)")).toBeInTheDocument());
    expect(screen.queryByText("Starter")).not.toBeInTheDocument();
    expect(screen.queryByText("Pro")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Choisir/ })).not.toBeInTheDocument();
    expect(
      screen.getByText(/Pour souscrire ou changer d'offre, connectez-vous depuis le site web/)
    ).toBeInTheDocument();
  });

  it("sur mobile natif (Capacitor) avec un abonnement déjà actif, n'affiche ni grille ni message de repli", async () => {
    mockedIsNativePlatform.mockReturnValue(true);
    seedUser(
      authUser({
        subscription: subscription({ status: "ACTIVE", plan: "PRO", isTrialActive: false, isSubscriptionActive: true, subscriptionEndsAt: "2026-10-01T00:00:00.000Z" }),
      })
    );
    mockedApi.get.mockResolvedValueOnce({ data: [plan({ id: "STARTER" }), plan({ id: "PRO", name: "Pro" })] });
    mockedApi.get.mockResolvedValueOnce({ data: { history: [] } });

    renderPage();

    await waitFor(() => expect(screen.getByText("Formule PRO Active")).toBeInTheDocument());
    expect(screen.queryByText("Starter")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Pour souscrire ou changer d'offre, connectez-vous depuis le site web/)
    ).not.toBeInTheDocument();
  });
});
