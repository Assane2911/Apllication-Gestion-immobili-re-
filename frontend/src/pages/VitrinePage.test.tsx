import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: "list-1",
    type: "RENT",
    title: "Appartement 2 pièces vue mer",
    description: "Bel appartement lumineux proche des commodités, à deux pas de la plage.",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function paginated(items: Listing[]): { data: PaginatedResponse<Listing> } {
  return { data: { items, page: 1, pageSize: 12, total: items.length, totalPages: 1 } };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <VitrinePage />
    </MemoryRouter>
  );
}

describe("VitrinePage (vitrine publique)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    localStorage.removeItem("immo.favoris-vitrine");
  });

  it("affiche les annonces publiées avec prix et localisation", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([listing()]));
    mockedApi.get.mockResolvedValueOnce({ data: { countries: ["SN", "CI"] } });
    renderPage();

    await waitFor(() => expect(screen.getByText("Appartement 2 pièces vue mer")).toBeInTheDocument());
    expect(screen.getByText(/Dakar, Almadies/)).toBeInTheDocument();
    expect(screen.getByText("450 EUR")).toBeInTheDocument();
  });

  it("définit un titre d'onglet et une meta description propres à la page", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([listing()]));
    mockedApi.get.mockResolvedValueOnce({ data: { countries: ["SN"] } });
    renderPage();

    await waitFor(() => expect(document.title).toBe("Annonces immobilières — Locations, ventes, terrains | ImmoPlatform Pro"));
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      "Parcourez les annonces publiées par nos agences partenaires : locations, ventes, terrains et promotions immobilières en France et en Afrique francophone."
    );
  });

  it("affiche un message dédié quand aucune annonce ne correspond", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([]));
    mockedApi.get.mockResolvedValueOnce({ data: { countries: [] } });
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucune annonce ne correspond à ces critères pour le moment.")).toBeInTheDocument());
  });

  // Régression. Le détail d'une annonce ne s'ouvrait que dans une modale JS,
  // sans URL propre : invisible pour Google et impossible à partager. Chaque
  // annonce a maintenant sa propre page (/vitrine/annonces/:id) — voir
  // VitrineListingPage.test.tsx pour son contenu.
  it("lie chaque annonce vers sa propre page plutôt que d'ouvrir une modale", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([listing()]));
    mockedApi.get.mockResolvedValueOnce({ data: { countries: ["SN"] } });
    renderPage();

    await waitFor(() => expect(screen.getByText("Appartement 2 pièces vue mer")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Appartement 2 pièces vue mer/ })).toHaveAttribute(
      "href",
      "/vitrine/annonces/list-1"
    );
  });

  it("filtre par pays et relance l'appel avec le paramètre country", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([listing()]));
    mockedApi.get.mockResolvedValueOnce({ data: { countries: ["SN", "CI"] } });
    renderPage();
    await waitFor(() => expect(screen.getByText("Appartement 2 pièces vue mer")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce(paginated([]));
    await userEvent.setup().selectOptions(screen.getByLabelText("Filtrer par pays"), "CI");

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/listings/public", {
        params: { page: 1, pageSize: 12, country: "CI" },
        signal: expect.anything(),
      })
    );
  });

  it("l'en-tête de la vitrine propose Retour et Suivant, comme les espaces connectés", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([listing()]));
    mockedApi.get.mockResolvedValueOnce({ data: { countries: ["SN"] } });
    renderPage();

    expect(await screen.findByRole("button", { name: "Retour" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suivant" })).toBeInTheDocument();
  });

  it("indique le nombre d'annonces trouvées", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { items: [listing()], page: 1, pageSize: 12, total: 27, totalPages: 3 } });
    mockedApi.get.mockResolvedValueOnce({ data: { countries: ["SN"] } });
    renderPage();

    expect(await screen.findByText("27 annonce(s)")).toBeInTheDocument();
  });

  it("filtre par type d'un clic sur un onglet, et revient à tous les types", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([listing()]));
    mockedApi.get.mockResolvedValueOnce({ data: { countries: ["SN"] } });
    renderPage();
    await screen.findByText("Appartement 2 pièces vue mer");

    mockedApi.get.mockResolvedValueOnce(paginated([]));
    const onglets = within(screen.getByRole("group", { name: "Filtrer par type" }));
    await user.click(onglets.getByRole("button", { name: "Vente" }));
    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/listings/public", { params: { page: 1, pageSize: 12, type: "SALE" }, signal: expect.anything() })
    );
    expect(onglets.getByRole("button", { name: "Vente" })).toHaveAttribute("aria-pressed", "true");

    mockedApi.get.mockResolvedValueOnce(paginated([listing()]));
    await user.click(onglets.getByRole("button", { name: "Tous les types" }));
    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/listings/public", { params: { page: 1, pageSize: 12 }, signal: expect.anything() })
    );
  });

  it("propose de réinitialiser les filtres quand il y en a d'actifs, et pas sinon", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([listing()]));
    mockedApi.get.mockResolvedValueOnce({ data: { countries: ["SN", "CI"] } });
    renderPage();
    await screen.findByText("Appartement 2 pièces vue mer");
    expect(screen.queryByRole("button", { name: "Réinitialiser les filtres" })).not.toBeInTheDocument();

    mockedApi.get.mockResolvedValueOnce(paginated([]));
    await user.selectOptions(screen.getByLabelText("Filtrer par pays"), "CI");
    mockedApi.get.mockResolvedValueOnce(paginated([listing()]));
    const reset = (await screen.findAllByRole("button", { name: "Réinitialiser les filtres" }))[0];
    await user.click(reset);

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/listings/public", { params: { page: 1, pageSize: 12 }, signal: expect.anything() })
    );
  });

  it("met une annonce de côté, la retrouve dans « Mes favoris » et la garde d'une visite à l'autre", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([listing()]));
    mockedApi.get.mockResolvedValueOnce({ data: { countries: ["SN"] } });
    const { unmount } = renderPage();
    await screen.findByText("Appartement 2 pièces vue mer");

    const coeur = screen.getByRole("button", { name: "Ajouter « Appartement 2 pièces vue mer » aux favoris" });
    expect(coeur).toHaveAttribute("aria-pressed", "false");
    await user.click(coeur);
    expect(screen.getByRole("button", { name: "Retirer « Appartement 2 pièces vue mer » des favoris" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Mes favoris · 1" })).toBeInTheDocument();
    unmount();

    // Nouvelle visite : l'annonce est toujours là, même si le serveur ne la renvoie plus.
    mockedApi.get.mockResolvedValueOnce(paginated([]));
    mockedApi.get.mockResolvedValueOnce({ data: { countries: [] } });
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Mes favoris · 1" }));
    expect(screen.getByText("Appartement 2 pièces vue mer")).toBeInTheDocument();
  });

  it("dit comment mettre une annonce de côté quand il n'y a encore aucun favori", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([listing()]));
    mockedApi.get.mockResolvedValueOnce({ data: { countries: ["SN"] } });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Mes favoris · 0" }));
    expect(screen.getByText(/Touchez le cœur d'une annonce/)).toBeInTheDocument();
  });

  it("signale « Nouveau » une annonce publiée depuis moins de deux semaines, et pas une ancienne", async () => {
    mockedApi.get.mockResolvedValueOnce(
      paginated([
        listing({ id: "recente", title: "Studio récent", createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString() }),
        listing({ id: "ancienne", title: "Villa ancienne", createdAt: "2025-01-01T00:00:00.000Z" }),
      ])
    );
    mockedApi.get.mockResolvedValueOnce({ data: { countries: ["SN"] } });
    renderPage();

    await screen.findByText("Studio récent");
    expect(screen.getAllByText("Nouveau")).toHaveLength(1);
  });
});
