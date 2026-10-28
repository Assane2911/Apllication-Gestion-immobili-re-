import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { DashboardStats } from "../../types";
import DashboardPage from "./DashboardPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

// Le vrai graphique (recharts) ne dessine rien d'exploitable sous jsdom : on le remplace par un composant qui
// expose les mois qu'il reçoit, pour vérifier ce que la page lui donne à tracer.
vi.mock("../../components/graphiques/graphiquesALaDemande", () => ({
  GraphiqueRevenusDepenses: ({ data }: { data: Array<{ month: string; revenue: number; expense: number }> }) => (
    <ul aria-label="mois du graphique">
      {data.map((d) => (
        <li key={d.month}>{`${d.month}|${d.revenue}|${d.expense}`}</li>
      ))}
    </ul>
  ),
  GraphiqueParc: () => <div />,
}));

const mockedApi = vi.mocked(api, { deep: true });

function stats(overrides: Partial<DashboardStats> = {}): DashboardStats {
  return {
    totalProperties: 1,
    propertiesByStatus: { AVAILABLE: 0, OCCUPIED: 1, MAINTENANCE: 0 },
    totalTenants: 1,
    activeContracts: 1,
    occupancyRate: 100,
    monthlyRevenueByCurrency: { EUR: 2000 },
    monthlyExpectedByCurrency: { EUR: 2000 },
    openIssues: 0,
    lateInvoices: 0,
    revenueByMonth: {},
    expensesByMonth: {},
    ...overrides,
  };
}

function renderPage() {
  // Dans un routeur, comme en production : le guide de démarrage contient des liens.
  return render(
    <MemoryRouter>
      <AuthProvider>
        <CurrencyProvider>
          <DashboardPage />
        </CurrencyProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe("DashboardPage — axe des mois", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 18));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Régression : seuls les mois avec un encaissement ou une dépense figuraient sur l'axe, étiquetés par leur clé
   * technique (« 2026-08 »). Un mois sans aucun loyer encaissé — celui qu'on cherche à repérer — disparaissait, et
   * les barres voisines semblaient se suivre.
   */
  it("trace les six derniers mois, y compris ceux sans encaissement, avec des libellés lisibles", async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: stats({ revenueByMonth: { "2026-08": { EUR: 2000 } }, expensesByMonth: { "2026-10": { EUR: 300 } } }),
    });
    renderPage();

    await waitFor(() => expect(screen.getByLabelText("mois du graphique")).toBeInTheDocument());
    const lignes = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(lignes).toHaveLength(6);
    // Aucune clé technique à l'écran.
    expect(lignes.some((l) => /\d{4}-\d{2}/.test(l))).toBe(false);
    // Un mois vide est présent, à zéro.
    expect(lignes.filter((l) => l.endsWith("|0|0"))).toHaveLength(4);
    // Les montants sont sur le bon mois (août : 2000 de revenus ; octobre : 300 de dépenses).
    expect(lignes.find((l) => l.endsWith("|2000|0"))?.toLowerCase()).toMatch(/août|aout/);
    expect(lignes.find((l) => l.endsWith("|0|300"))?.toLowerCase()).toContain("oct");
  });
});
