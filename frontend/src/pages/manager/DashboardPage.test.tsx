import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { DashboardStats } from "../../types";
import DashboardPage from "./DashboardPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function stats(overrides: Partial<DashboardStats> = {}): DashboardStats {
  return {
    totalProperties: 8,
    propertiesByStatus: { AVAILABLE: 3, OCCUPIED: 4, MAINTENANCE: 0 },
    totalTenants: 6,
    activeContracts: 5,
    occupancyRate: 50,
    monthlyRevenueByCurrency: { EUR: 2000 },
    monthlyExpectedByCurrency: { EUR: 2500 },
    openIssues: 2,
    lateInvoices: 1,
    revenueByMonth: { "2026-08": { EUR: 2000 } },
    expensesByMonth: { "2026-08": { EUR: 300 } },
    ...overrides,
  };
}

function renderPage() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <DashboardPage />
      </CurrencyProvider>
    </AuthProvider>
  );
}

describe("DashboardPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
  });

  it("affiche les indicateurs clés une fois les statistiques chargées", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: stats() });
    renderPage();

    await waitFor(() => expect(screen.getByText("Biens immobiliers")).toBeInTheDocument());
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("2 000 €")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("affiche un message dédié quand aucun bien n'est enregistré", async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: stats({ propertiesByStatus: { AVAILABLE: 0, OCCUPIED: 0, MAINTENANCE: 0 }, totalProperties: 0 }),
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucun bien enregistré pour l'instant.")).toBeInTheDocument());
  });

  it("affiche une erreur avec un bouton pour recharger la page", async () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadSpy },
      writable: true,
    });

    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());
    expect(screen.getByText("Erreur de chargement du tableau de bord")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    expect(reloadSpy).toHaveBeenCalled();
  });
});
