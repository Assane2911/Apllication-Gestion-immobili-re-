import { render, screen, waitFor, within } from "@testing-library/react";
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
    localStorage.removeItem("immo.favoris-vitrine");
  });

  it("affiche la fiche complète de l'annonce et met à jour le titre de l'onglet", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: listing() });
    renderPage();

    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Appartement 2 pièces vue mer" })).toBeInTheDocument());
    expect(mockedApi.get).toHaveBeenCalledWith("/listings/public/list-1", { signal: expect.anything() });
    expect(screen.getByText("Bel appartement lumineux proche des commodités, à deux pas de la plage.")).toBeInTheDocument();
    expect(screen.getByText("Contacter l'agence")).toBeInTheDocument();
    expect(document.title).toContain("Appartement 2 pièces vue mer");
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://www.immoplatformpro.com/vitrine/annonces/list-1"
    );
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      "Bel appartement lumineux proche des commodités, à deux pas de la plage."
    );

    const script = document.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    const data = JSON.parse(script!.innerHTML);
    expect(data["@type"]).toBe("RealEstateListing");
    expect(data.name).toBe("Appartement 2 pièces vue mer");
    expect(data.offers.price).toBe(450);
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

  it("propose de joindre l'agence directement, seulement par les moyens qu'elle a renseignés", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: listing({ contactPhone: "+221 76 000 00 00", contactWhatsapp: "+221 77 111 22 33", contactEmail: "agence@test.local" }) });
    const { unmount } = renderPage();

    expect(await screen.findByRole("link", { name: "Appeler l'agence" })).toHaveAttribute("href", "tel:+221760000000");
    expect(screen.getByRole("link", { name: "Écrire sur WhatsApp" })).toHaveAttribute("href", "https://wa.me/221771112233");
    expect(screen.getByRole("link", { name: "Écrire par email" })).toHaveAttribute("href", expect.stringContaining("mailto:agence@test.local"));
    unmount();

    mockedApi.get.mockResolvedValueOnce({ data: listing({ contactEmail: "agence@test.local" }) });
    renderPage();
    await screen.findByRole("link", { name: "Écrire par email" });
    expect(screen.queryByRole("link", { name: "Appeler l'agence" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Écrire sur WhatsApp" })).not.toBeInTheDocument();
  });

  it("n'affiche aucun bloc de contact direct quand l'agence n'a renseigné aucun moyen", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: listing() });
    renderPage();

    await screen.findByRole("heading", { level: 1, name: "Appartement 2 pièces vue mer" });
    expect(screen.queryByText("Contact direct")).not.toBeInTheDocument();
  });

  it("calcule le prix au m² (loyer par mois) et liste les caractéristiques", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: listing({ price: 550, surface: 55 }) });
    renderPage();

    const caracteristiques = within(await screen.findByRole("region", { name: "Caractéristiques" }));
    expect(caracteristiques.getByText("10 EUR / m² / mois")).toBeInTheDocument();
    expect(caracteristiques.getByText("55 m²")).toBeInTheDocument();
    expect(caracteristiques.getByText("2 pièce(s)")).toBeInTheDocument();
    expect(caracteristiques.getByText("Sénégal")).toBeInTheDocument();
  });

  it("n'invente pas de prix au m² quand la surface n'est pas renseignée", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: listing({ surface: null }) });
    renderPage();

    const caracteristiques = within(await screen.findByRole("region", { name: "Caractéristiques" }));
    expect(caracteristiques.queryByText("Prix au m²")).not.toBeInTheDocument();
  });

  it("met l'annonce de côté depuis sa fiche", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: listing() });
    renderPage();

    const bouton = await screen.findByRole("button", { name: "Mettre de côté" });
    await user.click(bouton);
    expect(screen.getByRole("button", { name: "Mise de côté" })).toHaveAttribute("aria-pressed", "true");
    expect(JSON.parse(localStorage.getItem("immo.favoris-vitrine") ?? "[]")).toHaveLength(1);
  });

  it("montre des annonces similaires, sans l'annonce courante, et se passe d'elles si leur chargement échoue", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: listing() });
    mockedApi.get.mockResolvedValueOnce({
      data: {
        items: [listing(), listing({ id: "autre", title: "Studio Plateau" })],
        page: 1,
        pageSize: 4,
        total: 2,
        totalPages: 1,
      },
    });
    const { unmount } = renderPage();

    const similaires = within(await screen.findByRole("region", { name: "Annonces similaires" }));
    expect(similaires.getByText("Studio Plateau")).toBeInTheDocument();
    expect(similaires.queryByText("Appartement 2 pièces vue mer")).not.toBeInTheDocument();
    expect(mockedApi.get).toHaveBeenCalledWith("/listings/public", { params: { page: 1, pageSize: 4, type: "RENT", country: "SN" } });
    unmount();

    mockedApi.get.mockResolvedValueOnce({ data: listing() });
    mockedApi.get.mockRejectedValueOnce(new Error("réseau"));
    renderPage();
    await screen.findByRole("heading", { level: 1, name: "Appartement 2 pièces vue mer" });
    expect(screen.queryByRole("region", { name: "Annonces similaires" })).not.toBeInTheDocument();
  });
});
