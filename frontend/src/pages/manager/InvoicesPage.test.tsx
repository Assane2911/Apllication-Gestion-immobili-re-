import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { Invoice, PaginatedResponse } from "../../types";
import InvoicesPage from "./InvoicesPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    contractId: "c1",
    periodMonth: 6,
    periodYear: 2026,
    amount: 500,
    currency: "EUR",
    dueDate: "2026-06-20T00:00:00.000Z",
    status: "PENDING",
    contract: {
      id: "c1",
      property: { title: "Studio Centre-ville" },
      tenant: { firstName: "Awa", lastName: "Diallo", email: "awa@example.com" },
    } as unknown as Invoice["contract"],
    ...overrides,
  };
}

function paginated(items: Invoice[], overrides: Partial<PaginatedResponse<Invoice>> = {}): {
  data: PaginatedResponse<Invoice>;
} {
  return {
    data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1, ...overrides },
  };
}

// Le <select> de filtre contient aussi des <option> avec le même libellé que les badges de
// statut (ex: "En attente", "Réglée") — on les exclut pour ne compter que les badges affichés.
function countNonOptionMatches(text: string | RegExp) {
  return screen.getAllByText(text).filter((el) => el.tagName !== "OPTION").length;
}

function renderPage() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <InvoicesPage />
      </CurrencyProvider>
    </AuthProvider>
  );
}

describe("InvoicesPage (manager)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("affiche la liste des factures avec montant et statut (tableau + cartes mobiles)", async () => {
    mockedApi.get.mockResolvedValueOnce(
      paginated([
        invoice({ id: "inv-pending", status: "PENDING" }),
        invoice({ id: "inv-paid", status: "PAID", amount: 650 }),
      ])
    );

    renderPage();

    await waitFor(() => expect(screen.getAllByText(/Studio Centre-ville/)).toHaveLength(4));
    expect(screen.getAllByText("Awa Diallo")).toHaveLength(4);
    expect(countNonOptionMatches("En attente")).toBe(2);
    expect(countNonOptionMatches("Réglée")).toBe(2);
    expect(screen.getAllByText("650 €")).toHaveLength(2);
    // Le bouton "Marquer réglée" n'apparaît que pour la facture PENDING (une fois par vue = 2)
    expect(screen.getAllByRole("button", { name: "Marquer réglée" })).toHaveLength(2);
    // Le bouton "Quittance PDF" n'apparaît que pour la facture PAID (une fois par vue = 2)
    expect(screen.getAllByRole("button", { name: /Quittance PDF/ })).toHaveLength(2);
  });

  it("affiche un message quand il n'y a aucune facture pour le filtre", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([]));
    renderPage();
    await waitFor(() => expect(screen.getAllByText("Aucune facture pour ce filtre").length).toBeGreaterThan(0));
  });

  it("affiche une erreur si le chargement échoue", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());
  });

  it("changer le filtre de statut recharge la liste avec le bon paramètre", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([invoice({ status: "PENDING" })]));
    mockedApi.get.mockResolvedValueOnce(paginated([invoice({ status: "LATE" })]));

    renderPage();
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledTimes(1));
    expect(mockedApi.get).toHaveBeenNthCalledWith(1, "/invoices", { params: { page: 1, pageSize: 20 } });

    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "LATE");

    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledTimes(2));
    expect(mockedApi.get).toHaveBeenNthCalledWith(2, "/invoices", {
      params: { page: 1, pageSize: 20, status: "LATE" },
    });
    await waitFor(() => expect(countNonOptionMatches("En retard")).toBeGreaterThan(0));
  });

  it("marquer une facture réglée : envoie la requête puis recharge la liste", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([invoice({ id: "inv-1", status: "PENDING" })]));
    mockedApi.get.mockResolvedValueOnce(paginated([invoice({ id: "inv-1", status: "PAID" })]));
    mockedApi.post.mockResolvedValueOnce({ data: { invoice: invoice({ status: "PAID" }) } });

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Marquer réglée" }).length).toBeGreaterThan(0));

    const buttons = screen.getAllByRole("button", { name: "Marquer réglée" });
    await user.click(buttons[0]);

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/invoices/inv-1/mark-paid", { paymentMethod: "BANK_TRANSFER" })
    );
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledTimes(2));
  });

  it("relancer une facture individuellement : envoie la requête et affiche le message de confirmation", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValue(paginated([invoice({ id: "inv-1", status: "PENDING" })]));
    mockedApi.post.mockResolvedValueOnce({ data: { message: "Relance envoyée à Awa Diallo." } });

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Relancer/ }).length).toBeGreaterThan(0));

    const buttons = screen.getAllByRole("button", { name: /Relancer/ });
    await user.click(buttons[0]);

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/invoices/inv-1/send-reminder"));
    await waitFor(() => expect(screen.getByText(/Relance envoyée à Awa Diallo\./)).toBeInTheDocument());
  });

  it("envoyer les alertes mensuelles : demande confirmation puis envoie la requête", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValue(paginated([invoice({ id: "inv-1", status: "PENDING" })]));
    mockedApi.post.mockResolvedValueOnce({ data: { message: "12 avis envoyés.", sent: 12 } });

    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Envoyer alertes du 1er du mois/ })).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: /Envoyer alertes du 1er du mois/ }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/invoices/send-monthly-reminders"));
    await waitFor(() => expect(screen.getByText(/12 avis envoyés\./)).toBeInTheDocument());
  });

  it("n'envoie pas les alertes mensuelles si la confirmation est annulée", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    mockedApi.get.mockResolvedValue(paginated([invoice({ id: "inv-1", status: "PENDING" })]));

    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Envoyer alertes du 1er du mois/ })).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: /Envoyer alertes du 1er du mois/ }));

    expect(window.confirm).toHaveBeenCalled();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });
});
