import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { Listing, ListingLead, PaginatedResponse } from "../../types";
import ListingLeadsPage from "./ListingLeadsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function lead(overrides: Partial<ListingLead> = {}): ListingLead {
  return {
    id: "lead-1",
    listingId: "list-1",
    listingTitle: "Appartement 2 pièces vue mer",
    managerId: "mgr-1",
    prospectName: "Aïcha Ndiaye",
    prospectEmail: "aicha@example.com",
    prospectPhone: "+221 77 111 22 33",
    requestType: "VISIT",
    preferredDate: null,
    message: "Disponible ce week-end ?",
    status: "NEW",
    notes: null,
    createdAt: "2026-09-10T10:00:00.000Z",
    updatedAt: "2026-09-10T10:00:00.000Z",
    ...overrides,
  };
}

function leadsPaginated(items: ListingLead[]): { data: PaginatedResponse<ListingLead> } {
  return { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 } };
}

function listingsPaginated(items: Listing[] = []): { data: PaginatedResponse<Listing> } {
  return { data: { items, page: 1, pageSize: 100, total: items.length, totalPages: 1 } };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ListingLeadsPage />
    </MemoryRouter>
  );
}

describe("ListingLeadsPage (manager)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.patch.mockReset();
    mockedApi.delete.mockReset();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("affiche les demandes reçues avec l'annonce, le contact et le type de demande", async () => {
    mockedApi.get.mockResolvedValueOnce(leadsPaginated([lead()]));
    mockedApi.get.mockResolvedValueOnce(listingsPaginated());
    renderPage();

    await waitFor(() => expect(screen.getByText("Aïcha Ndiaye")).toBeInTheDocument());
    expect(screen.getByText("Appartement 2 pièces vue mer")).toBeInTheDocument();
    expect(screen.getByText("aicha@example.com")).toBeInTheDocument();
    expect(screen.getByText("Demande de visite")).toBeInTheDocument();
    expect(screen.getByText("Disponible ce week-end ?")).toBeInTheDocument();
  });

  it("affiche un état vide quand aucune demande n'est reçue", async () => {
    mockedApi.get.mockResolvedValueOnce(leadsPaginated([]));
    mockedApi.get.mockResolvedValueOnce(listingsPaginated());
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucune demande pour l'instant")).toBeInTheDocument());
  });

  it("affiche une erreur de chargement avec un bouton réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    mockedApi.get.mockResolvedValueOnce(listingsPaginated());
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce(leadsPaginated([lead()]));
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("Aïcha Ndiaye")).toBeInTheDocument());
  });

  it("change le statut d'une demande et relance le chargement", async () => {
    mockedApi.get.mockResolvedValueOnce(leadsPaginated([lead()]));
    mockedApi.get.mockResolvedValueOnce(listingsPaginated());
    mockedApi.patch.mockResolvedValueOnce({ data: {} });
    mockedApi.get.mockResolvedValueOnce(leadsPaginated([lead({ status: "CONTACTED" })]));

    renderPage();
    await waitFor(() => expect(screen.getByText("Aïcha Ndiaye")).toBeInTheDocument());

    await userEvent.setup().click(within(screen.getByRole("group", { name: "Changer le statut :" })).getByRole("button", { name: "Contacté" }));

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith("/listings/leads/lead-1", {
        status: "CONTACTED",
        notes: undefined,
      })
    );
  });

  it("filtre par statut et relance l'appel avec le paramètre status", async () => {
    mockedApi.get.mockResolvedValueOnce(leadsPaginated([lead()]));
    mockedApi.get.mockResolvedValueOnce(listingsPaginated());
    renderPage();
    await waitFor(() => expect(screen.getByText("Aïcha Ndiaye")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce(leadsPaginated([]));
    await userEvent.setup().click(within(screen.getByRole("group", { name: "Filtrer par statut" })).getByRole("button", { name: "Converti" }));

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/listings/leads", {
        params: { page: 1, pageSize: 20, status: "CONVERTED" },
        signal: expect.anything(),
      })
    );
  });

  /**
   * Avant ce correctif, la seule façon d'effacer un prospect était de
   * supprimer l'annonce ENTIÈRE (cascade) — bien trop grossier pour honorer
   * une demande d'effacement individuelle ou agir sur le signal de
   * conservation des données (AgencySettingsPage, "leadsAnciens").
   */
  it("supprime une demande après confirmation", async () => {
    mockedApi.get.mockResolvedValueOnce(leadsPaginated([lead()]));
    mockedApi.get.mockResolvedValueOnce(listingsPaginated());
    mockedApi.delete.mockResolvedValueOnce({ data: {} });
    mockedApi.get.mockResolvedValueOnce(leadsPaginated([]));

    renderPage();
    await waitFor(() => expect(screen.getByText("Aïcha Ndiaye")).toBeInTheDocument());

    await userEvent.setup().click(screen.getByRole("button", { name: "Supprimer" }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/listings/leads/lead-1"));
  });

  it("ne supprime rien si le gestionnaire annule la confirmation", async () => {
    mockedApi.get.mockResolvedValueOnce(leadsPaginated([lead()]));
    mockedApi.get.mockResolvedValueOnce(listingsPaginated());
    vi.spyOn(window, "confirm").mockReturnValue(false);

    renderPage();
    await waitFor(() => expect(screen.getByText("Aïcha Ndiaye")).toBeInTheDocument());

    await userEvent.setup().click(screen.getByRole("button", { name: "Supprimer" }));

    expect(mockedApi.delete).not.toHaveBeenCalled();
  });

  describe("synthèse, ancienneté, WhatsApp, recherche et export", () => {
    const il_y_a = (jours: number) => new Date(Date.now() - jours * 86_400_000).toISOString();
    const parc = () => [
      lead({ id: "l1", prospectName: "Aïcha Ndiaye", createdAt: il_y_a(5), status: "NEW", requestType: "VISIT" }),
      lead({ id: "l2", prospectName: "Moussa Ba", prospectPhone: "0771234567", createdAt: il_y_a(0), status: "NEW", requestType: "INFO", message: "Quel est le loyer ?" }),
      lead({ id: "l3", prospectName: "Élodie Sow", createdAt: il_y_a(8), status: "CONVERTED" }),
      lead({ id: "l4", prospectName: "Ibrahima Fall", createdAt: il_y_a(3), status: "CONTACTED", requestType: "VISIT" }),
    ];
    const noms = () => screen.getAllByRole("article").map((a) => within(a).getByRole("heading", { level: 3 }).textContent);

    async function afficher() {
      mockedApi.get.mockImplementation(async (url: string) => (url === "/listings" ? listingsPaginated() : leadsPaginated(parc())));
      renderPage();
      await screen.findByText("Moussa Ba");
    }

    it("résume l'entonnoir : nouvelles, à relancer, visites à organiser, taux d'aboutissement", async () => {
      await afficher();
      const synthese = screen.getByLabelText("Synthèse des demandes");
      const valeur = (libelle: string) => within(synthese).getByText(libelle).nextElementSibling;
      expect(valeur("Nouvelles")).toHaveTextContent("2");
      expect(valeur("À relancer")).toHaveTextContent("1"); // Aïcha : 5 jours sans réponse
      expect(valeur("Visites à organiser")).toHaveTextContent("2"); // Aïcha (nouvelle) et Ibrahima (contacté)
      expect(valeur("Taux d'aboutissement")).toHaveTextContent("25 %"); // 1 aboutie sur 4 actives
    });

    it("signale l'ancienneté de chaque demande et celles à relancer", async () => {
      await afficher();
      const aicha = screen.getByRole("heading", { level: 3, name: "Aïcha Ndiaye" }).closest("article") as HTMLElement;
      expect(within(aicha).getByText(/Reçue il y a 5 j/)).toBeInTheDocument();
      expect(within(aicha).getByText("À relancer")).toBeInTheDocument();

      const moussa = screen.getByRole("heading", { level: 3, name: "Moussa Ba" }).closest("article") as HTMLElement;
      expect(within(moussa).getByText(/Reçue aujourd'hui/)).toBeInTheDocument();
      expect(within(moussa).queryByText("À relancer")).not.toBeInTheDocument();
    });

    it("ne propose WhatsApp que pour un numéro au format international", async () => {
      await afficher();
      const aicha = screen.getByRole("heading", { level: 3, name: "Aïcha Ndiaye" }).closest("article") as HTMLElement;
      expect(within(aicha).getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", "https://wa.me/221771112233");
      const moussa = screen.getByRole("heading", { level: 3, name: "Moussa Ba" }).closest("article") as HTMLElement;
      expect(within(moussa).queryByRole("link", { name: "WhatsApp" })).not.toBeInTheDocument();
    });

    it("cherche dans le nom, le message ou l'annonce, sans tenir compte des accents", async () => {
      const user = userEvent.setup();
      await afficher();
      await user.type(screen.getByRole("searchbox"), "elodie");
      expect(noms()).toEqual(["Élodie Sow"]);
      await user.clear(screen.getByRole("searchbox"));
      await user.type(screen.getByRole("searchbox"), "quel loyer");
      expect(noms()).toEqual(["Moussa Ba"]);
    });

    it("exporte les demandes affichées en CSV", async () => {
      const user = userEvent.setup();
      let blob: Blob | undefined;
      Object.defineProperty(URL, "createObjectURL", { value: (b: Blob) => ((blob = b), "blob:test"), configurable: true });
      Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      await afficher();
      await user.type(screen.getByRole("searchbox"), "moussa");
      await user.click(screen.getByRole("button", { name: "Exporter en CSV" }));
      const texte = await new Promise<string>((resolve) => {
        const lecteur = new FileReader();
        lecteur.onload = () => resolve(String(lecteur.result));
        lecteur.readAsText(blob!);
      });
      const lignes = texte.split("\n");
      expect(lignes).toHaveLength(2);
      expect(lignes[1]).toContain('"Moussa Ba";"aicha@example.com"');
    });
  });
});
