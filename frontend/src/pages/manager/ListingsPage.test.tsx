import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { Listing, PaginatedResponse } from "../../types";
import ListingsPage from "./ListingsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: "list-1",
    type: "RENT",
    title: "Appartement 2 pièces vue mer",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function paginated(items: Listing[]): { data: PaginatedResponse<Listing> } {
  return { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 } };
}

function renderPage() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <MemoryRouter>
          <ListingsPage />
        </MemoryRouter>
      </CurrencyProvider>
    </AuthProvider>
  );
}

function formDataEntries(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  fd.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

describe("ListingsPage (manager)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    mockedApi.put.mockReset();
    mockedApi.delete.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("affiche la liste des annonces avec statut, type et prix", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([listing()]));
    renderPage();

    await waitFor(() => expect(screen.getByText("Appartement 2 pièces vue mer")).toBeInTheDocument());
    expect(screen.getByText(/Dakar, Almadies/)).toBeInTheDocument();
    expect(screen.getByText("Location")).toBeInTheDocument();
    expect(screen.getByText("Publiée")).toBeInTheDocument();
    expect(screen.getByText(/450 €/)).toBeInTheDocument();
  });

  it("affiche l'état vide avec un bouton d'ajout quand il n'y a aucune annonce", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([]));
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucune annonce pour l'instant")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "+ Nouvelle annonce" }).length).toBeGreaterThan(0);
  });

  it("affiche une erreur de chargement avec un bouton réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce(paginated([listing()]));
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("Appartement 2 pièces vue mer")).toBeInTheDocument());
  });

  it("propose la devise du pays choisi, sans l'imposer", async () => {
    // `data/pays.ts` porte la devise de chaque pays : une annonce à Dakar
    // s'affiche en FCFA sans qu'on ait à y penser. La devise reste modifiable
    // juste à côté — un bien peut être libellé dans une autre monnaie que
    // celle du lieu.
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValue(paginated([]));

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "+ Nouvelle annonce" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "+ Nouvelle annonce" })[0]);

    const devise = screen.getByLabelText("Devise") as HTMLSelectElement;
    expect(devise.tagName).toBe("SELECT");
    expect(devise.value).toBe("EUR");

    await user.selectOptions(screen.getByLabelText("Pays"), "SN");
    expect(devise.value).toBe("XOF");

    await user.selectOptions(devise, "USD");
    expect(devise.value).toBe("USD");
  });

  it("crée une annonce : envoie un FormData avec les bons champs, y compris featured et l'image", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([]));
    mockedApi.post.mockResolvedValueOnce({ data: { id: "list-new" } });
    mockedApi.get.mockResolvedValueOnce(paginated([listing({ id: "list-new" })]));

    const { container } = renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "+ Nouvelle annonce" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "+ Nouvelle annonce" })[0]);

    await user.type(screen.getByLabelText("Titre"), "Studio meublé centre-ville");
    await user.type(screen.getByLabelText("Prix"), "300");
    await user.type(screen.getByLabelText("Localisation"), "Abidjan, Cocody");
    // La devise n'est plus un champ libre mais une liste : choisir la Côte
    // d'Ivoire propose le franc CFA, ce que le test vérifie plus bas.
    await user.selectOptions(screen.getByLabelText("Pays"), "CI");
    await user.click(screen.getByLabelText("Mettre en avant (à la une de la vitrine)"));
    await user.type(screen.getByLabelText("Description"), "Studio calme et sécurisé.");

    const file = new File(["fake-image-content"], "photo.jpg", { type: "image/jpeg" });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
    const [url, formData] = mockedApi.post.mock.calls[0];
    expect(url).toBe("/listings");
    const entries = formDataEntries(formData as FormData);
    expect(entries.title).toBe("Studio meublé centre-ville");
    expect(entries.price).toBe("300");
    expect(entries.currency).toBe("XOF");
    expect(entries.location).toBe("Abidjan, Cocody");
    expect(entries.country).toBe("CI");
    expect(entries.featured).toBe("true");
    expect(entries.description).toBe("Studio calme et sécurisé.");
    expect((entries.image as File).name).toBe("photo.jpg");

    await waitFor(() => expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument());
  });

  it("modifie une annonce existante : pré-remplit le formulaire et envoie une requête PUT", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([listing({ id: "list-1", title: "Appartement 2 pièces vue mer" })]));
    mockedApi.put.mockResolvedValueOnce({ data: {} });
    mockedApi.get.mockResolvedValueOnce(paginated([listing({ id: "list-1", title: "Appartement rénové vue mer" })]));

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Modifier" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Modifier" }));

    const titleInput = screen.getByLabelText("Titre") as HTMLInputElement;
    expect(titleInput.value).toBe("Appartement 2 pièces vue mer");
    await user.clear(titleInput);
    await user.type(titleInput, "Appartement rénové vue mer");

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalledTimes(1));
    const [url, formData] = mockedApi.put.mock.calls[0];
    expect(url).toBe("/listings/list-1");
    expect(formDataEntries(formData as FormData).title).toBe("Appartement rénové vue mer");
    // featured n'était pas coché sur cette annonce : la case décochée doit
    // bien renvoyer la chaîne "false" (jamais omise), sans quoi le backend
    // (booleanField) ne pourrait pas distinguer "non modifié" de "décoché".
    expect(formDataEntries(formData as FormData).featured).toBe("false");
  });

  it("supprime une annonce après confirmation", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([listing({ id: "list-1" })]));
    mockedApi.delete.mockResolvedValueOnce({ data: {} });
    mockedApi.get.mockResolvedValueOnce(paginated([]));

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Supprimer" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/listings/list-1"));
  });
});
