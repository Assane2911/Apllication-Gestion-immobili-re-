import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { AnnualFiscalSynthesis } from "../../types";
import FiscalPage from "./FiscalPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function synthesis(overrides: Partial<AnnualFiscalSynthesis> = {}): AnnualFiscalSynthesis {
  return {
    year: 2026,
    availableYears: [2026, 2025],
    totalRevenueByCurrency: { EUR: 6000 },
    totalExpensesByCurrency: { EUR: 900 },
    netResultByCurrency: { EUR: 5100 },
    revenueByMonth: { "2026-03": { EUR: 3000 }, "2026-04": { EUR: 3000 } },
    expensesByMonth: { "2026-03": { EUR: 900 } },
    expensesByCategory: { MAINTENANCE: { EUR: 900 } },
    bilanParBien: [
      { propertyId: "prop-1", propertyTitle: "Villa Ngor", currency: "EUR", revenue: 6000, expense: 900, net: 5100 },
    ],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <FiscalPage />
      </CurrencyProvider>
    </AuthProvider>
  );
}

describe("FiscalPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
  });

  it("affiche la synthèse annuelle et le bilan foncier par bien", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: synthesis() });
    renderPage();

    await waitFor(() => expect(screen.getByText("Revenus encaissés")).toBeInTheDocument());
    // "6 000 €" et "5 100 €" apparaissent à la fois dans les cartes de stats
    // et dans la ligne du bilan par bien (même montant, deux endroits).
    expect(screen.getAllByText("6 000 €").length).toBeGreaterThan(0);
    expect(screen.getByText("Charges de l'exercice")).toBeInTheDocument();
    expect(screen.getByText("-900 €")).toBeInTheDocument();
    // "Résultat net" est aussi l'en-tête de colonne du tableau du bilan par bien.
    expect(screen.getAllByText("Résultat net").length).toBeGreaterThan(0);
    expect(screen.getAllByText("5 100 €").length).toBeGreaterThan(0);
    expect(screen.getByText("Villa Ngor")).toBeInTheDocument();
  });

  it("affiche un message dédié quand aucune dépense n'est enregistrée sur l'exercice", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: synthesis({ expensesByCategory: {} }) });
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucune dépense enregistrée sur cet exercice.")).toBeInTheDocument());
  });

  it("affiche un message dédié quand le bilan par bien est vide", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: synthesis({ bilanParBien: [] }) });
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucune écriture pour cet exercice.")).toBeInTheDocument());
  });

  it("affiche une erreur avec un bouton pour réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({ data: synthesis() });
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("Villa Ngor")).toBeInTheDocument());
  });

  it("recharge la synthèse pour l'année sélectionnée dans le menu déroulant", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: synthesis() });
    renderPage();
    await waitFor(() => expect(screen.getByText("Villa Ngor")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({ data: synthesis({ year: 2025, totalRevenueByCurrency: { EUR: 1200 } }) });
    await userEvent.setup().selectOptions(screen.getByLabelText("Exercice"), "2025");

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/fiscal/synthese", { params: { year: 2025 } })
    );
    await waitFor(() => expect(screen.getByText("1 200 €")).toBeInTheDocument());
  });

  it("télécharge le Grand Livre au format CSV pour l'année affichée", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: synthesis() });
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /Télécharger le Grand Livre/ })).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({ data: new Blob(["Grand Livre 2026"]) });
    const createObjectURL = vi.fn().mockReturnValue("blob:fake-grand-livre");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    await userEvent.setup().click(screen.getByRole("button", { name: /Télécharger le Grand Livre/ }));

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/fiscal/grand-livre", {
        params: { year: 2026 },
        responseType: "blob",
      })
    );
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob)));
  });
});
