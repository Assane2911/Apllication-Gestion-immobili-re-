import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { PaginatedResponse, Property } from "../../types";
import PropertiesPage from "./PropertiesPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function property(overrides: Partial<Property> = {}): Property {
  return {
    id: "prop-1",
    title: "Studio Centre-ville",
    address: "1 rue de la Paix",
    surface: 30,
    rent: 500,
    currency: "EUR",
    status: "AVAILABLE",
    description: null,
    imageUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function paginated(items: Property[]): { data: PaginatedResponse<Property> } {
  return { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 } };
}

function renderPage() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <PropertiesPage />
      </CurrencyProvider>
    </AuthProvider>
  );
}

// Vérifie le contenu d'un FormData sans dépendre de l'égalité stricte
// (toHaveBeenCalledWith ne compare pas bien les instances de FormData).
function formDataEntries(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  fd.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

// Les <label> du formulaire ne sont pas associés aux champs (pas de htmlFor) :
// on cible donc les champs par rôle + ordre d'apparition dans le DOM plutôt
// que par getByLabelText, qui ne trouverait aucune association.
// Ordre des champs "textbox" (input texte + textarea) : Titre, Adresse, Description.
// Ordre des champs "spinbutton" (input number) : Surface, Loyer.
function getFormFields() {
  const textboxes = screen.getAllByRole("textbox");
  const spinbuttons = screen.getAllByRole("spinbutton");
  return {
    title: textboxes[0],
    address: textboxes[1],
    description: textboxes[2],
    surface: spinbuttons[0],
    rent: spinbuttons[1],
    status: screen.getByRole("combobox"),
  };
}

describe("PropertiesPage (manager)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    mockedApi.put.mockReset();
    mockedApi.delete.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("affiche la liste des biens avec statut, surface et loyer", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([property()]));
    renderPage();

    await waitFor(() => expect(screen.getByText("Studio Centre-ville")).toBeInTheDocument());
    expect(screen.getByText("1 rue de la Paix")).toBeInTheDocument();
    expect(screen.getByText("30 m²")).toBeInTheDocument();
    expect(screen.getByText(/500 €/)).toBeInTheDocument();
    expect(screen.getByText("Disponible")).toBeInTheDocument();
  });

  it("affiche l'état vide avec un bouton d'ajout quand il n'y a aucun bien", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([]));
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucun bien pour l'instant")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "+ Ajouter un bien" }).length).toBeGreaterThan(0);
  });

  it("affiche une erreur de chargement avec un bouton réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce(paginated([property()]));
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("Studio Centre-ville")).toBeInTheDocument());
  });

  it("crée un bien : envoie un FormData avec les bons champs, y compris l'image", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([]));
    mockedApi.post.mockResolvedValueOnce({ data: { id: "prop-new" } });
    mockedApi.get.mockResolvedValueOnce(paginated([property({ id: "prop-new" })]));

    const { container } = renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "+ Ajouter un bien" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "+ Ajouter un bien" })[0]);

    const fields = getFormFields();
    await user.type(fields.title, "Loft Lumineux");
    await user.type(fields.address, "10 avenue des Fleurs");
    await user.type(fields.surface, "45");
    await user.type(fields.rent, "750");
    await user.selectOptions(fields.status, "MAINTENANCE");
    await user.type(fields.description, "Beau volume, lumière naturelle");

    const file = new File(["fake-image-content"], "photo.jpg", { type: "image/jpeg" });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
    const [url, formData] = mockedApi.post.mock.calls[0];
    expect(url).toBe("/properties");
    const entries = formDataEntries(formData as FormData);
    expect(entries.title).toBe("Loft Lumineux");
    expect(entries.address).toBe("10 avenue des Fleurs");
    expect(entries.surface).toBe("45");
    expect(entries.rent).toBe("750");
    expect(entries.status).toBe("MAINTENANCE");
    expect(entries.description).toBe("Beau volume, lumière naturelle");
    expect((entries.image as File).name).toBe("photo.jpg");

    await waitFor(() => expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument());
  });

  it("modifie un bien existant : pré-remplit le formulaire et envoie une requête PUT", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([property({ id: "prop-1", title: "Studio Centre-ville" })]));
    mockedApi.put.mockResolvedValueOnce({ data: {} });
    mockedApi.get.mockResolvedValueOnce(paginated([property({ id: "prop-1", title: "Studio Rénové" })]));

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Modifier" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Modifier" }));

    const fields = getFormFields();
    const titleInput = fields.title as HTMLInputElement;
    expect(titleInput.value).toBe("Studio Centre-ville");
    await user.clear(titleInput);
    await user.type(titleInput, "Studio Rénové");

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalledTimes(1));
    const [url, formData] = mockedApi.put.mock.calls[0];
    expect(url).toBe("/properties/prop-1");
    expect(formDataEntries(formData as FormData).title).toBe("Studio Rénové");
  });

  it("supprime un bien après confirmation", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([property({ id: "prop-1" })]));
    mockedApi.delete.mockResolvedValueOnce({ data: {} });
    mockedApi.get.mockResolvedValueOnce(paginated([]));

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Supprimer" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/properties/prop-1"));
  });
});
