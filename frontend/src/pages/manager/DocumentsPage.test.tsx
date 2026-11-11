import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { PaginatedResponse, Property, StoredDocument, Tenant } from "../../types";
import DocumentsPage from "./DocumentsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });

const jour = (decalage: number) => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + decalage)).toISOString();
};
const doc = (o: Partial<StoredDocument>): StoredDocument => ({
  id: "d1", propertyId: "p1", tenantId: null, propertyTitle: "Villa Baobab", tenantName: null, category: "DIAGNOSTIC", title: "DPE", fileName: "dpe.pdf", mimeType: "application/pdf",
  sizeBytes: 2048, expiresAt: null, notes: null, createdAt: jour(-5), updatedAt: jour(-5), ...o,
});
const page = <T,>(items: T[]) => ({ data: { items, page: 1, pageSize: 100, total: items.length, totalPages: 1 } as PaginatedResponse<T> });
const biens = [{ id: "p1", title: "Villa Baobab" }, { id: "p2", title: "Studio Plateau" }] as unknown as Property[];
const locataires = [{ id: "t1", firstName: "Awa", lastName: "Sow" }] as unknown as Tenant[];

function chargerAvec(documents: StoredDocument[]) {
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === "/stored-documents") return page(documents);
    if (url === "/properties") return page(biens);
    if (url === "/tenants") return page(locataires);
    throw new Error(`appel inattendu ${url}`);
  });
}

describe("DocumentsPage", () => {
  beforeEach(() => {
    Object.values(mockedApi).forEach((m) => (m as ReturnType<typeof vi.fn>).mockReset?.());
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  it("affiche l'état vide avec un bouton d'ajout", async () => {
    chargerAvec([]);
    render(<DocumentsPage />);

    expect(await screen.findByText("Aucun document rangé")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "+ Ajouter un document" }).length).toBeGreaterThan(0);
  });

  it("liste les documents avec leur rattachement, leur taille et leur état d'expiration", async () => {
    chargerAvec([
      doc({ id: "a", title: "DPE", expiresAt: jour(-10) }),
      doc({ id: "b", title: "Assurance PNO", category: "INSURANCE", expiresAt: jour(12) }),
      doc({ id: "c", title: "Passeport", category: "IDENTITY", propertyId: null, propertyTitle: null, tenantId: "t1", tenantName: "Awa Sow" }),
    ]);
    render(<DocumentsPage />);

    expect(await screen.findByText("DPE")).toBeInTheDocument();
    expect(screen.getByText(/Expiré le/)).toBeInTheDocument();
    expect(screen.getByText(/Expire le/)).toBeInTheDocument();
    expect(screen.getByText(/Awa Sow/)).toBeInTheDocument();
    expect(screen.getAllByText(/2 Ko/).length).toBe(3);
    const bandeau = screen.getByLabelText("Synthèse des documents");
    expect(within(bandeau).getByText("Expirés").parentElement).toHaveTextContent("1");
    expect(within(bandeau).getByText("À renouveler").parentElement).toHaveTextContent("1");
  });

  it("ouvre le fichier par un lien temporaire, jamais par un chemin du stockage", async () => {
    chargerAvec([doc({ id: "a" })]);
    mockedApi.get.mockImplementation(async (url: string) => {
      if (url === "/stored-documents/a/link") return { data: { url: "https://stockage.test/signe", fileName: "dpe.pdf", mimeType: "application/pdf" } };
      if (url === "/stored-documents") return page([doc({ id: "a" })]);
      return page([]);
    });
    render(<DocumentsPage />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Ouvrir" }));

    await waitFor(() => expect(window.open).toHaveBeenCalledWith("https://stockage.test/signe", "_blank", "noopener,noreferrer"));
  });

  it("supprime après confirmation puis recharge la liste", async () => {
    chargerAvec([doc({ id: "a", title: "DPE" })]);
    mockedApi.delete.mockResolvedValue({ data: null });
    render(<DocumentsPage />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Supprimer" }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("DPE"));
    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/stored-documents/a"));
  });

  it("filtre par échéance, catégorie et recherche quand la liste est assez longue", async () => {
    chargerAvec([
      doc({ id: "a", title: "DPE", expiresAt: jour(-10) }),
      doc({ id: "b", title: "Assurance PNO", category: "INSURANCE", expiresAt: jour(12) }),
      doc({ id: "c", title: "Passeport", category: "IDENTITY", tenantId: "t1", tenantName: "Awa Sow" }),
      doc({ id: "d", title: "Plomb", category: "DIAGNOSTIC" }),
    ]);
    const user = userEvent.setup();
    render(<DocumentsPage />);
    await screen.findByText("DPE");

    await user.click(screen.getByRole("button", { name: /Expirés/ }));
    expect(screen.queryByText("Assurance PNO")).not.toBeInTheDocument();
    expect(screen.getByText("DPE")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Tous/ }));
    await user.selectOptions(screen.getByLabelText("Catégorie"), "INSURANCE");
    expect(screen.getByText("Assurance PNO")).toBeInTheDocument();
    expect(screen.queryByText("DPE")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Catégorie"), "all");
    await user.type(screen.getByRole("searchbox"), "awa");
    expect(screen.getByText("Passeport")).toBeInTheDocument();
    expect(screen.queryByText("Plomb")).not.toBeInTheDocument();
  });

  it("affiche l'erreur de chargement et permet de réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({ isAxiosError: true, response: { data: { error: "Erreur serveur" } } });
    render(<DocumentsPage />);
    expect(await screen.findByText("Erreur serveur")).toBeInTheDocument();

    chargerAvec([doc({ id: "a", title: "DPE" })]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("DPE")).toBeInTheDocument();
  });
});
