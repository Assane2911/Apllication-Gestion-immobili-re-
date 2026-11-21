import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { Listing, PaginatedResponse } from "../types";
import VitrinePage from "./VitrinePage";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

/**
 * La vitrine publique, première page vue par un visiteur : quand le serveur ne répond pas, il doit lire un message clair et
 * pouvoir réessayer (jamais une page vide qui laisse croire qu'il n'y a aucune annonce) ; quand la liste des pays manque, les
 * annonces restent consultables ; la pagination avance, recule, s'arrête aux bornes, et revient à la première page dès qu'un
 * filtre change.
 */

function erreurServeur(message: string) {
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 503,
    statusText: "Service Unavailable",
    data: { error: message },
    headers: {},
    config: {} as never,
  });
}

const annonce = (id: string, titre: string): Listing =>
  ({
    id,
    type: "RENT",
    title: titre,
    description: "Bel appartement lumineux proche des commodités.",
    price: 450,
    currency: "EUR",
    pricePeriod: "MONTH",
    surface: 55,
    rooms: 2,
    location: "Dakar, Almadies",
    country: "SN",
    imageUrl: null,
    contactPhone: null,
    contactWhatsapp: null,
    contactEmail: null,
    status: "PUBLISHED",
    featured: false,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  }) as Listing;

const reponse = (items: Listing[], page = 1, totalPages = 1): { data: PaginatedResponse<Listing> } => ({
  data: { items, page, pageSize: 12, total: items.length, totalPages },
});

/** Réponses de la liste, dans l'ordre des appels ; les pays répondent à part, par adresse. */
function servir(reponses: Array<{ data: PaginatedResponse<Listing> } | Error>, pays: string[] | Error = ["SN"]) {
  const file = [...reponses];
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === "/listings/public/countries") {
      if (pays instanceof Error) throw pays;
      return { data: { countries: pays } };
    }
    const suivante = file.shift() ?? reponse([]);
    if (suivante instanceof Error) throw suivante;
    return suivante;
  });
}
const appelsListe = () => mockedApi.get.mock.calls.filter(([url]) => url === "/listings/public");
const pageDemandee = (appel: unknown[]) => (appel[1] as { params: { page: number } }).params.page;

/** Le bloc « Précédent · Page N sur M · Suivant » : l'en-tête du site a lui aussi un « Suivant », d'où cette portée. */
const pagination = () => within(screen.getByText(/^Page \d+ sur \d+$/).parentElement as HTMLElement);

function afficher() {
  return render(
    <MemoryRouter>
      <VitrinePage />
    </MemoryRouter>
  );
}

describe("VitrinePage : échecs et pagination", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    localStorage.removeItem("immo.favoris-vitrine");
  });

  it("annonces indisponibles : le message du serveur s'affiche, sans compteur trompeur, et « Réessayer » recharge la liste", async () => {
    const user = userEvent.setup();
    servir([erreurServeur("Service momentanément indisponible."), reponse([annonce("a1", "Villa Baobab")])]);
    afficher();

    expect(await screen.findByText("Service momentanément indisponible.")).toBeInTheDocument();
    expect(screen.queryByText(/annonce(s)? trouvée/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Villa Baobab")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Réessayer" }));

    expect(await screen.findByText("Villa Baobab")).toBeInTheDocument();
    expect(screen.queryByText("Service momentanément indisponible.")).not.toBeInTheDocument();
    expect(appelsListe()).toHaveLength(2);
  });

  it("un échec après un chargement réussi retire l'ancien compteur d'annonces au lieu de le laisser affiché", async () => {
    const user = userEvent.setup();
    servir([reponse([annonce("a1", "Annonce page un")], 1, 2), erreurServeur("Service momentanément indisponible.")]);
    afficher();
    await screen.findByText("Annonce page un");
    expect(screen.getByText("1 annonce")).toBeInTheDocument();

    await user.click(pagination().getByRole("button", { name: "Suivant" }));

    expect(await screen.findByText("Service momentanément indisponible.")).toBeInTheDocument();
    expect(screen.queryByText("1 annonce")).not.toBeInTheDocument();
  });

  it("liste des pays indisponible : les annonces restent consultables, avec le seul choix « Tous les pays »", async () => {
    servir([reponse([annonce("a1", "Villa Baobab")])], new Error("réseau coupé"));
    afficher();

    expect(await screen.findByText("Villa Baobab")).toBeInTheDocument();
    const choix = screen.getByRole("combobox", { name: "Filtrer par pays" }) as HTMLSelectElement;
    expect(choix.options).toHaveLength(1);
    expect(choix.options[0]).toHaveTextContent("Tous les pays");
  });

  describe("pagination", () => {
    it("« Suivant » demande la page suivante, « Précédent » revient, et chaque bouton s'arrête à sa borne", async () => {
      const user = userEvent.setup();
      servir([
        reponse([annonce("a1", "Annonce page un")], 1, 3),
        reponse([annonce("a2", "Annonce page deux")], 2, 3),
        reponse([annonce("a3", "Annonce page trois")], 3, 3),
        reponse([annonce("a2", "Annonce page deux")], 2, 3),
      ]);
      afficher();
      await screen.findByText("Annonce page un");
      expect(screen.getByText("Page 1 sur 3")).toBeInTheDocument();
      expect(pagination().getByRole("button", { name: "Précédent" })).toBeDisabled();

      await user.click(pagination().getByRole("button", { name: "Suivant" }));
      expect(await screen.findByText("Annonce page deux")).toBeInTheDocument();
      expect(screen.getByText("Page 2 sur 3")).toBeInTheDocument();

      await user.click(pagination().getByRole("button", { name: "Suivant" }));
      expect(await screen.findByText("Annonce page trois")).toBeInTheDocument();
      expect(pagination().getByRole("button", { name: "Suivant" })).toBeDisabled();

      await user.click(pagination().getByRole("button", { name: "Précédent" }));
      expect(await screen.findByText("Annonce page deux")).toBeInTheDocument();
      expect(appelsListe().map(pageDemandee)).toEqual([1, 2, 3, 2]);
    });

    it("choisir un pays revient aussi à la première page, avec le pays demandé", async () => {
      const user = userEvent.setup();
      servir(
        [reponse([annonce("a1", "Annonce page un")], 1, 3), reponse([annonce("a2", "Annonce page deux")], 2, 3), reponse([annonce("a7", "Annonce sénégalaise")], 1, 1)],
        ["SN", "CI"]
      );
      afficher();
      await screen.findByText("Annonce page un");
      await user.click(pagination().getByRole("button", { name: "Suivant" }));
      await screen.findByText("Annonce page deux");
      await waitFor(() => expect((screen.getByRole("combobox", { name: "Filtrer par pays" }) as HTMLSelectElement).options.length).toBeGreaterThan(1));

      await user.selectOptions(screen.getByRole("combobox", { name: "Filtrer par pays" }), "SN");

      expect(await screen.findByText("Annonce sénégalaise")).toBeInTheDocument();
      const dernier = appelsListe()[2][1] as { params: { page: number; country: string } };
      expect(dernier.params).toMatchObject({ page: 1, country: "SN" });
    });

    it("pas de pagination quand tout tient sur une page", async () => {
      servir([reponse([annonce("a1", "Villa Baobab")], 1, 1)]);
      afficher();
      await screen.findByText("Villa Baobab");

      expect(screen.queryByText(/^Page \d+ sur \d+$/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Précédent" })).not.toBeInTheDocument();
    });

    it("changer de filtre revient à la première page", async () => {
      const user = userEvent.setup();
      servir([
        reponse([annonce("a1", "Annonce page un")], 1, 3),
        reponse([annonce("a2", "Annonce page deux")], 2, 3),
        reponse([annonce("a9", "Annonce vente")], 1, 1),
      ]);
      afficher();
      await screen.findByText("Annonce page un");
      await user.click(pagination().getByRole("button", { name: "Suivant" }));
      await screen.findByText("Annonce page deux");

      await user.click(within(screen.getByRole("group", { name: "Filtrer par type" })).getByRole("button", { name: "Vente" }));

      expect(await screen.findByText("Annonce vente")).toBeInTheDocument();
      await waitFor(() => expect(appelsListe()).toHaveLength(3));
      const dernier = appelsListe()[2][1] as { params: { page: number; type: string } };
      expect(dernier.params).toMatchObject({ page: 1, type: "SALE" });
    });
  });
});
