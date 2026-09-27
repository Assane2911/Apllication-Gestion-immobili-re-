import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { Owner, PaginatedResponse } from "../../types";
import OwnersPage from "./OwnersPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function owner(overrides: Partial<Owner> = {}): Owner {
  return {
    id: "own-1",
    civility: "MME",
    firstName: "Awa",
    lastName: "Diallo",
    companyName: null,
    email: "awa@example.com",
    phone: "+221771223344",
    address: null,
    iban: null,
    bic: null,
    managementFeeRate: 8,
    notes: null,
    portalStatus: "NONE",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function paginated(items: Owner[]): { data: PaginatedResponse<Owner> } {
  return { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 } };
}

function renderPage() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <MemoryRouter>
          <OwnersPage />
        </MemoryRouter>
      </CurrencyProvider>
    </AuthProvider>
  );
}

describe("OwnersPage (manager)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    mockedApi.put.mockReset();
    mockedApi.delete.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("affiche la liste des propriétaires (nom, téléphone, email, commission)", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([owner()]));
    renderPage();

    await waitFor(() => expect(screen.getAllByText("Awa Diallo").length).toBeGreaterThan(0));
    expect(screen.getAllByText("+221771223344").length).toBeGreaterThan(0);
    expect(screen.getAllByText("awa@example.com").length).toBeGreaterThan(0);
    expect(screen.getAllByText("8%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Aucun accès").length).toBeGreaterThan(0);
  });

  it("affiche l'état vide avec un bouton d'ajout", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([]));
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucun propriétaire pour l'instant")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "+ Ajouter un propriétaire" }).length).toBeGreaterThan(0);
  });

  it("affiche une erreur de chargement avec un bouton réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce(paginated([owner()]));
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getAllByText("Awa Diallo").length).toBeGreaterThan(0));
  });

  it("crée un propriétaire : envoie les champs renseignés, sans les champs facultatifs vides", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([]));
    mockedApi.post.mockResolvedValueOnce({ data: { id: "own-new" } });
    mockedApi.get.mockResolvedValueOnce(paginated([owner({ id: "own-new" })]));

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "+ Ajouter un propriétaire" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "+ Ajouter un propriétaire" })[0]);

    await user.type(screen.getByLabelText("Prénom"), "Moussa");
    await user.type(screen.getByLabelText("Nom"), "Traoré");
    await user.type(screen.getByLabelText("Téléphone"), "77 122 33 44");
    await user.type(screen.getByLabelText("Email"), "moussa@example.com");
    await user.clear(screen.getByLabelText("Taux de commission (%)"));
    await user.type(screen.getByLabelText("Taux de commission (%)"), "10");

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
    const [url, body] = mockedApi.post.mock.calls[0];
    expect(url).toBe("/owners");
    expect(body).toMatchObject({
      firstName: "Moussa",
      lastName: "Traoré",
      email: "moussa@example.com",
      phone: "+221771223344",
      managementFeeRate: "10",
      civility: undefined,
      companyName: undefined,
      address: undefined,
      iban: undefined,
      bic: undefined,
      notes: undefined,
    });

    await waitFor(() => expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument());
  });

  it("modifie un propriétaire existant : pré-remplit le formulaire et envoie une requête PUT", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([owner({ id: "own-1", companyName: "SCI Diallo" })]));
    mockedApi.put.mockResolvedValueOnce({ data: {} });
    mockedApi.get.mockResolvedValueOnce(paginated([owner({ id: "own-1", lastName: "Diallo-Ndiaye" })]));

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Modifier" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "Modifier" })[0]);

    const lastNameInput = screen.getByLabelText("Nom") as HTMLInputElement;
    expect(lastNameInput.value).toBe("Diallo");
    expect((screen.getByLabelText("Raison sociale (optionnel)") as HTMLInputElement).value).toBe("SCI Diallo");
    await user.clear(lastNameInput);
    await user.type(lastNameInput, "Diallo-Ndiaye");

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalledTimes(1));
    const [url, body] = mockedApi.put.mock.calls[0];
    expect(url).toBe("/owners/own-1");
    expect(body).toMatchObject({ lastName: "Diallo-Ndiaye", companyName: "SCI Diallo" });
  });

  it("supprime un propriétaire après confirmation", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([owner({ id: "own-1" })]));
    mockedApi.delete.mockResolvedValueOnce({ data: {} });
    mockedApi.get.mockResolvedValueOnce(paginated([]));

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Supprimer" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "Supprimer" })[0]);

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/owners/own-1"));
  });

  it("invite un propriétaire sans accès portail, puis affiche la confirmation d'envoi", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(paginated([owner({ id: "own-1", portalStatus: "NONE" })]));
    mockedApi.post.mockResolvedValueOnce({ data: {} });
    mockedApi.get.mockResolvedValueOnce(paginated([owner({ id: "own-1", portalStatus: "PENDING" })]));

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Inviter" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "Inviter" })[0]);

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/owners/own-1/invite"));
    await waitFor(() => expect(screen.getAllByText("Invitation envoyée avec succès.").length).toBeGreaterThan(0));
  });
});
