import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import AdminAuditPage from "./AdminAuditPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function entree(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    adminEmail: "admin@test.local",
    action: "subscription.bank_transfer.confirm",
    targetUserId: "mgr-1",
    targetLabel: "agence@test.local",
    details: "Virement PRO de 29 EUR confirmé (réf. VIR-1)",
    createdAt: "2026-10-10T10:00:00.000Z",
    ...overrides,
  };
}

function page(items: Array<Record<string, unknown>>) {
  return { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 } };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminAuditPage />
    </MemoryRouter>
  );
}

describe("AdminAuditPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
  });

  it("affiche qui a fait quoi, sur quel gestionnaire, avec le détail enregistré", async () => {
    mockedApi.get.mockResolvedValueOnce(page([entree()]));
    renderPage();

    const tableau = within(await screen.findByRole("table"));
    expect(tableau.getByText("admin@test.local")).toBeInTheDocument();
    expect(tableau.getByText("Virement confirmé")).toBeInTheDocument();
    expect(tableau.getByText("Virement PRO de 29 EUR confirmé (réf. VIR-1)")).toBeInTheDocument();
    expect(tableau.getByRole("link", { name: "agence@test.local" })).toHaveAttribute("href", "/admin/gestionnaires/mgr-1");
  });

  it("affiche un tiret quand l'action ne vise aucun gestionnaire", async () => {
    mockedApi.get.mockResolvedValueOnce(
      page([entree({ action: "platform.bank_details.update", targetUserId: null, targetLabel: null })])
    );
    renderPage();

    const tableau = within(await screen.findByRole("table"));
    expect(tableau.getByText("Coordonnées bancaires modifiées")).toBeInTheDocument();
    expect(tableau.queryByRole("link")).not.toBeInTheDocument();
  });

  it("garde lisible une action inconnue sous sa clé brute", async () => {
    mockedApi.get.mockResolvedValueOnce(page([entree({ action: "future.action" })]));
    renderPage();

    expect(await screen.findByText("future.action")).toBeInTheDocument();
  });

  it("traduit les actions de suspension et de réactivation", async () => {
    mockedApi.get.mockResolvedValueOnce(
      page([
        entree({ id: "a1", action: "manager.suspend", details: "Compte suspendu. Motif : Impayé" }),
        entree({ id: "a2", action: "manager.reactivate", details: "Suspension levée" }),
      ])
    );
    renderPage();

    const tableau = within(await screen.findByRole("table"));
    expect(tableau.getByText("Compte suspendu")).toBeInTheDocument();
    expect(tableau.getByText("Suspension levée", { selector: "td.font-semibold" })).toBeInTheDocument();
  });

  it("affiche un état vide", async () => {
    mockedApi.get.mockResolvedValueOnce(page([]));
    renderPage();

    expect(await screen.findByText("Aucune action enregistrée")).toBeInTheDocument();
  });

  it("transmet le filtre d'action au serveur", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValue(page([entree()]));
    renderPage();
    await screen.findByRole("table");

    await user.selectOptions(screen.getByLabelText("Filtrer par action"), "subscription.bank_transfer.reject");

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/admin/audit-logs", {
        params: { page: 1, action: "subscription.bank_transfer.reject" },
      })
    );
  });

  it("affiche l'erreur du serveur", async () => {
    mockedApi.get.mockRejectedValueOnce({ response: { data: { error: "Erreur serveur" } }, isAxiosError: true });
    renderPage();

    expect(await screen.findByText("Impossible de charger le journal d'audit")).toBeInTheDocument();
    expect(screen.getByText("Erreur serveur")).toBeInTheDocument();
  });
});
