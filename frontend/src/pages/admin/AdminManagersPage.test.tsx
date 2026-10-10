import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import AdminManagersPage from "./AdminManagersPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function ligne(overrides: Record<string, unknown> = {}) {
  return {
    id: "mgr-1",
    email: "agence@test.local",
    agencyName: "Agence Alpha",
    plan: "PRO",
    status: "ACTIVE",
    trialEndsAt: null,
    subscriptionEndsAt: "2030-01-01T00:00:00.000Z",
    propertiesCount: 3,
    tenantsCount: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function page(items: Array<Record<string, unknown>>, reste: Record<string, unknown> = {}) {
  return { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1, ...reste } };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminManagersPage />
    </MemoryRouter>
  );
}

describe("AdminManagersPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
  });

  it("affiche chaque gestionnaire avec formule, statut, usage et lien vers sa fiche", async () => {
    mockedApi.get.mockResolvedValueOnce(page([ligne()]));
    renderPage();

    const lien = await screen.findByRole("link", { name: "Agence Alpha" });
    expect(lien).toHaveAttribute("href", "/admin/gestionnaires/mgr-1");
    expect(screen.getByText("agence@test.local")).toBeInTheDocument();
    // Les libellés « Pro » / « Actif » existent aussi dans les listes de filtres :
    // on cible donc le tableau.
    const tableau = within(screen.getByRole("table"));
    expect(tableau.getByText("Pro")).toBeInTheDocument();
    expect(tableau.getByText("Actif")).toBeInTheDocument();
    expect(tableau.getByText("3 bien(s) · 2 locataire(s)")).toBeInTheDocument();
  });

  it("affiche un libellé de repli quand l'agence n'a pas de nom", async () => {
    mockedApi.get.mockResolvedValueOnce(page([ligne({ agencyName: null })]));
    renderPage();

    expect(await screen.findByText("Agence sans nom renseigné")).toBeInTheDocument();
  });

  it("affiche un état vide quand aucun gestionnaire ne correspond", async () => {
    mockedApi.get.mockResolvedValueOnce(page([]));
    renderPage();

    expect(await screen.findByText("Aucun gestionnaire trouvé")).toBeInTheDocument();
  });

  it("transmet les filtres formule et statut au serveur", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValue(page([ligne()]));
    renderPage();
    await screen.findByText("Agence Alpha");

    await user.selectOptions(screen.getByLabelText("Filtrer par formule"), "PRO");
    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/admin/managers", { params: { page: 1, plan: "PRO" } })
    );

    await user.selectOptions(screen.getByLabelText("Filtrer par statut"), "EXPIRED");
    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/admin/managers", {
        params: { page: 1, plan: "PRO", status: "EXPIRED" },
      })
    );
  });

  it("transmet la recherche (après anti-rebond) et repart à la page 1", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValue(page([ligne()]));
    renderPage();
    await screen.findByText("Agence Alpha");

    await user.type(screen.getByLabelText("Rechercher un gestionnaire"), "alpha");

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/admin/managers", { params: { page: 1, search: "alpha" } })
    );
  });

  it("affiche l'erreur du serveur", async () => {
    mockedApi.get.mockRejectedValueOnce({ response: { data: { error: "Erreur serveur" } }, isAxiosError: true });
    renderPage();

    expect(await screen.findByText("Impossible de charger les gestionnaires")).toBeInTheDocument();
    expect(screen.getByText("Erreur serveur")).toBeInTheDocument();
  });
});
