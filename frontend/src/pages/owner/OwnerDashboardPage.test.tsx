import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { OwnerDashboard } from "../../types";
import OwnerDashboardPage from "./OwnerDashboardPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function dashboard(overrides: Partial<OwnerDashboard> = {}): OwnerDashboard {
  return {
    ownerName: "Fatou Diop",
    managementFeeRate: 8,
    properties: [
      {
        propertyId: "prop-1",
        title: "Villa Ngor",
        address: "Route de Ngor",
        currency: "EUR",
        collected: 1000,
        pending: 200,
      },
    ],
    collectedThisMonthByCurrency: { EUR: 1000 },
    pendingThisMonthByCurrency: { EUR: 200 },
    revenueByMonth: { "2026-08": { EUR: 900 } },
    ...overrides,
  };
}

function renderPage() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <OwnerDashboardPage />
      </CurrencyProvider>
    </AuthProvider>
  );
}

describe("OwnerDashboardPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
  });

  it("affiche le résumé financier du propriétaire connecté (perçu, en attente, commission)", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: dashboard() });
    renderPage();

    await waitFor(() => expect(screen.getByText("Villa Ngor")).toBeInTheDocument());
    expect(mockedApi.get).toHaveBeenCalledWith("/owners/mine/dashboard");
    expect(screen.getByText("Route de Ngor")).toBeInTheDocument();
    expect(screen.getByText("8%")).toBeInTheDocument();
    expect(screen.getAllByText(/1[\s ]000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/200/).length).toBeGreaterThan(0);
  });

  it("affiche un message dédié quand aucun bien n'est associé", async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: dashboard({ properties: [], collectedThisMonthByCurrency: {}, pendingThisMonthByCurrency: {} }),
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucun bien ne vous est encore associé.")).toBeInTheDocument());
  });

  it("affiche un message dédié quand aucun historique n'est disponible", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: dashboard({ revenueByMonth: {} }) });
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucun loyer perçu sur les 6 derniers mois.")).toBeInTheDocument());
  });

  it("affiche une erreur avec un bouton pour réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({ data: dashboard() });
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("Villa Ngor")).toBeInTheDocument());
  });
});
