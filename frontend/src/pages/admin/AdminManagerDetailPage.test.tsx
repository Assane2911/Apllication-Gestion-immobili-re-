import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import AdminManagerDetailPage from "./AdminManagerDetailPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function fiche(overrides: Record<string, unknown> = {}) {
  return {
    id: "mgr-1",
    email: "agence@test.local",
    currency: "EUR",
    createdAt: "2026-01-01T00:00:00.000Z",
    emailVerifiedAt: "2026-01-01T00:00:00.000Z",
    suspendedAt: null,
    suspensionReason: null,
    twoFactorEnabled: true,
    subscription: {
      status: "ACTIVE",
      plan: "PRO",
      trialEndsAt: null,
      subscriptionEndsAt: "2030-01-01T00:00:00.000Z",
      trialDaysRemaining: 0,
      paymentMethod: "BANK_TRANSFER",
      autoRenew: false,
    },
    agency: { agencyName: "Agence Alpha", phone: "+221770000000", email: null, address: null, siretOrId: null },
    usage: { properties: 4, tenants: 3, owners: 2, activeContracts: 5, collaborators: 1 },
    lastActivityAt: "2026-06-01T00:00:00.000Z",
    billingHistory: [
      {
        id: "b1",
        plan: "PRO",
        amount: 29,
        currency: "EUR",
        billingCycle: "MONTHLY",
        status: "PAID",
        paymentMethod: "BANK_TRANSFER",
        paymentRef: "VIR-001",
        startDate: "2026-05-01T00:00:00.000Z",
        endDate: "2026-06-01T00:00:00.000Z",
        createdAt: "2026-05-01T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <MemoryRouter initialEntries={["/admin/gestionnaires/mgr-1"]}>
          <Routes>
            <Route path="/admin/gestionnaires/:id" element={<AdminManagerDetailPage />} />
          </Routes>
        </MemoryRouter>
      </CurrencyProvider>
    </AuthProvider>
  );
}

describe("AdminManagerDetailPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("affiche l'abonnement, l'agence, l'usage et l'historique de facturation", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: fiche() });
    renderPage();

    expect(await screen.findByRole("heading", { name: "Agence Alpha" })).toBeInTheDocument();
    expect(mockedApi.get).toHaveBeenCalledWith("/admin/managers/mgr-1");
    expect(screen.getByText("+221770000000")).toBeInTheDocument();
    expect(screen.getByText("Actif")).toBeInTheDocument();
    expect(screen.getByText("VIR-001")).toBeInTheDocument();
    expect(screen.getByText("29 €")).toBeInTheDocument();
    expect(screen.getByText("2 propriétaire(s)")).toBeInTheDocument();
  });

  it("indique les jours restants d'un essai en cours", async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: fiche({
        subscription: {
          status: "TRIAL",
          plan: "STARTER",
          trialEndsAt: "2030-01-10T00:00:00.000Z",
          subscriptionEndsAt: null,
          trialDaysRemaining: 6,
          paymentMethod: null,
          autoRenew: false,
        },
        billingHistory: [],
      }),
    });
    renderPage();

    expect(await screen.findByText(/6 jour\(s\) restant\(s\)/)).toBeInTheDocument();
    expect(screen.getByText("Aucun paiement enregistré.")).toBeInTheDocument();
  });

  it("indique quand l'agence n'a pas renseigné ses informations", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: fiche({ agency: null }) });
    renderPage();

    expect(await screen.findByText("Ce gestionnaire n'a pas encore renseigné les informations de son agence.")).toBeInTheDocument();
  });

  it("affiche l'erreur (ex. gestionnaire introuvable)", async () => {
    mockedApi.get.mockRejectedValueOnce({ response: { data: { error: "Gestionnaire introuvable" } }, isAxiosError: true });
    renderPage();

    expect(await screen.findByText("Gestionnaire introuvable")).toBeInTheDocument();
  });

  it("suspend le compte avec un motif obligatoire, puis relit la fiche", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: fiche() });
    mockedApi.post.mockResolvedValueOnce({ data: { success: true } });
    mockedApi.get.mockResolvedValueOnce({
      data: fiche({ suspendedAt: "2026-10-10T10:00:00.000Z", suspensionReason: "Impayé" }),
    });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Suspendre le compte" }));
    const confirmer = screen.getByRole("button", { name: "Confirmer la suspension" });
    // Sans motif, impossible de confirmer.
    expect(confirmer).toBeDisabled();

    await user.type(screen.getByLabelText(/Motif \(note interne/), "Impayé");
    await user.click(confirmer);

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/admin/managers/mgr-1/suspend", { reason: "Impayé" })
    );
    expect(await screen.findByText("Compte suspendu")).toBeInTheDocument();
    expect(screen.getByText("Impayé")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lever la suspension" })).toBeInTheDocument();
  });

  it("affiche l'erreur serveur d'une suspension refusée", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: fiche() });
    mockedApi.post.mockRejectedValueOnce({ response: { data: { error: "Ce compte est déjà suspendu" } }, isAxiosError: true });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Suspendre le compte" }));
    await user.type(screen.getByLabelText(/Motif \(note interne/), "Doublon");
    await user.click(screen.getByRole("button", { name: "Confirmer la suspension" }));

    expect(await screen.findByText("Ce compte est déjà suspendu")).toBeInTheDocument();
  });

  it("annuler referme le formulaire sans rien envoyer", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: fiche() });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Suspendre le compte" }));
    await user.click(screen.getByRole("button", { name: "Annuler" }));

    expect(screen.getByRole("button", { name: "Suspendre le compte" })).toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("lève la suspension après confirmation", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({
      data: fiche({ suspendedAt: "2026-10-10T10:00:00.000Z", suspensionReason: "Impayé" }),
    });
    mockedApi.post.mockResolvedValueOnce({ data: { success: true } });
    mockedApi.get.mockResolvedValueOnce({ data: fiche() });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Lever la suspension" }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/admin/managers/mgr-1/reactivate"));
    expect(await screen.findByRole("button", { name: "Suspendre le compte" })).toBeInTheDocument();
  });

  it("ne lève pas la suspension si l'administrateur refuse la confirmation", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    mockedApi.get.mockResolvedValueOnce({
      data: fiche({ suspendedAt: "2026-10-10T10:00:00.000Z", suspensionReason: "Impayé" }),
    });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Lever la suspension" }));

    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  describe("ajustement de l'abonnement", () => {
    it("offre des jours avec un motif, confirme et relit la fiche", async () => {
      const user = userEvent.setup();
      mockedApi.get.mockResolvedValueOnce({ data: fiche() });
      mockedApi.post.mockResolvedValueOnce({ data: { success: true } });
      mockedApi.get.mockResolvedValueOnce({ data: fiche() });
      renderPage();

      await user.type(await screen.findByLabelText("Nombre de jours (1 à 365)"), "10");
      await user.type(screen.getAllByLabelText("Motif (journal d'audit)")[0], "Geste commercial");
      await user.click(screen.getByRole("button", { name: "Offrir ces jours" }));

      await waitFor(() =>
        expect(mockedApi.post).toHaveBeenCalledWith("/admin/managers/mgr-1/subscription/grant-days", {
          days: 10,
          reason: "Geste commercial",
        })
      );
      expect(await screen.findByText("Ajustement enregistré.")).toBeInTheDocument();
      await waitFor(() => expect(mockedApi.get).toHaveBeenCalledTimes(2));
    });

    it("ne permet pas d'envoyer sans nombre de jours ni motif", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: fiche() });
      renderPage();

      expect(await screen.findByRole("button", { name: "Offrir ces jours" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Changer la formule" })).toBeDisabled();
    });

    it("change la formule : la formule actuelle n'est pas proposée", async () => {
      const user = userEvent.setup();
      mockedApi.get.mockResolvedValue({ data: fiche() }); // formule actuelle : PRO
      mockedApi.post.mockResolvedValueOnce({ data: { success: true } });
      renderPage();

      const select = await screen.findByLabelText("Nouvelle formule");
      const options = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
      expect(options).toEqual(["", "STARTER", "ENTERPRISE"]);

      await user.selectOptions(select, "ENTERPRISE");
      await user.type(screen.getAllByLabelText("Motif (journal d'audit)")[1], "Erreur de souscription");
      await user.click(screen.getByRole("button", { name: "Changer la formule" }));

      await waitFor(() =>
        expect(mockedApi.post).toHaveBeenCalledWith("/admin/managers/mgr-1/subscription/change-plan", {
          plan: "ENTERPRISE",
          reason: "Erreur de souscription",
        })
      );
    });

    it("affiche l'erreur du serveur", async () => {
      const user = userEvent.setup();
      mockedApi.get.mockResolvedValueOnce({ data: fiche() });
      mockedApi.post.mockRejectedValueOnce({ response: { data: { error: "Cet abonnement n'a pas d'échéance" } }, isAxiosError: true });
      renderPage();

      await user.type(await screen.findByLabelText("Nombre de jours (1 à 365)"), "5");
      await user.type(screen.getAllByLabelText("Motif (journal d'audit)")[0], "Test");
      await user.click(screen.getByRole("button", { name: "Offrir ces jours" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Cet abonnement n'a pas d'échéance");
    });

    it("masque les formulaires pour un abonnement Stripe et explique pourquoi", async () => {
      const base = fiche();
      mockedApi.get.mockResolvedValueOnce({ data: fiche({ subscription: { ...base.subscription, autoRenew: true } }) });
      renderPage();

      expect(await screen.findByText(/renouvellement automatique \(Stripe\)/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Offrir ces jours" })).not.toBeInTheDocument();
    });
  });
});
