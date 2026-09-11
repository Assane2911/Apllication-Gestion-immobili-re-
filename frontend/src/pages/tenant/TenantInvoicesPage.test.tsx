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

  it("n'expose plus le mode démo comme moyen de paiement", async () => {
    // Régression : « Mode démo » soldait la facture sans qu'aucun loyer ne
    // soit versé, et déclenchait l'envoi d'une quittance — un document à
    // valeur légale attestant d'un paiement qui n'a pas eu lieu. Le serveur le
    // refuse désormais (voir payment.service.ts) ; il ne doit pas non plus
    // réapparaître ici.
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: [invoice({ status: "PENDING" })] });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Payer" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Payer" }));

    expect(screen.queryByText("🧪 Mode démo")).not.toBeInTheDocument();
    // Les moyens légitimes restent proposés.
    expect(screen.getByText("🌍 PayDunya")).toBeInTheDocument();
  });

  it("paiement en ligne : envoie la bonne requête, affiche la confirmation et recharge la liste", async () => {
    const user = userEvent.setup();
    mockedApi.get
      .mockResolvedValueOnce({ data: [invoice({ status: "PENDING" })] })
      .mockResolvedValueOnce({ data: [invoice({ status: "PAID" })] });
    mockedApi.post.mockResolvedValueOnce({
      data: {
        invoice: invoice({ status: "PAID" }),
        payment: { method: "PAYDUNYA", status: "PAID", message: "Paiement de 500 confirmé." },
      },
    });

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Payer" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Payer" }));
    const paydunyaCard = screen.getByText("🌍 PayDunya").closest("div")!;
    await user.click(within(paydunyaCard).getByRole("button", { name: "Choisir ce moyen" }));

    await waitFor(() => expect(screen.getByText("Paiement de 500 confirmé.")).toBeInTheDocument());
    expect(mockedApi.post).toHaveBeenCalledWith("/invoices/inv-1/pay", {
      method: "PAYDUNYA",
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
