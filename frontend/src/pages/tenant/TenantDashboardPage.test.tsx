import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { Contract, Invoice } from "../../types";
import TenantDashboardPage from "./TenantDashboardPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    contractId: "c1",
    periodMonth: 8,
    periodYear: 2026,
    amount: 500,
    currency: "EUR",
    dueDate: "2026-08-05T00:00:00.000Z",
    status: "PENDING",
    ...overrides,
  };
}

function contract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: "c1",
    propertyId: "prop-1",
    tenantId: "ten-1",
    rent: 500,
    deposit: 1000,
    currency: "EUR",
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-12-31T00:00:00.000Z",
    status: "ACTIVE",
    signedByTenantAt: null,
    property: { id: "prop-1", title: "Studio Centre-ville", address: "1 rue de la Paix" } as Contract["property"],
    invoices: [],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <CurrencyProvider>
          <TenantDashboardPage />
        </CurrencyProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe("TenantDashboardPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
  });

  it("affiche le logement, le loyer et les dates du bail", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [contract()] });
    renderPage();

    await waitFor(() => expect(screen.getByText("Studio Centre-ville")).toBeInTheDocument());
    expect(screen.getByText("1 rue de la Paix")).toBeInTheDocument();
    expect(screen.getByText("500 €")).toBeInTheDocument();
    expect(screen.getByText("1 000 €")).toBeInTheDocument();
  });

  it("propose de signer le bail tant qu'il n'est pas signé, puis affiche la date de signature", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [contract({ signedByTenantAt: null })] });
    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: /Signer mon bail/ })).toBeInTheDocument());
    expect(screen.getByText("En attente de votre signature numérique")).toBeInTheDocument();
  });

  it("affiche la date de signature une fois le bail signé", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [contract({ signedByTenantAt: "2026-02-01T00:00:00.000Z" })] });
    renderPage();

    await waitFor(() => expect(screen.getByText(/Signé par vous le/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Signer mon bail/ })).not.toBeInTheDocument();
  });

  it("alerte sur les mensualités impayées avec un lien vers le paiement", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [contract({ invoices: [invoice({ status: "PENDING" })] })] });
    renderPage();

    await waitFor(() => expect(screen.getByText(/mensualité\(s\) de loyer en attente/)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Régler maintenant →" })).toHaveAttribute("href", "/portail/paiements");
  });

  it("affiche un message dédié quand aucun contrat n'est associé", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [] });
    renderPage();

    await waitFor(() =>
      expect(
        screen.getByText("Aucun contrat de location n'est associé à votre compte pour le moment.")
      ).toBeInTheDocument()
    );
  });

  it("affiche une erreur avec un bouton pour réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({ data: [contract()] });
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("Studio Centre-ville")).toBeInTheDocument());
  });
});
