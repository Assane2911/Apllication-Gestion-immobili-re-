import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import AdminSubscriptionsPage from "./AdminSubscriptionsPage";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function pendingTransfer(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-1",
    userId: "mgr-1",
    managerEmail: "agence@test.local",
    plan: "PRO",
    amount: 29,
    billingCycle: "MONTHLY",
    paymentRef: "VIR-2026-001",
    startDate: "2026-06-01T00:00:00.000Z",
    endDate: "2026-07-01T00:00:00.000Z",
    createdAt: "2026-06-15T10:00:00.000Z",
    ...overrides,
  };
}

describe("AdminSubscriptionsPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("affiche les virements en attente avec les informations du gestionnaire", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [pendingTransfer()] });

    render(
      <AuthProvider>
        <CurrencyProvider>
          <MemoryRouter>
            <AdminSubscriptionsPage />
          </MemoryRouter>
        </CurrencyProvider>
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText("agence@test.local")).toBeInTheDocument());
    expect(screen.getByText("Professionnel")).toBeInTheDocument();
    expect(screen.getByText("29 €")).toBeInTheDocument();
    expect(screen.getByText("VIR-2026-001")).toBeInTheDocument();
  });

  it("affiche un message quand aucun virement n'est en attente", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [] });

    render(
      <AuthProvider>
        <CurrencyProvider>
          <MemoryRouter>
            <AdminSubscriptionsPage />
          </MemoryRouter>
        </CurrencyProvider>
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText("Aucun virement en attente")).toBeInTheDocument());
  });

  it("affiche une erreur avec un bouton réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });

    render(
      <AuthProvider>
        <CurrencyProvider>
          <MemoryRouter>
            <AdminSubscriptionsPage />
          </MemoryRouter>
        </CurrencyProvider>
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({ data: [] });
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("Aucun virement en attente")).toBeInTheDocument());
  });

  it("confirme un virement après validation : POST puis retire la ligne de la liste", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: [pendingTransfer()] });
    mockedApi.post.mockResolvedValueOnce({ data: { success: true } });

    render(
      <AuthProvider>
        <CurrencyProvider>
          <MemoryRouter>
            <AdminSubscriptionsPage />
          </MemoryRouter>
        </CurrencyProvider>
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText("agence@test.local")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Confirmer le paiement" }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/admin/subscriptions/sub-1/confirm-bank-transfer"));
    await waitFor(() => expect(screen.queryByText("agence@test.local")).not.toBeInTheDocument());
  });

  it("n'envoie rien si l'administrateur annule la confirmation", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    mockedApi.get.mockResolvedValueOnce({ data: [pendingTransfer()] });

    render(
      <AuthProvider>
        <CurrencyProvider>
          <MemoryRouter>
            <AdminSubscriptionsPage />
          </MemoryRouter>
        </CurrencyProvider>
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText("agence@test.local")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Confirmer le paiement" }));

    expect(window.confirm).toHaveBeenCalled();
    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(screen.getByText("agence@test.local")).toBeInTheDocument();
  });

  it("affiche une alerte si la confirmation échoue côté serveur", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: [pendingTransfer()] });
    mockedApi.post.mockRejectedValueOnce({
      response: { data: { error: "Ce virement a déjà été traité" } },
      isAxiosError: true,
    });

    render(
      <AuthProvider>
        <CurrencyProvider>
          <MemoryRouter>
            <AdminSubscriptionsPage />
          </MemoryRouter>
        </CurrencyProvider>
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText("agence@test.local")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Confirmer le paiement" }));

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith("Ce virement a déjà été traité"));
    // La ligne reste affichée puisque la confirmation a échoué côté serveur.
    expect(screen.getByText("agence@test.local")).toBeInTheDocument();
  });

  /**
   * Régression : une demande de test (ou un virement annoncé mais jamais
   * reçu) n'avait aucune issue propre — la seule action possible était
   * "Confirmer le paiement", ce qui aurait activé à tort un abonnement payant.
   */
  it("rejette un virement après validation : POST puis retire la ligne de la liste", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: [pendingTransfer()] });
    mockedApi.post.mockResolvedValueOnce({ data: { success: true } });

    render(
      <AuthProvider>
        <CurrencyProvider>
          <MemoryRouter>
            <AdminSubscriptionsPage />
          </MemoryRouter>
        </CurrencyProvider>
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText("agence@test.local")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Rejeter" }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/admin/subscriptions/sub-1/reject-bank-transfer"));
    await waitFor(() => expect(screen.queryByText("agence@test.local")).not.toBeInTheDocument());
  });

  it("n'envoie rien si l'administrateur annule le rejet", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    mockedApi.get.mockResolvedValueOnce({ data: [pendingTransfer()] });

    render(
      <AuthProvider>
        <CurrencyProvider>
          <MemoryRouter>
            <AdminSubscriptionsPage />
          </MemoryRouter>
        </CurrencyProvider>
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText("agence@test.local")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Rejeter" }));

    expect(window.confirm).toHaveBeenCalled();
    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(screen.getByText("agence@test.local")).toBeInTheDocument();
  });

  it("affiche une alerte si le rejet échoue côté serveur", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: [pendingTransfer()] });
    mockedApi.post.mockRejectedValueOnce({
      response: { data: { error: "Ce virement a déjà été confirmé : impossible de le rejeter" } },
      isAxiosError: true,
    });

    render(
      <AuthProvider>
        <CurrencyProvider>
          <MemoryRouter>
            <AdminSubscriptionsPage />
          </MemoryRouter>
        </CurrencyProvider>
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText("agence@test.local")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Rejeter" }));

    await waitFor(() =>
      expect(window.alert).toHaveBeenCalledWith("Ce virement a déjà été confirmé : impossible de le rejeter")
    );
    expect(screen.getByText("agence@test.local")).toBeInTheDocument();
  });

  function rendre() {
    return render(
      <AuthProvider>
        <CurrencyProvider>
          <MemoryRouter>
            <AdminSubscriptionsPage />
          </MemoryRouter>
        </CurrencyProvider>
      </AuthProvider>
    );
  }

  it("totalise ce qui reste à encaisser devise par devise, sans jamais les additionner", async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: [
        pendingTransfer({ id: "a", currency: "EUR", amount: 29 }),
        pendingTransfer({ id: "b", currency: "EUR", amount: 39, managerEmail: "b@test.local" }),
        pendingTransfer({ id: "c", currency: "XOF", amount: 15000, managerEmail: "c@test.local" }),
      ],
    });
    rendre();

    expect(await screen.findByText("3 virement(s) en attente")).toBeInTheDocument();
    expect(screen.getByText("À encaisser · 68 €")).toBeInTheDocument();
    expect(screen.getByText(/À encaisser · 15\s?000 FCFA/)).toBeInTheDocument();
  });

  it("signale l'ancienneté de chaque virement et place le plus ancien en tête", async () => {
    const ilYa = (jours: number) => new Date(Date.now() - jours * 86_400_000 - 60_000).toISOString();
    mockedApi.get.mockResolvedValueOnce({
      data: [
        pendingTransfer({ id: "recent", managerEmail: "recent@test.local", createdAt: ilYa(1) }),
        pendingTransfer({ id: "vieux", managerEmail: "vieux@test.local", createdAt: ilYa(6) }),
      ],
    });
    rendre();

    expect(await screen.findByText("depuis 6 jour(s)")).toBeInTheDocument();
    expect(screen.getByText("depuis 1 jour(s)")).toBeInTheDocument();
    const liens = screen.getAllByRole("link").map((l) => l.textContent);
    expect(liens).toEqual(["vieux@test.local", "recent@test.local"]);
  });

  it("relie le virement à la fiche du gestionnaire et permet de copier la référence", async () => {
    const ecrire = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: ecrire }, configurable: true });
    mockedApi.get.mockResolvedValueOnce({ data: [pendingTransfer()] });
    rendre();

    expect(await screen.findByRole("link", { name: "agence@test.local" })).toHaveAttribute("href", "/admin/gestionnaires/mgr-1");
    await userEvent.click(screen.getByRole("button", { name: "Copier la référence VIR-2026-001" }));
    expect(ecrire).toHaveBeenCalledWith("VIR-2026-001");
  });
});
