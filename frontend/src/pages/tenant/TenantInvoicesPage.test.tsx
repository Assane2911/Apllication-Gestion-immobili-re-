import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { Invoice } from "../../types";
import TenantInvoicesPage from "./TenantInvoicesPage";

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
    contract: { id: "c1", property: { title: "Studio Centre-ville" } } as unknown as Invoice["contract"],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <TenantInvoicesPage />
      </CurrencyProvider>
    </AuthProvider>
  );
}

describe("TenantInvoicesPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
  });

  it("affiche la liste des factures avec montant, échéance et statut", async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: [
        invoice({ id: "inv-pending", status: "PENDING" }),
        invoice({ id: "inv-paid", status: "PAID", amount: 650 }),
      ],
    });

    renderPage();

    await waitFor(() => expect(screen.getAllByText(/Studio Centre-ville/)).toHaveLength(2));
    expect(screen.getByText("En attente")).toBeInTheDocument();
    expect(screen.getByText("Réglée")).toBeInTheDocument();
    expect(screen.getByText("650 €")).toBeInTheDocument();
    // Une seule facture (PENDING) est payable ; l'autre (PAID) propose la quittance.
    expect(screen.getAllByRole("button", { name: "Payer" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Ma Quittance PDF/ })).toBeInTheDocument();
  });

  it("affiche un message quand il n'y a aucune facture", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText("Aucune facture pour le moment")).toBeInTheDocument());
  });

  it("affiche une erreur si le chargement des factures échoue", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Authentification requise" } },
      isAxiosError: true,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Authentification requise")).toBeInTheDocument());
  });

  it("paiement en mode démo : envoie la bonne requête, affiche la confirmation et recharge la liste", async () => {
    const user = userEvent.setup();
    mockedApi.get
      .mockResolvedValueOnce({ data: [invoice({ status: "PENDING" })] })
      .mockResolvedValueOnce({ data: [invoice({ status: "PAID" })] });
    mockedApi.post.mockResolvedValueOnce({
      data: {
        invoice: invoice({ status: "PAID" }),
        payment: { method: "DEMO", status: "PAID", message: "Paiement démo de 500 confirmé instantanément." },
      },
    });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Payer" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Payer" }));
    const demoCard = screen.getByText("🧪 Mode démo").closest("div")!;
    await user.click(within(demoCard).getByRole("button", { name: "Choisir ce moyen" }));

    await waitFor(() =>
      expect(screen.getByText("Paiement démo de 500 confirmé instantanément.")).toBeInTheDocument()
    );
    expect(mockedApi.post).toHaveBeenCalledWith("/invoices/inv-1/pay", {
      method: "DEMO",
      bankReference: undefined,
    });
    expect(mockedApi.get).toHaveBeenCalledTimes(2); // chargement initial + rechargement après paiement
  });

  it("virement bancaire : transmet la référence saisie", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: [invoice({ status: "PENDING" })] });
    mockedApi.post.mockResolvedValueOnce({
      data: {
        invoice: invoice({ status: "PENDING" }),
        payment: { method: "BANK_TRANSFER", status: "PENDING_VALIDATION", message: "Virement déclaré." },
      },
    });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Payer" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Payer" }));

    const bankCard = screen.getByText("🏦 Virement bancaire").closest("div")!;
    await user.type(within(bankCard).getByPlaceholderText("Référence du virement"), "VIR-2026-06-001");
    await user.click(within(bankCard).getByRole("button", { name: "Choisir ce moyen" }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/invoices/inv-1/pay", {
        method: "BANK_TRANSFER",
        bankReference: "VIR-2026-06-001",
      })
    );
  });

  it("redirige vers l'URL PayDunya quand le paiement nécessite une action (REQUIRES_ACTION)", async () => {
    const user = userEvent.setup();
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignSpy },
      writable: true,
    });

    mockedApi.get.mockResolvedValueOnce({ data: [invoice({ status: "PENDING" })] });
    mockedApi.post.mockResolvedValueOnce({
      data: {
        payment: { method: "PAYDUNYA", status: "REQUIRES_ACTION", redirectUrl: "https://paydunya.example/checkout" },
      },
    });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Payer" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Payer" }));

    const paydunyaCard = screen.getByText("🌍 PayDunya").closest("div")!;
    await user.click(within(paydunyaCard).getByRole("button", { name: "Choisir ce moyen" }));

    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith("https://paydunya.example/checkout"));
  });
});
