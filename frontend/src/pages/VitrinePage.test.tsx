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

  it("affiche un message dédié quand aucune annonce ne correspond", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([]));
    mockedApi.get.mockResolvedValueOnce({ data: { countries: [] } });
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucune annonce ne correspond à ces critères pour le moment.")).toBeInTheDocument());
  });

  it("ouvre la fiche d'une annonce et affiche sa description complète", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([listing()]));
    mockedApi.get.mockResolvedValueOnce({ data: { countries: ["SN"] } });
    renderPage();

    await waitFor(() => expect(screen.getByText("Appartement 2 pièces vue mer")).toBeInTheDocument());
    await userEvent.setup().click(screen.getByText("Appartement 2 pièces vue mer"));

    expect(screen.getByText("Bel appartement lumineux proche des commodités, à deux pas de la plage.")).toBeInTheDocument();
    expect(screen.getByText("Contacter l'agence")).toBeInTheDocument();
  });

  it("soumet une demande de visite depuis la fiche annonce", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([listing()]));
    mockedApi.get.mockResolvedValueOnce({ data: { countries: ["SN"] } });
    mockedApi.post.mockResolvedValueOnce({ data: { message: "Demande envoyée avec succès" } });

    renderPage();
    await waitFor(() => expect(screen.getByText("Appartement 2 pièces vue mer")).toBeInTheDocument());
    await user.click(screen.getByText("Appartement 2 pièces vue mer"));

    await user.type(screen.getByLabelText("Nom complet"), "Moussa Fall");
    await user.type(screen.getByLabelText("Email"), "moussa@example.com");
    await user.type(screen.getByLabelText("Téléphone"), "+221 76 000 00 00");
    await user.type(screen.getByLabelText("Message (optionnel)"), "Je souhaite visiter samedi.");

    await user.click(screen.getByRole("button", { name: "Envoyer la demande" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
    const [url, body] = mockedApi.post.mock.calls[0];
    expect(url).toBe("/listings/public/list-1/leads");
    expect(body).toMatchObject({
      prospectName: "Moussa Fall",
      prospectEmail: "moussa@example.com",
      prospectPhone: "+221 76 000 00 00",
      requestType: "VISIT",
      message: "Je souhaite visiter samedi.",
    });

    await waitFor(() => expect(screen.getByText(/Votre demande a bien été envoyée/)).toBeInTheDocument());
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
