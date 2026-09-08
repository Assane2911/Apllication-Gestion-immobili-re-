import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { Expense, PaginatedResponse, Property } from "../../types";
import ExpensesPage from "./ExpensesPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function property(overrides: Partial<Property> = {}): Property {
  return {
    id: "prop-1",
    title: "Studio Centre-ville",
    address: "1 rue de la Paix",
    surface: 30,
    rent: 500,
    currency: "EUR",
    status: "OCCUPIED",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "exp-1",
    propertyId: "prop-1",
    category: "MAINTENANCE",
    title: "Remplacement chauffe-eau",
    amount: 250,
    currency: "EUR",
    expenseDate: "2026-06-15T00:00:00.000Z",
    notes: "Artisan plombier",
    property: { title: "Studio Centre-ville" } as unknown as Property,
    createdAt: "2026-06-15T00:00:00.000Z",
    ...overrides,
  };
}

function summary(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    totalRevenue: 5000,
    totalExpenses: 250,
    netCashFlow: 4750,
    expensesByCategory: { MAINTENANCE: 250 },
    expenseCount: 1,
    paidInvoiceCount: 10,
    ...overrides,
  };
}

function paginated<T>(items: T[]): { data: PaginatedResponse<T> } {
  return { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 } };
}

// Reproduit l'ordre fixe des 3 appels du Promise.all de loadData() :
// /properties, /expenses/summary, /expenses.
function queueLoad(properties: Property[], summaryData: ReturnType<typeof summary>, expenses: Expense[]) {
  mockedApi.get.mockResolvedValueOnce(paginated(properties));
  mockedApi.get.mockResolvedValueOnce({ data: summaryData });
  mockedApi.get.mockResolvedValueOnce(paginated(expenses));
}

function renderPage() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <ExpensesPage />
      </CurrencyProvider>
    </AuthProvider>
  );
}

describe("ExpensesPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    mockedApi.delete.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("affiche les indicateurs financiers (revenus, dépenses, cash-flow net)", async () => {
    queueLoad([property()], summary(), [expense()]);
    renderPage();

    await waitFor(() => expect(screen.getByText("Loyers Encaissés")).toBeInTheDocument());
    expect(screen.getByText("5 000 €")).toBeInTheDocument();
    expect(screen.getByText("Total Dépenses & Travaux")).toBeInTheDocument();
    expect(screen.getByText("250 €")).toBeInTheDocument();
    expect(screen.getByText("Cash-Flow Net Réel")).toBeInTheDocument();
    expect(screen.getByText("4 750 €")).toBeInTheDocument();
    expect(screen.getByText("Bénéfice net positif")).toBeInTheDocument();
  });

  it("affiche la liste des dépenses avec catégorie et montant", async () => {
    queueLoad([property()], summary(), [expense()]);
    renderPage();

    await waitFor(() => expect(screen.getByText("Remplacement chauffe-eau")).toBeInTheDocument());
    expect(screen.getByText("🛠️ Entretien & Travaux")).toBeInTheDocument();
    expect(screen.getByText("-250 €")).toBeInTheDocument();
    expect(screen.getByText("Artisan plombier")).toBeInTheDocument();
  });

  it("affiche un message quand il n'y a aucune dépense", async () => {
    queueLoad([property()], summary({ totalExpenses: 0, expenseCount: 0, netCashFlow: 5000 }), []);
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucune dépense enregistrée pour le moment.")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Export Comptable CSV/ }));
    expect(window.alert).toHaveBeenCalledWith("Aucune dépense à exporter.");
  });

  it("le filtre par bien recharge la liste avec le bon paramètre", async () => {
    const user = userEvent.setup();
    queueLoad([property({ id: "prop-1" })], summary(), [expense({ id: "exp-1" })]);
    queueLoad([property({ id: "prop-1" })], summary(), [expense({ id: "exp-1" })]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Remplacement chauffe-eau")).toBeInTheDocument());

    const filterSelect = screen.getAllByRole("combobox")[0];
    await user.selectOptions(filterSelect, "prop-1");

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenCalledWith("/expenses", {
        params: { page: 1, pageSize: 20, propertyId: "prop-1" },
      })
    );
  });

  it("enregistre une nouvelle dépense : convertit le montant en nombre et recharge", async () => {
    const user = userEvent.setup();
    queueLoad([property({ id: "prop-1" })], summary(), []);
    mockedApi.post.mockResolvedValueOnce({ data: { id: "exp-new" } });
    queueLoad([property({ id: "prop-1" })], summary(), [expense({ id: "exp-new" })]);

    const { container } = renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /Enregistrer une dépense/ })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Enregistrer une dépense/ }));

    const selects = screen.getAllByRole("combobox");
    // Le 1er combobox est le filtre par bien (hors modale) : les 2 suivants
    // sont ceux de la modale (bien concerné, catégorie).
    await user.selectOptions(selects[1], "prop-1");
    await user.selectOptions(selects[2], "TAX");

    // Il y a déjà 2 inputs date pour le "rapport financier complet" (from/to)
    // rendus avant la modale : on cible le DERNIER input date du DOM, celui
    // de la modale (date de la facture de la dépense).
    const dateInputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[dateInputs.length - 1], { target: { value: "2026-07-01" } });

    await user.type(screen.getByPlaceholderText("Ex: Remplacement chauffe-eau"), "Taxe foncière 2026");
    // input[type=number] : fireEvent.change plutôt que user.type, plus fiable
    // pour saisir une valeur décimale caractère par caractère sous jsdom.
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "1200.50" } });

    await user.click(screen.getByRole("button", { name: "Enregistrer la dépense" }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/expenses", {
        propertyId: "prop-1",
        category: "TAX",
        title: "Taxe foncière 2026",
        amount: 1200.5,
        expenseDate: "2026-07-01",
        notes: "",
      })
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "Enregistrer la dépense" })).not.toBeInTheDocument());
  });

  it("supprime une dépense après confirmation", async () => {
    const user = userEvent.setup();
    queueLoad([property()], summary(), [expense({ id: "exp-1" })]);
    mockedApi.delete.mockResolvedValueOnce({ data: {} });
    queueLoad([property()], summary({ totalExpenses: 0, expenseCount: 0 }), []);

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Supprimer" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/expenses/exp-1"));
  });

  it("exporte le CSV des dépenses affichées", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn().mockReturnValue("blob:fake-url");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    queueLoad([property()], summary(), [expense()]);
    renderPage();
    await waitFor(() => expect(screen.getByText("Remplacement chauffe-eau")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Export Comptable CSV/ }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
  });

  it("génère le rapport financier complet sur la période sélectionnée", async () => {
    const user = userEvent.setup();
    URL.createObjectURL = vi.fn().mockReturnValue("blob:fake-report");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    queueLoad([property()], summary(), [expense()]);
    mockedApi.get.mockResolvedValueOnce({ data: new Blob(["date;montant"]) });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /Générer le rapport/ })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Générer le rapport/ }));

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenCalledWith("/expenses/export", {
        params: { from: expect.any(String), to: expect.any(String) },
        responseType: "blob",
      })
    );
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob)));
  });

  it("affiche une erreur de chargement avec un bouton réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    queueLoad([property()], summary(), [expense()]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("Remplacement chauffe-eau")).toBeInTheDocument());
  });
});
