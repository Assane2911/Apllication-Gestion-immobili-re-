import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import AdminManagerDetailPage from "./AdminManagerDetailPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function fiche(overrides: Record<string, unknown> = {}) {
  return {
    id: "mgr-1",
    email: "agence@test.local",
    currency: "EUR",
    createdAt: "2026-01-01T00:00:00.000Z",
    emailVerifiedAt: "2026-01-01T00:00:00.000Z",
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
});
