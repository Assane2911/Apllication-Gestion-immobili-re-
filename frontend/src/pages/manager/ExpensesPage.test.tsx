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
    totalRevenueByCurrency: { EUR: 5000 },
    totalExpensesByCurrency: { EUR: 250 },
    netCashFlowByCurrency: { EUR: 4750 },
    expensesByCategory: { MAINTENANCE: { EUR: 250 } },
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

  /**
   * Régression : le résumé financier additionnait invoice.amount/expense.amount
   * à travers toutes les devises en un seul total sans signification. Chaque
   * indicateur doit désormais afficher un montant par devise (voir
   * formatByCurrency), comme le tableau de bord le fait déjà.
   */
  it("affiche chaque indicateur financier ventilé par devise plutôt qu'en un seul total mélangé", async () => {
    queueLoad(
      [property()],
      summary({
        totalRevenueByCurrency: { EUR: 5000, XOF: 500000 },
        totalExpensesByCurrency: { EUR: 250 },
        netCashFlowByCurrency: { EUR: 4750, XOF: 500000 },
      }),
      [expense()]
    );
    renderPage();

    await waitFor(() => expect(screen.getByText("Loyers Encaissés")).toBeInTheDocument());
    expect(screen.getByText("5 000 € + 500 000 FCFA")).toBeInTheDocument();
    expect(screen.getByText("4 750 € + 500 000 FCFA")).toBeInTheDocument();
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
    queueLoad(
      [property()],
      summary({ totalExpensesByCurrency: { EUR: 0 }, expenseCount: 0, netCashFlowByCurrency: { EUR: 5000 } }),
      []
    );
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
    queueLoad([property()], summary({ totalExpensesByCurrency: { EUR: 0 }, expenseCount: 0 }), []);

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Supprimer" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/expenses/exp-1"));
  });

  /**
   * L'export sérialisait la PAGE affichée. Le gestionnaire lisait « 147 lignes
   * de dépense » juste au-dessus du bouton, cliquait sur « Export Comptable
   * CSV », obtenait vingt lignes sans le moindre avertissement, et
   * transmettait le fichier à son comptable.
   */
  it("exporte toutes les dépenses du filtre, pas seulement la page affichée", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn().mockReturnValue("blob:fake-url");
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    // La page n'en montre qu'une, mais le serveur en compte deux.
    const visible = expense();
    const horsPage = expense({ id: "exp-2", title: "Ravalement de façade" });
    mockedApi.get.mockResolvedValueOnce(paginated([property()]));
    mockedApi.get.mockResolvedValueOnce({ data: summary() });
    mockedApi.get.mockResolvedValueOnce({
      data: { items: [visible], page: 1, pageSize: 1, total: 2, totalPages: 2 },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Remplacement chauffe-eau")).toBeInTheDocument());

    // Ce que l'export va chercher lui-même.
    mockedApi.get.mockResolvedValueOnce(paginated([visible, horsPage]));

    await user.click(screen.getByRole("button", { name: /Export Comptable CSV/ }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    const contenu = await blob.text();
    expect(contenu).toContain("Remplacement chauffe-eau");
    expect(contenu).toContain("Ravalement de façade");
    expect(clickSpy).toHaveBeenCalledTimes(1);
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

  it("exprime un total nul dans la devise des autres tuiles", async () => {
    // Le symptôme rapporté : « Loyers encaissés 35 000 FCFA » à côté de
    // « Total dépenses 0 FG ». Le total vide n'ayant aucune devise, il
    // retombait sur la devise d'AFFICHAGE du gestionnaire — ici le franc
    // guinéen — alors que les deux autres chiffres parlaient celle des
    // factures. Trois chiffres de la même page, deux monnaies.
    mockedApi.get.mockResolvedValueOnce(paginated([property()]));
    mockedApi.get.mockResolvedValueOnce({
      data: {
        totalRevenueByCurrency: { XOF: 35000 },
        totalExpensesByCurrency: {},
        netCashFlowByCurrency: { XOF: 35000 },
        expensesByCategory: {},
        expenseCount: 0,
      },
    });
    mockedApi.get.mockResolvedValueOnce(paginated([]));

    renderPage();

    await waitFor(() => expect(screen.getAllByText(/35\s*000\s*FCFA/).length).toBeGreaterThan(0));
    expect(screen.getByText(/^0\s*FCFA$/)).toBeInTheDocument();
    expect(screen.queryByText(/FG/)).not.toBeInTheDocument();
  });
});
