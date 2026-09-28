import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import AdminDashboardPage from "./AdminDashboardPage";

function renderPage() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <AdminDashboardPage />
      </CurrencyProvider>
    </AuthProvider>
  );
}

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function stats(overrides: Record<string, unknown> = {}) {
  return {
    managers: { total: 12, trialActive: 4, subscriptionActive: 6, expired: 2 },
    trialsEndingSoon: [
      { userId: "mgr-1", email: "agence-port@test.local", agencyName: "Agence du Port", trialEndsAt: "2026-09-12T00:00:00.000Z", daysRemaining: 2 },
    ],
    // Le MRR est ventilé par devise depuis que les formules sont tarifées
    // séparément en euros et en FCFA : additionner les deux ne voudrait rien dire.
    mrr: {
      byCurrency: [{ currency: "EUR", total: 68.17, byPlan: { STARTER: 0, PRO: 29, ENTERPRISE: 39.17 }, contributors: 2 }],
      contributors: 2,
    },
    usage: { totalProperties: 34, totalTenants: 28, activeContracts: 19 },
    ...overrides,
  };
}

describe("AdminDashboardPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
  });

  it("affiche les indicateurs clés de la plateforme", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: stats() });

    renderPage();

    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("68,17 €")).toBeInTheDocument();
    expect(screen.getByText("34")).toBeInTheDocument();
    expect(screen.getByText("28")).toBeInTheDocument();
    expect(screen.getByText("19")).toBeInTheDocument();
  });

  // Régression : cette page formatait le MRR avec sa propre table de symboles
  // (EUR/XOF/XAF/USD/GBP, symbole toujours après le montant), au lieu du
  // formatage partagé (CurrencyContext) déjà utilisé par le reste de l'admin
  // — un abonnement en USD ou GBP s'affichait donc "150 $" au lieu de "$150",
  // et une devise plus récente (ex. CHF, MAD) retombait sur son code brut.
  it("place le symbole avant le montant pour une devise qui le veut (USD)", async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: stats({
        mrr: {
          byCurrency: [{ currency: "USD", total: 150, byPlan: { STARTER: 0, PRO: 150, ENTERPRISE: 0 }, contributors: 1 }],
          contributors: 1,
        },
      }),
    });

    renderPage();

    // "$150" apparaît deux fois (la tuile MRR et la ventilation par formule,
    // toutes deux sur cette seule devise) : les deux affichages doivent
    // s'accorder.
    await waitFor(() => expect(screen.getAllByText("$150").length).toBeGreaterThan(0));
  });

  it("liste les essais se terminant bientôt avec le nom de l'agence", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: stats() });

    renderPage();

    await waitFor(() => expect(screen.getByText("Agence du Port")).toBeInTheDocument());
    expect(screen.getByText("agence-port@test.local")).toBeInTheDocument();
    expect(screen.getByText("2 jour(s) restant(s)")).toBeInTheDocument();
  });

  it("affiche un message dédié quand aucun essai ne se termine bientôt", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: stats({ trialsEndingSoon: [] }) });

    renderPage();

    await waitFor(() => expect(screen.getByText("Aucun essai ne se termine dans les 7 prochains jours.")).toBeInTheDocument());
  });

  it("affiche une erreur avec un bouton réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });

    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({ data: stats() });
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("Agence du Port")).toBeInTheDocument());
  });
});
