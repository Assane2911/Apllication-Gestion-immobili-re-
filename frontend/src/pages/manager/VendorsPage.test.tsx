import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { Vendor } from "../../types";
import VendorsPage from "./VendorsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function vendor(overrides: Partial<Vendor> = {}): Vendor {
  return {
    id: "ven-1",
    name: "Plomberie Fall",
    trade: "Plombier",
    phone: "+221770001122",
    email: "fall@example.com",
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderPage() {
  return render(<VendorsPage />);
}

describe("VendorsPage (manager)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    mockedApi.put.mockReset();
    mockedApi.delete.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("affiche la liste des prestataires (nom, métier, téléphone, email)", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [vendor()] });
    renderPage();

    await waitFor(() => expect(screen.getByText("Plomberie Fall")).toBeInTheDocument());
    expect(screen.getByText("Plombier")).toBeInTheDocument();
    expect(screen.getByText("+221770001122")).toBeInTheDocument();
    expect(screen.getByText("fall@example.com")).toBeInTheDocument();
  });

  it("affiche l'état vide avec un bouton d'ajout", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [] });
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucun prestataire pour l'instant")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "+ Ajouter un prestataire" }).length).toBeGreaterThan(0);
  });

  it("affiche une erreur de chargement avec un bouton réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce({ data: [vendor()] });
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("Plomberie Fall")).toBeInTheDocument());
  });

  it("crée un prestataire : envoie les champs renseignés, sans les champs facultatifs vides", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: [] });
    mockedApi.post.mockResolvedValueOnce({ data: { id: "ven-new" } });
    mockedApi.get.mockResolvedValueOnce({ data: [vendor({ id: "ven-new" })] });

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "+ Ajouter un prestataire" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "+ Ajouter un prestataire" })[0]);

    await user.type(screen.getByLabelText("Nom"), "Électricité Ndoye");
    await user.type(screen.getByLabelText("Téléphone"), "77 000 11 22");

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
    const [url, body] = mockedApi.post.mock.calls[0];
    expect(url).toBe("/vendors");
    expect(body).toMatchObject({
      name: "Électricité Ndoye",
      phone: "+221770001122",
      trade: undefined,
      email: undefined,
      notes: undefined,
    });

    await waitFor(() => expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument());
  });

  it("modifie un prestataire existant : pré-remplit le formulaire et envoie une requête PUT", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: [vendor({ id: "ven-1", trade: "Plombier" })] });
    mockedApi.put.mockResolvedValueOnce({ data: {} });
    mockedApi.get.mockResolvedValueOnce({ data: [vendor({ id: "ven-1", name: "Plomberie Fall & Fils" })] });

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Modifier" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "Modifier" })[0]);

    const nameInput = screen.getByLabelText("Nom") as HTMLInputElement;
    expect(nameInput.value).toBe("Plomberie Fall");
    expect((screen.getByLabelText("Métier") as HTMLInputElement).value).toBe("Plombier");
    await user.clear(nameInput);
    await user.type(nameInput, "Plomberie Fall & Fils");

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalledTimes(1));
    const [url, body] = mockedApi.put.mock.calls[0];
    expect(url).toBe("/vendors/ven-1");
    expect(body).toMatchObject({ name: "Plomberie Fall & Fils" });
  });

  it("supprime un prestataire après confirmation", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({ data: [vendor({ id: "ven-1" })] });
    mockedApi.delete.mockResolvedValueOnce({ data: {} });
    mockedApi.get.mockResolvedValueOnce({ data: [] });

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Supprimer" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "Supprimer" })[0]);

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/vendors/ven-1"));
  });
});
