import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function renderPage(adresse = "/proprietaires/owner-1/crg") {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <MemoryRouter initialEntries={[adresse]}>
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
    // Les fixtures ci-dessus supposent "mois courant = septembre 2026" (month: 9) ;
    // sans horloge figée, ce test casse dès que la date réelle d'exécution dépasse
    // septembre 2026 (CrgPage.tsx calcule le mois par défaut via `new Date()`).
    vi.setSystemTime(new Date(2026, 8, 15));
  });

  afterEach(() => {
    vi.useRealTimers();
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
      expect(mockedApi.get).toHaveBeenLastCalledWith("/crg/owner-1/export?month=9&year=2026", {
        responseType: "text",
        signal: expect.anything(),
      })
    );
  });

  it("ouvre le relevé annuel de l'année choisie, pas du mois", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: crg() });
    renderPage();
    await waitFor(() => expect(screen.getByText("Villa Ngor")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({ data: "<html><body>Relevé</body></html>" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Relevé annuel 2026" }));

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/crg/owner-1/annual/export?year=2026", {
        responseType: "text",
        signal: expect.anything(),
      })
    );
  });

  it("s'ouvre sur le mois indiqué dans l'adresse (lien « Reverser » de la page des propriétaires)", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: crg({ month: 9, year: 2025 }) });
    renderPage("/proprietaires/owner-1/crg?month=9&year=2025");
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith("/crg/owner-1", { params: { month: 9, year: 2025 } }));
  });

  it("une charge ou une commission nulle s'affiche « 0 € », jamais « -0 € »", async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: crg({
        properties: [{ propertyId: "prop-1", propertyTitle: "Villa Ngor", currency: "EUR", loyersEncaisses: 1000, chargesDeduites: 0, commission: 0, netAReverser: 1000 }],
        totalChargesByCurrency: { EUR: 0 },
        totalCommissionByCurrency: { EUR: 0 },
        totalNetByCurrency: { EUR: 1000 },
      }),
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Villa Ngor")).toBeInTheDocument());
    expect(screen.queryByText(/-0\s?€/)).toBeNull();
    expect(screen.queryAllByText(/^-0/)).toHaveLength(0);
  });

  it("passe au mois voisin avec les flèches, d'une année à l'autre, et revient au mois en cours", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValue({ data: crg() });
    renderPage("/proprietaires/owner-1/crg?month=1&year=2026");
    await waitFor(() => expect(screen.getByText("Villa Ngor")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Mois précédent" }));
    await waitFor(() => expect(mockedApi.get).toHaveBeenLastCalledWith("/crg/owner-1", { params: { month: 12, year: 2025 } }));

    await user.click(screen.getByRole("button", { name: "Mois suivant" }));
    await waitFor(() => expect(mockedApi.get).toHaveBeenLastCalledWith("/crg/owner-1", { params: { month: 1, year: 2026 } }));

    await user.click(screen.getByRole("button", { name: "Mois en cours" }));
    await waitFor(() => expect(mockedApi.get).toHaveBeenLastCalledWith("/crg/owner-1", { params: { month: 9, year: 2026 } }));
    // Sur le mois en cours, le raccourci est inutile.
    expect(screen.getByRole("button", { name: "Mois en cours" })).toBeDisabled();
  });

  it("présente le décompte en soustraction et la répartition des loyers en pourcentages", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: crg() });
    renderPage();

    const decompte = within(await screen.findByRole("region", { name: "Décompte du mois" }));
    expect(decompte.getByText("Loyers encaissés")).toBeInTheDocument();
    expect(decompte.getByText("Net à reverser")).toBeInTheDocument();
    expect(decompte.getByText("Net · 80 %")).toBeInTheDocument();
    expect(decompte.getByText("Commission · 10 %")).toBeInTheDocument();
    expect(decompte.getByText("Charges · 10 %")).toBeInTheDocument();
  });

  it("ne mélange jamais deux devises dans la même barre de répartition", async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: crg({
        totalLoyersByCurrency: { EUR: 1000, XOF: 500000 },
        totalChargesByCurrency: { EUR: 100, XOF: 0 },
        totalCommissionByCurrency: { EUR: 100, XOF: 50000 },
        totalNetByCurrency: { EUR: 800, XOF: 450000 },
      }),
    });
    renderPage();

    const decompte = within(await screen.findByRole("region", { name: "Décompte du mois" }));
    expect(decompte.queryByText(/Net · \d+ %/)).not.toBeInTheDocument();
  });

  it("indique où en est le reversement du mois", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: crg({ resteAReverserByCurrency: { EUR: 300 }, totalReverseByCurrency: { EUR: 500 } }) });
    const { unmount } = renderPage();
    expect(await screen.findByText("Reversé en partie")).toBeInTheDocument();
    unmount();

    mockedApi.get.mockResolvedValueOnce({ data: crg({ resteAReverserByCurrency: { EUR: 0 }, totalReverseByCurrency: { EUR: 800 } }) });
    renderPage();
    expect(await screen.findByText("Reversé en totalité")).toBeInTheDocument();
  });

  it("copie un récapitulatif en texte brut, prêt à coller dans un message", async () => {
    const user = userEvent.setup();
    const ecrire = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: ecrire }, configurable: true });
    mockedApi.get.mockResolvedValueOnce({ data: crg() });
    renderPage();
    await waitFor(() => expect(screen.getByText("Villa Ngor")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Copier le récapitulatif" }));

    expect(ecrire).toHaveBeenCalledTimes(1);
    const texte = ecrire.mock.calls[0][0] as string;
    expect(texte).toContain("Fatou Diop");
    expect(texte).toContain("Net à reverser : 800 €");
  });
});
