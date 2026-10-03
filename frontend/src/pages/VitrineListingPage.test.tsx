import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { Listing } from "../types";
import VitrineListingPage from "./VitrineListingPage";

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

function renderPage(id = "list-1") {
  return render(
    <MemoryRouter initialEntries={[`/vitrine/annonces/${id}`]}>
      <Routes>
        <Route path="/vitrine/annonces/:id" element={<VitrineListingPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("VitrineListingPage (fiche annonce individuelle)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
  });

  it("affiche la fiche complète de l'annonce et met à jour le titre de l'onglet", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: listing() });
    renderPage();

    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Appartement 2 pièces vue mer" })).toBeInTheDocument());
    expect(mockedApi.get).toHaveBeenCalledWith("/listings/public/list-1", { signal: expect.anything() });
    expect(screen.getByText("Bel appartement lumineux proche des commodités, à deux pas de la plage.")).toBeInTheDocument();
    expect(screen.getByText("Contacter l'agence")).toBeInTheDocument();
    expect(document.title).toContain("Appartement 2 pièces vue mer");
  });

  it("affiche un message dédié quand l'annonce n'existe plus", async () => {
    mockedApi.get.mockRejectedValueOnce({ response: { status: 404 }, isAxiosError: true });
    renderPage();

    await waitFor(() => expect(screen.getByText("Cette annonce n'est plus disponible.")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Voir toutes les annonces" })).toHaveAttribute("href", "/vitrine");
  });

  it("soumet une demande de visite depuis la fiche", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: listing() });
    mockedApi.post.mockResolvedValueOnce({ data: { message: "Demande envoyée avec succès" } });

    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Appartement 2 pièces vue mer" })).toBeInTheDocument());

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
});
