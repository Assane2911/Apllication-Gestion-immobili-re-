import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import AdminSuggestionsPage from "./AdminSuggestionsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function page(items: Array<Record<string, unknown>>, reste: Record<string, unknown> = {}) {
  return { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1, ...reste } };
}

/**
 * Cet écran est une lecture, et sa seule exigence est de rester fidèle : ce
 * qui a été écrit, par qui, depuis où. Les tests portent donc sur ce que
 * l'administration doit pouvoir situer sans aller-retour.
 */
describe("AdminSuggestionsPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
  });

  it("affiche chaque suggestion avec son auteur, son rôle et la page d'où elle part", async () => {
    mockedApi.get.mockResolvedValueOnce(
      page([
        {
          id: "s1",
          authorId: "u1",
          authorLabel: "agence@test.local",
          authorRole: "MANAGER",
          page: "/factures",
          message: "Pouvoir filtrer les factures par bien",
          createdAt: "2026-09-20T10:00:00.000Z",
        },
      ])
    );

    render(<AdminSuggestionsPage />);

    expect(await screen.findByText(/filtrer les factures par bien/i)).toBeInTheDocument();
    expect(screen.getByText("agence@test.local")).toBeInTheDocument();
    expect(screen.getByText("Gestionnaire")).toBeInTheDocument();
    expect(screen.getByText(/\/factures/)).toBeInTheDocument();
  });

  it("signale que le compte de l'auteur a été supprimé, sans perdre la suggestion", async () => {
    // L'email est recopié dans la ligne, pas seulement référencé : une
    // suggestion doit survivre à la suppression du compte, sinon elle devient
    // un texte anonyme que plus personne ne peut rattacher.
    mockedApi.get.mockResolvedValueOnce(
      page([
        {
          id: "s2",
          authorId: null,
          authorLabel: "parti@test.local",
          authorRole: "TENANT",
          page: null,
          message: "Un rappel la veille de l'échéance",
          createdAt: "2026-09-19T10:00:00.000Z",
        },
      ])
    );

    render(<AdminSuggestionsPage />);

    expect(await screen.findByText(/rappel la veille/i)).toBeInTheDocument();
    expect(screen.getByText("parti@test.local")).toBeInTheDocument();
    expect(screen.getByText(/compte supprimé/i)).toBeInTheDocument();
    // Sans chemin enregistré, on le dit — plutôt que de laisser un blanc que
    // le lecteur interpréterait comme une page d'accueil.
    expect(screen.getByText(/page non précisée/i)).toBeInTheDocument();
  });

  it("n'annonce « aucune suggestion » qu'après la réponse du serveur", async () => {
    // Le défaut classique de ces écrans : afficher l'état vide pendant le
    // chargement, c'est-à-dire répondre faux avant d'avoir la réponse.
    let repondre: (valeur: unknown) => void = () => {};
    mockedApi.get.mockReturnValueOnce(new Promise((resolve) => (repondre = resolve)) as never);

    render(<AdminSuggestionsPage />);

    expect(screen.queryByText(/aucune suggestion/i)).not.toBeInTheDocument();
    expect(screen.getByText(/chargement des suggestions/i)).toBeInTheDocument();

    repondre(page([]));

    expect(await screen.findByText(/aucune suggestion/i)).toBeInTheDocument();
  });

  it("dit pourquoi la liste est absente quand le chargement échoue", async () => {
    mockedApi.get.mockRejectedValueOnce(
      Object.assign(new Error("Requête refusée"), {
        isAxiosError: true,
        response: { data: { error: "Accès refusé" } },
      })
    );

    render(<AdminSuggestionsPage />);

    expect(await screen.findByText(/impossible de charger les suggestions/i)).toBeInTheDocument();
    expect(screen.getByText(/accès refusé/i)).toBeInTheDocument();
    // Et surtout pas « aucune suggestion » : il y en a peut-être des dizaines.
    expect(screen.queryByText(/aucune suggestion/i)).not.toBeInTheDocument();
  });

  it("demande la page courante au serveur plutôt que de tout charger", async () => {
    mockedApi.get.mockResolvedValueOnce(page([]));

    render(<AdminSuggestionsPage />);

    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith("/admin/suggestions", { params: { page: 1 } }));
  });
});
