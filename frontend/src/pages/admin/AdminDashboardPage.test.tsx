import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import AdminDashboardPage from "./AdminDashboardPage";

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
    mrr: { total: 68.17, byPlan: { STARTER: 0, PRO: 29, ENTERPRISE: 39.17 }, contributors: 2 },
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

    render(<AdminDashboardPage />);

    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("68,17 €")).toBeInTheDocument();
    expect(screen.getByText("34")).toBeInTheDocument();
    expect(screen.getByText("28")).toBeInTheDocument();
    expect(screen.getByText("19")).toBeInTheDocument();
  });

  it("liste les essais se terminant bientôt avec le nom de l'agence", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: stats() });

    render(<AdminDashboardPage />);

    await waitFor(() => expect(screen.getByText("Agence du Port")).toBeInTheDocument());
    expect(screen.getByText("agence-port@test.local")).toBeInTheDocument();
    expect(screen.getByText("2 jour(s) restant(s)")).toBeInTheDocument();
  });

  it("affiche un message dédié quand aucun essai ne se termine bientôt", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: stats({ trialsEndingSoon: [] }) });

    render(<AdminDashboardPage />);

    await waitFor(() => expect(screen.getByText("Aucun essai ne se termine dans les 7 prochains jours.")).toBeInTheDocument());
  });

  it("affiche une erreur avec un bouton réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });

    render(<AdminDashboardPage />);

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({ data: stats() });
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("Agence du Port")).toBeInTheDocument());
  });
});
