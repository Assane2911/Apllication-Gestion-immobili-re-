import { render, screen, waitFor } from "@testing-library/react";
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
});
