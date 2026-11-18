import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api/client";
import { AuthProvider } from "./context/AuthContext";
import { CurrencyProvider } from "./context/CurrencyContext";
import ExpensesPage from "./pages/manager/ExpensesPage";
import InvoicesPage from "./pages/manager/InvoicesPage";
import IssuesPage from "./pages/manager/IssuesPage";
import OwnersPage from "./pages/manager/OwnersPage";
import PropertiesPage from "./pages/manager/PropertiesPage";
import TenantsPage from "./pages/manager/TenantsPage";

vi.mock("./api/client", async () => {
  const actual = await vi.importActual<typeof import("./api/client")>("./api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

/**
 * Les listes d'un chiffre en tête (bandeau de chiffres) le faisaient apparaître APRÈS l'arrivée des données, au-dessus de la liste,
 * qu'il repoussait de 100 à 240 px : décalage de mise en page (CLS) de 0,15 à 0,6 mesuré sur ces six pages (seuil « bon » : 0,1).
 * Tant que les données n'ont pas répondu, la place du bandeau est donc réservée (BandeauChiffresSquelette) ; elle est rendue dès
 * que la réponse est arrivée, qu'il y ait ou non des chiffres à montrer.
 */
const PAGES: Array<[string, ComponentType]> = [
  ["factures", InvoicesPage],
  ["incidents", IssuesPage],
  ["dépenses", ExpensesPage],
  ["locataires", TenantsPage],
  ["biens", PropertiesPage],
  ["propriétaires", OwnersPage],
];

const VIDE = { items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 };
const RESUME_VIDE = { totalRevenueByCurrency: {}, totalExpensesByCurrency: {}, netCashFlowByCurrency: {}, expensesByCategory: {}, expenseCount: 0, paidInvoiceCount: 0 };

function rendre(Page: ComponentType) {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <CurrencyProvider>
          <Page />
        </CurrencyProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("listes à bandeau de chiffres : la place du bandeau est réservée pendant le chargement", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
  });

  for (const [nom, Page] of PAGES) {
    it(`${nom} : tant que les données n'ont pas répondu, un squelette tient la place du bandeau`, () => {
      mockedApi.get.mockReturnValue(new Promise(() => {}));
      rendre(Page);
      expect(document.querySelector("[data-squelette-bandeau]")).not.toBeNull();
    });

    it(`${nom} : une fois la réponse arrivée, le squelette disparaît`, async () => {
      mockedApi.get.mockImplementation((url: string) => Promise.resolve({ data: /expenses\/summary/.test(url) ? RESUME_VIDE : VIDE }));
      rendre(Page);
      await waitFor(() => expect(document.querySelector("[data-squelette-bandeau]")).toBeNull());
    });
  }
});
