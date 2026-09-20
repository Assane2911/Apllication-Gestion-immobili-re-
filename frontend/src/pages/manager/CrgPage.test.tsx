import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { CrgSynthesis } from "../../types";
import CrgPage from "./CrgPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function crg(overrides: Partial<CrgSynthesis> = {}): CrgSynthesis {
  return {
    ownerId: "owner-1",
    ownerName: "Fatou Diop",
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
        <MemoryRouter initialEntries={["/proprietaires/owner-1/crg"]}>
          <Routes>
            <Route path="/proprietaires/:ownerId/crg" element={<CrgPage />} />
          </Routes>
        </MemoryRouter>
      </CurrencyProvider>
    </AuthProvider>
  );
}

describe("CrgPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
  });

  it("affiche la synthèse CRG du propriétaire, commission et net à reverser inclus", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: crg() });
    renderPage();

    await waitFor(() => expect(screen.getByText("Villa Ngor")).toBeInTheDocument());
    expect(mockedApi.get).toHaveBeenCalledWith("/crg/owner-1", { params: { month: 9, year: 2026 } });
    expect(screen.getByText(/Fatou Diop/)).toBeInTheDocument();
    expect(screen.getAllByText("1 000 €").length).toBeGreaterThan(0);
    // "-100 €" apparaît deux fois (charges déduites ET commission, toutes deux à 100).
    expect(screen.getAllByText("-100 €").length).toBe(2);
    expect(screen.getAllByText("800 €").length).toBeGreaterThan(0);
  });

  it("affiche un message dédié quand le propriétaire n'a aucun bien", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: crg({ properties: [], totalLoyersByCurrency: {}, totalChargesByCurrency: {}, totalCommissionByCurrency: {}, totalNetByCurrency: {} }) });
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucun bien rattaché à ce propriétaire.")).toBeInTheDocument());
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

  it("recharge le CRG pour le mois sélectionné dans le menu déroulant", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: crg() });
    renderPage();
    await waitFor(() => expect(screen.getByText("Villa Ngor")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({ data: crg({ month: 8, totalLoyersByCurrency: { EUR: 300 } }) });
    await userEvent.setup().selectOptions(screen.getByLabelText("Mois"), "8");

    await waitFor(() => expect(mockedApi.get).toHaveBeenLastCalledWith("/crg/owner-1", { params: { month: 8, year: 2026 } }));
  });

  it("ouvre l'export HTML imprimable via la modale de document", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: crg() });
    renderPage();
    await waitFor(() => expect(screen.getByText("Villa Ngor")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({ data: "<html><body>CRG</body></html>" });
    await userEvent.setup().click(screen.getByRole("button", { name: /Export HTML imprimable/ }));

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/crg/owner-1/export?month=9&year=2026", { responseType: "text" })
    );
  });
});
