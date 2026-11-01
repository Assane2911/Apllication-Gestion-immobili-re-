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
    suspendedAt: null,
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

  it("indique la date ET l'heure de création du compte", async () => {
    mockedApi.get.mockResolvedValueOnce(page([ligne({ createdAt: "2026-10-21T15:07:48.385Z" })]));
    renderPage();

    await screen.findByRole("link", { name: "Agence Alpha" });
    // Deux cellules datées : l'échéance de l'abonnement et la création du compte, toutes deux avec l'heure.
    const cellules = within(screen.getByRole("table")).getAllByText(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
    expect(cellules).toHaveLength(2);
  });

  it("indique la date ET l'heure de fin d'essai d'un compte en essai", async () => {
    mockedApi.get.mockResolvedValueOnce(page([ligne({ status: "TRIAL", trialEndsAt: "2026-11-05T15:07:48.385Z", subscriptionEndsAt: null })]));
    renderPage();

    await screen.findByRole("link", { name: "Agence Alpha" });
    expect(within(screen.getByRole("table")).getAllByText(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/)).toHaveLength(2);
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
    expect(tableau.getByText("Professionnel")).toBeInTheDocument();
    expect(tableau.getByText("Actif")).toBeInTheDocument();
    expect(tableau.getByText("3 bien(s) · 2 locataire(s)")).toBeInTheDocument();
  });

  it("affiche un badge « Suspendu » en plus du statut d'abonnement", async () => {
    mockedApi.get.mockResolvedValueOnce(page([ligne({ suspendedAt: "2026-10-10T10:00:00.000Z" })]));
    renderPage();

    const tableau = within(await screen.findByRole("table"));
    expect(tableau.getByText("Suspendu")).toBeInTheDocument();
    expect(tableau.getByText("Actif")).toBeInTheDocument();
  });

  it("n'affiche pas de badge « Suspendu » pour un compte en règle", async () => {
    mockedApi.get.mockResolvedValueOnce(page([ligne()]));
    renderPage();

    const tableau = within(await screen.findByRole("table"));
    expect(tableau.queryByText("Suspendu")).not.toBeInTheDocument();
  });

  it("filtre les comptes suspendus", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValue(page([ligne()]));
    renderPage();
    await screen.findByText("Agence Alpha");

    await user.click(within(screen.getByRole("group", { name: "Filtrer par statut" })).getByRole("button", { name: "Suspendu" }));

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/admin/managers", { params: { page: 1, status: "SUSPENDED" } })
    );
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

    await user.click(within(screen.getByRole("group", { name: "Filtrer par statut" })).getByRole("button", { name: "Expiré" }));
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
  it("exporte la sélection affichée : formule, statut et recherche sont transmis à l'export", async () => {
    mockedApi.get.mockResolvedValue({ data: { items: [ligne()], page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(
      <MemoryRouter>
        <AdminManagersPage />
      </MemoryRouter>
    );
    await screen.findByText("Agence Alpha");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: /formule/i }), "PRO");
    await userEvent.click(within(screen.getByRole("group", { name: /statut/i })).getByRole("button", { name: "Suspendu" }));
    await userEvent.type(screen.getByRole("searchbox", { name: /rechercher/i }), "alpha");
    // La recherche est temporisée (300 ms) : le bouton doit porter la valeur validée.
    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenCalledWith("/admin/managers", expect.objectContaining({ params: expect.objectContaining({ search: "alpha" }) }))
    );
    await userEvent.click(screen.getByRole("button", { name: "Exporter en CSV" }));

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenCalledWith("/admin/exports/managers.csv", {
        params: { search: "alpha", plan: "PRO", status: "SUSPENDED" },
        responseType: "blob",
      })
    );
  });

  it("chiffre chaque onglet de statut avec les comptes du tableau de bord", async () => {
    mockedApi.get.mockImplementation((chemin: string) =>
      Promise.resolve(
        chemin === "/admin/dashboard/stats"
          ? { data: { managers: { total: 12, trialActive: 4, subscriptionActive: 6, expired: 2, suspended: 1 } } }
          : page([ligne()])
      )
    );
    renderPage();
    await screen.findByRole("link", { name: "Agence Alpha" });

    const onglets = within(screen.getByRole("group", { name: "Filtrer par statut" }));
    expect(await onglets.findByRole("button", { name: "Tous les statuts · 12" })).toBeInTheDocument();
    expect(onglets.getByRole("button", { name: "Actif · 6" })).toBeInTheDocument();
    expect(onglets.getByRole("button", { name: "Essai · 4" })).toBeInTheDocument();
    expect(onglets.getByRole("button", { name: "Suspendu · 1" })).toBeInTheDocument();
    // L'onglet de l'état choisi est annoncé comme pressé.
    await userEvent.click(onglets.getByRole("button", { name: "Actif · 6" }));
    expect(onglets.getByRole("button", { name: "Actif · 6" })).toHaveAttribute("aria-pressed", "true");
  });

  it("situe l'usage d'un compte face au plafond de biens de sa formule, et signale celui qui l'approche", async () => {
    mockedApi.get.mockResolvedValueOnce(
      page([
        ligne({ id: "a", agencyName: "Agence Proche", plan: "STARTER", propertiesCount: 5 }),
        ligne({ id: "b", agencyName: "Agence Large", plan: "PRO", propertiesCount: 3 }),
        ligne({ id: "c", agencyName: "Agence Sans Limite", plan: "ENTERPRISE", propertiesCount: 90 }),
      ])
    );
    renderPage();

    const tableau = within(await screen.findByRole("table"));
    expect(tableau.getByRole("meter", { name: "5 bien(s) sur 5 inclus dans la formule" })).toHaveAttribute("aria-valuenow", "5");
    expect(tableau.getByRole("meter", { name: "3 bien(s) sur 25 inclus dans la formule" })).toBeInTheDocument();
    // Formule illimitée : aucune jauge, et aucune alerte.
    expect(tableau.getAllByRole("meter")).toHaveLength(2);
    expect(tableau.getAllByText("Proche du plafond")).toHaveLength(1);
  });

  it("propose d'écrire au gestionnaire et de copier son adresse", async () => {
    const ecrire = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: ecrire }, configurable: true });
    mockedApi.get.mockResolvedValueOnce(page([ligne()]));
    renderPage();

    expect(await screen.findByRole("link", { name: "Écrire à agence@test.local" })).toHaveAttribute("href", "mailto:agence@test.local");
    await userEvent.click(screen.getByRole("button", { name: "Copier l'adresse agence@test.local" }));
    expect(ecrire).toHaveBeenCalledWith("agence@test.local");
  });

  it("annonce le délai restant d'un essai en cours", async () => {
    const dansDeuxJours = new Date(Date.now() + 2 * 86_400_000 - 3_600_000).toISOString();
    mockedApi.get.mockResolvedValueOnce(page([ligne({ status: "TRIAL", trialEndsAt: dansDeuxJours, subscriptionEndsAt: null })]));
    renderPage();

    expect(await screen.findByText("dans 2 jour(s)")).toBeInTheDocument();
  });
});
