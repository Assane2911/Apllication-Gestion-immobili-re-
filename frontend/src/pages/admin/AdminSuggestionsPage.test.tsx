import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import AdminSuggestionsPage from "./AdminSuggestionsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), patch: vi.fn() } };
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
    mockedApi.patch.mockReset();
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

  describe("suivi", () => {
    const suggestion = (surcharge: Record<string, unknown> = {}) => ({
      id: "s1",
      authorId: "u1",
      authorLabel: "agence@test.local",
      authorRole: "MANAGER",
      page: "/factures",
      message: "Pouvoir filtrer les factures par bien",
      status: "NEW",
      adminNote: null,
      createdAt: "2026-09-20T10:00:00.000Z",
      ...surcharge,
    });
    const counts = { NEW: 3, PLANNED: 2, DONE: 1, DECLINED: 0, total: 6 };

    it("affiche les onglets avec le nombre de suggestions par statut", async () => {
      mockedApi.get.mockResolvedValueOnce(page([suggestion()], { counts }));
      render(<AdminSuggestionsPage />);

      expect(await screen.findByRole("button", { name: "Toutes (6)" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Nouvelles (3)" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Prévues (2)" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Réalisées (1)" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Écartées (0)" })).toBeInTheDocument();
    });

    it("demande au serveur le statut choisi dans l'onglet et revient à la page 1", async () => {
      const user = userEvent.setup();
      mockedApi.get.mockResolvedValue(page([suggestion()], { counts }));
      render(<AdminSuggestionsPage />);

      await user.click(await screen.findByRole("button", { name: "Prévues (2)" }));

      await waitFor(() =>
        expect(mockedApi.get).toHaveBeenLastCalledWith("/admin/suggestions", { params: { page: 1, status: "PLANNED" } })
      );
    });

    it("change le statut d'une suggestion d'un clic puis recharge la liste", async () => {
      const user = userEvent.setup();
      mockedApi.get.mockResolvedValue(page([suggestion()], { counts }));
      mockedApi.patch.mockResolvedValueOnce({ data: {} });
      render(<AdminSuggestionsPage />);

      await user.selectOptions(await screen.findByLabelText("Statut de la suggestion"), "PLANNED");

      await waitFor(() => expect(mockedApi.patch).toHaveBeenCalledWith("/admin/suggestions/s1", { status: "PLANNED" }));
      await waitFor(() => expect(mockedApi.get).toHaveBeenCalledTimes(2));
    });

    it("enregistre une note interne ; le bouton reste grisé tant que la note n'a pas changé", async () => {
      const user = userEvent.setup();
      mockedApi.get.mockResolvedValue(page([suggestion()], { counts }));
      mockedApi.patch.mockResolvedValueOnce({ data: {} });
      render(<AdminSuggestionsPage />);

      await user.click(await screen.findByText("Note interne"));
      const enregistrer = screen.getByRole("button", { name: "Enregistrer la note" });
      expect(enregistrer).toBeDisabled();
      expect(screen.getByText("Jamais montrée à l'auteur de la suggestion.")).toBeInTheDocument();

      await user.type(screen.getByLabelText("Note interne"), "À planifier au T1");
      await user.click(enregistrer);

      await waitFor(() =>
        expect(mockedApi.patch).toHaveBeenCalledWith("/admin/suggestions/s1", { adminNote: "À planifier au T1" })
      );
    });

    it("signale qu'une note existe et la pré-remplit", async () => {
      const user = userEvent.setup();
      mockedApi.get.mockResolvedValue(page([suggestion({ adminNote: "Déjà étudié" })], { counts }));
      render(<AdminSuggestionsPage />);

      await user.click(await screen.findByText("Note interne (renseignée)"));

      expect((screen.getByLabelText("Note interne") as HTMLTextAreaElement).value).toBe("Déjà étudié");
    });

    it("affiche l'erreur du serveur quand l'enregistrement échoue", async () => {
      const user = userEvent.setup();
      mockedApi.get.mockResolvedValue(page([suggestion()], { counts }));
      mockedApi.patch.mockRejectedValueOnce({ response: { data: { error: "Suggestion introuvable" } }, isAxiosError: true });
      render(<AdminSuggestionsPage />);

      await user.selectOptions(await screen.findByLabelText("Statut de la suggestion"), "DONE");

      expect(await screen.findByRole("alert")).toHaveTextContent("Suggestion introuvable");
    });

    it("traite une suggestion sans statut (serveur plus ancien) comme « Nouvelle »", async () => {
      mockedApi.get.mockResolvedValueOnce(page([suggestion({ status: undefined })]));
      render(<AdminSuggestionsPage />);

      expect(await screen.findByLabelText("Statut de la suggestion")).toHaveValue("NEW");
    });

    it("dit qu'un onglet est vide plutôt que de prétendre qu'il n'y a aucune suggestion", async () => {
      const user = userEvent.setup();
      mockedApi.get.mockResolvedValueOnce(page([suggestion()], { counts }));
      mockedApi.get.mockResolvedValueOnce(page([], { counts }));
      render(<AdminSuggestionsPage />);

      await user.click(await screen.findByRole("button", { name: "Écartées (0)" }));

      expect(await screen.findByText("Aucune suggestion dans cet onglet")).toBeInTheDocument();
    });
  });
});
