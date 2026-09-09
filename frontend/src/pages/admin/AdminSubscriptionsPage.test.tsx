import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import AdminSubscriptionsPage from "./AdminSubscriptionsPage";

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

    render(<AdminSubscriptionsPage />);

    await waitFor(() => expect(screen.getByText("agence@test.local")).toBeInTheDocument());
    expect(screen.getByText("PRO")).toBeInTheDocument();
    expect(screen.getByText("29 €")).toBeInTheDocument();
    expect(screen.getByText("VIR-2026-001")).toBeInTheDocument();
  });

  it("affiche un message quand aucun virement n'est en attente", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [] });

    render(<AdminSubscriptionsPage />);

    await waitFor(() => expect(screen.getByText("Aucun virement en attente")).toBeInTheDocument());
  });

  it("affiche une erreur avec un bouton réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });

    render(<AdminSubscriptionsPage />);

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({ data: [] });
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("Aucun virement en attente")).toBeInTheDocument());
  });

  it("confirme un virement après validation : POST puis retire la ligne de la liste", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: [pendingTransfer()] });
    mockedApi.post.mockResolvedValueOnce({ data: { success: true } });

    render(<AdminSubscriptionsPage />);

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

    render(<AdminSubscriptionsPage />);

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

    render(<AdminSubscriptionsPage />);

    await waitFor(() => expect(screen.getByText("agence@test.local")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Confirmer le paiement" }));

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith("Ce virement a déjà été traité"));
    // La ligne reste affichée puisque la confirmation a échoué côté serveur.
    expect(screen.getByText("agence@test.local")).toBeInTheDocument();
  });
});
