import { render, screen, waitFor, within } from "@testing-library/react";
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
    // « Plombier » figure sur la fiche et dans l'onglet de filtre.
    const fiche = screen.getByRole("article");
    expect(within(fiche).getByText("Plombier")).toBeInTheDocument();
    expect(screen.getByText("+221770001122")).toBeInTheDocument();
    expect(screen.getByText("fall@example.com")).toBeInTheDocument();
  });

  it("filtre le carnet par métier (onglets) et par recherche", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({
      data: [
        vendor({ id: "v1", name: "Plomberie Fall", trade: "Plombier" }),
        vendor({ id: "v2", name: "Élec Ndoye", trade: "Électricien", phone: "+221770003344", email: null }),
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));

    const onglets = screen.getByRole("group", { name: "Filtrer par métier" });
    await user.click(within(onglets).getByRole("button", { name: /Électricien/ }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Élec Ndoye")).toBeInTheDocument();

    await user.click(within(onglets).getByRole("button", { name: /Tous/ }));
    await user.type(screen.getByRole("searchbox", { name: "Rechercher un prestataire" }), "fall");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Plomberie Fall")).toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: "Rechercher un prestataire" }));
    await user.type(screen.getByRole("searchbox", { name: "Rechercher un prestataire" }), "zzz");
    expect(screen.getByText("Aucun prestataire ne correspond à cette recherche.")).toBeInTheDocument();
  });

  it("téléphone et e-mail sont des liens directs", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: [vendor()] });
    renderPage();
    await waitFor(() => expect(screen.getByRole("link", { name: "+221770001122" })).toHaveAttribute("href", "tel:+221770001122"));
    expect(screen.getByRole("link", { name: "fall@example.com" })).toHaveAttribute("href", "mailto:fall@example.com");
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

  describe("synthèse, WhatsApp et export", () => {
    const parc = () => [
      vendor({ id: "v1", name: "Plomberie Fall", trade: "Plombier", phone: "+221 77 000 11 22", email: "fall@example.com" }),
      vendor({ id: "v2", name: "Élec Ndoye", trade: "Électricien", phone: "0771234567", email: null }),
      vendor({ id: "v3", name: "Peinture Sow", trade: "plombier", phone: "+221 76 000 33 44", email: null }),
    ];

    it("résume le carnet : prestataires, métiers, sans email, sur WhatsApp", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: parc() });
      renderPage();
      const synthese = await screen.findByLabelText("Synthèse du carnet");
      const valeur = (libelle: string) => within(synthese).getByText(libelle).nextElementSibling;
      expect(valeur("Prestataires")).toHaveTextContent("3");
      expect(valeur("Métiers")).toHaveTextContent("2");
      expect(valeur("Sans email")).toHaveTextContent("2");
      expect(valeur("Sur WhatsApp")).toHaveTextContent("2");
    });

    it("propose WhatsApp seulement pour un numéro au format international", async () => {
      mockedApi.get.mockResolvedValueOnce({ data: parc() });
      renderPage();
      const fall = (await screen.findByRole("heading", { level: 3, name: "Plomberie Fall" })).closest("article") as HTMLElement;
      expect(within(fall).getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", "https://wa.me/221770001122");
      const ndoye = screen.getByRole("heading", { level: 3, name: "Élec Ndoye" }).closest("article") as HTMLElement;
      expect(within(ndoye).queryByRole("link", { name: "WhatsApp" })).not.toBeInTheDocument();
    });

    it("exporte les prestataires affichés en CSV", async () => {
      const user = userEvent.setup();
      let blob: Blob | undefined;
      Object.defineProperty(URL, "createObjectURL", { value: (b: Blob) => ((blob = b), "blob:test"), configurable: true });
      Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      mockedApi.get.mockResolvedValueOnce({ data: parc() });
      renderPage();
      await screen.findByLabelText("Synthèse du carnet");
      await user.type(screen.getByRole("searchbox"), "ndoye");
      await user.click(screen.getByRole("button", { name: "Exporter en CSV" }));
      const texte = await new Promise<string>((resolve) => {
        const lecteur = new FileReader();
        lecteur.onload = () => resolve(String(lecteur.result));
        lecteur.readAsText(blob!);
      });
      const lignes = texte.split("\n");
      expect(lignes).toHaveLength(2);
      expect(lignes[1]).toContain('"Élec Ndoye";"Électricien"');
    });
  });
});
