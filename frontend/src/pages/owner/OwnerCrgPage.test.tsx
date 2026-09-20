import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { CrgSynthesis } from "../../types";
import OwnerCrgPage from "./OwnerCrgPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function crg(overrides: Partial<CrgSynthesis> = {}): CrgSynthesis {
  return {
    ownerId: "owner-1",
    ownerName: "Fatou Diop",
    iban: "FR7630006000011234567890189",
    bic: "AGRIFRPP",
    managementFeeRate: 10,
    month: 9,
    year: 2026,
    properties: [
      {
        propertyId: "prop-1",
        propertyTitle: "Villa Ngor",
        currency: "EUR",
        loyersEncaisses: 1000,
        chargesDeduites: 100,
        commission: 100,
        netAReverser: 800,
      },
    ],
    totalLoyersByCurrency: { EUR: 1000 },
    totalChargesByCurrency: { EUR: 100 },
    totalCommissionByCurrency: { EUR: 100 },
    totalNetByCurrency: { EUR: 800 },
    ...overrides,
  };
}

function renderPage() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <OwnerCrgPage />
      </CurrencyProvider>
    </AuthProvider>
  );
}

describe("OwnerCrgPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
  });

  it("affiche le CRG du propriétaire connecté, avec ses coordonnées bancaires", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: crg() });
    renderPage();

    await waitFor(() => expect(screen.getByText("Villa Ngor")).toBeInTheDocument());
    expect(mockedApi.get).toHaveBeenCalledWith("/crg/mine", { params: { month: 9, year: 2026 } });
    expect(screen.getByText("FR7630006000011234567890189")).toBeInTheDocument();
    expect(screen.getByText("AGRIFRPP")).toBeInTheDocument();
  });

  it("affiche un message dédié quand aucune coordonnée bancaire n'est enregistrée", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: crg({ iban: null, bic: null }) });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Aucune coordonnée bancaire enregistrée — contactez votre agence.")).toBeInTheDocument()
    );
  });

  it("affiche un message dédié quand aucun bien n'est associé", async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: crg({ properties: [], totalLoyersByCurrency: {}, totalChargesByCurrency: {}, totalCommissionByCurrency: {}, totalNetByCurrency: {} }),
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucun bien ne vous est encore associé.")).toBeInTheDocument());
  });

  it("affiche une erreur avec un bouton pour réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({ data: crg() });
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("Villa Ngor")).toBeInTheDocument());
  });

  it("ouvre l'export HTML imprimable de son propre CRG", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: crg() });
    renderPage();
    await waitFor(() => expect(screen.getByText("Villa Ngor")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({ data: "<html><body>CRG</body></html>" });
    await userEvent.setup().click(screen.getByRole("button", { name: /Export HTML imprimable/ }));

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/crg/mine/export?month=9&year=2026", { responseType: "text" })
    );
  });
});
