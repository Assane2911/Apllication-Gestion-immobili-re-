import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { PaginatedResponse, Property, StoredDocument, Tenant } from "../../types";
import DocumentsPage from "./DocumentsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });

/**
 * Les documents rangés (diagnostics, attestations, pièces d'identité) : ce que les autres tests n'exerçaient pas. Ouvrir un
 * fichier privé ou en effacer un définitivement échoue parfois côté serveur : l'erreur doit être montrée, la liste ne doit pas
 * mentir (un document supprimé « en apparence » alors qu'il existe encore), et une confirmation refusée n'envoie rien.
 */

function erreurServeur(message: string) {
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 500,
    statusText: "Server Error",
    data: { error: message },
    headers: {},
    config: {} as never,
  });
}

const doc = (o: Partial<StoredDocument>): StoredDocument =>
  ({
    id: "d1", propertyId: "p1", tenantId: null, propertyTitle: "Villa Baobab", tenantName: null, category: "DIAGNOSTIC", title: "DPE", fileName: "dpe.pdf", mimeType: "application/pdf",
    sizeBytes: 2048, expiresAt: null, notes: null, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", ...o,
  }) as StoredDocument;
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
const appelsListe = () => mockedApi.get.mock.calls.filter(([url]) => url === "/stored-documents");

describe("DocumentsPage : refus du serveur, confirmations et fenêtre de dépôt", () => {
  beforeEach(() => {
    Object.values(mockedApi).forEach((m) => (m as ReturnType<typeof vi.fn>).mockReset?.());
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  it("ouverture refusée : l'erreur du serveur est montrée et aucune fenêtre ne s'ouvre", async () => {
    chargerAvec([doc({ id: "a", title: "DPE" })]);
    const user = userEvent.setup();
    render(<DocumentsPage />);
    await screen.findByText("DPE");
    mockedApi.get.mockImplementationOnce(async () => {
      throw erreurServeur("Fichier introuvable dans le stockage.");
    });

    await user.click(screen.getByRole("button", { name: "Ouvrir" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Fichier introuvable dans le stockage.");
    expect(window.open).not.toHaveBeenCalled();
  });

  it("l'erreur d'une action disparaît à l'action suivante qui réussit", async () => {
    chargerAvec([doc({ id: "a", title: "DPE" })]);
    const user = userEvent.setup();
    render(<DocumentsPage />);
    await screen.findByText("DPE");
    mockedApi.get.mockImplementationOnce(async () => {
      throw erreurServeur("Fichier introuvable dans le stockage.");
    });
    await user.click(screen.getByRole("button", { name: "Ouvrir" }));
    await screen.findByRole("alert");

    mockedApi.get.mockImplementationOnce(async () => ({ data: { url: "https://stockage.test/dpe.pdf?signature=abc" } }));
    await user.click(screen.getByRole("button", { name: "Ouvrir" }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(window.open).toHaveBeenCalledWith("https://stockage.test/dpe.pdf?signature=abc", "_blank", "noopener,noreferrer");
  });

  it("suppression : confirmation refusée, rien n'est envoyé et le document reste", async () => {
    chargerAvec([doc({ id: "a", title: "DPE" })]);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<DocumentsPage />);
    await screen.findByText("DPE");

    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    expect(mockedApi.delete).not.toHaveBeenCalled();
    expect(screen.getByText("DPE")).toBeInTheDocument();
    expect(appelsListe()).toHaveLength(1);
  });

  it("suppression réussie : la liste est rechargée et le document disparaît", async () => {
    const lignes = [doc({ id: "a", title: "DPE" }), doc({ id: "b", title: "Assurance PNO", category: "INSURANCE" })];
    chargerAvec(lignes);
    mockedApi.delete.mockImplementation(async () => {
      chargerAvec([lignes[1]]);
      return { data: null };
    });
    const user = userEvent.setup();
    render(<DocumentsPage />);
    await screen.findByText("DPE");

    await user.click(screen.getAllByRole("button", { name: "Supprimer" })[0]);

    await waitFor(() => expect(screen.queryByText("DPE")).not.toBeInTheDocument());
    expect(screen.getByText("Assurance PNO")).toBeInTheDocument();
    expect(mockedApi.delete).toHaveBeenCalledWith("/stored-documents/a");
    expect(appelsListe()).toHaveLength(2);
  });

  it("suppression refusée par le serveur : l'erreur est montrée, le document reste listé, la liste n'est pas rechargée", async () => {
    chargerAvec([doc({ id: "a", title: "DPE" })]);
    mockedApi.delete.mockRejectedValue(erreurServeur("Ce document est lié à un bail en cours."));
    const user = userEvent.setup();
    render(<DocumentsPage />);
    await screen.findByText("DPE");

    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ce document est lié à un bail en cours.");
    expect(screen.getByText("DPE")).toBeInTheDocument();
    expect(appelsListe()).toHaveLength(1);
  });

  it("correction d'un document : la fenêtre s'ouvre pré-remplie, « Annuler » la ferme sans rien envoyer, et l'enregistrement la ferme et recharge la liste", async () => {
    chargerAvec([doc({ id: "a", title: "DPE" })]);
    mockedApi.put.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    render(<DocumentsPage />);
    await screen.findByText("DPE");

    await user.click(screen.getByRole("button", { name: "Modifier" }));
    const fenetre = await screen.findByRole("dialog", { name: "Modifier le document" });
    expect(within(fenetre).getByLabelText("Intitulé")).toHaveValue("DPE");
    await user.click(within(fenetre).getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockedApi.put).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Modifier" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalledWith("/stored-documents/a", expect.objectContaining({ title: "DPE" })));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(appelsListe()).toHaveLength(2));
  });

  it("sans document, les deux boutons « + Ajouter un document » (en-tête et état vide) ouvrent la fenêtre de dépôt", async () => {
    chargerAvec([]);
    const user = userEvent.setup();
    render(<DocumentsPage />);
    await screen.findByText("Aucun document rangé");

    const boutons = screen.getAllByRole("button", { name: "+ Ajouter un document" });
    expect(boutons).toHaveLength(2);

    await user.click(boutons[1]);
    expect(await screen.findByRole("dialog", { name: "Ajouter un document" })).toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(boutons[0]);
    expect(await screen.findByRole("dialog", { name: "Ajouter un document" })).toBeInTheDocument();
  });

  describe("filtre par bien", () => {
    const quatreDocuments = () => [
      doc({ id: "a", title: "DPE villa", propertyId: "p1", propertyTitle: "Villa Baobab" }),
      doc({ id: "b", title: "Assurance villa", category: "INSURANCE", propertyId: "p1", propertyTitle: "Villa Baobab" }),
      doc({ id: "c", title: "Diagnostic studio", propertyId: "p2", propertyTitle: "Studio Plateau" }),
      doc({ id: "d", title: "Passeport", category: "IDENTITY", propertyId: null, propertyTitle: null, tenantId: "t1", tenantName: "Awa Sow" }),
    ];

    it("n'affiche que les documents du bien choisi, puis tous avec « Tous les biens »", async () => {
      chargerAvec(quatreDocuments());
      const user = userEvent.setup();
      render(<DocumentsPage />);
      await screen.findByText("DPE villa");

      await user.selectOptions(screen.getByLabelText("Bien"), "p2");
      expect(screen.getByText("Diagnostic studio")).toBeInTheDocument();
      expect(screen.queryByText("DPE villa")).not.toBeInTheDocument();
      expect(screen.queryByText("Passeport")).not.toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText("Bien"), "");
      expect(screen.getByText("DPE villa")).toBeInTheDocument();
      expect(screen.getByText("Passeport")).toBeInTheDocument();
    });

    it("un dépôt lancé avec un bien filtré propose ce bien par défaut", async () => {
      chargerAvec(quatreDocuments());
      const user = userEvent.setup();
      render(<DocumentsPage />);
      await screen.findByText("DPE villa");
      await user.selectOptions(screen.getByLabelText("Bien"), "p2");

      await user.click(screen.getByRole("button", { name: "+ Ajouter un document" }));

      const fenetre = await screen.findByRole("dialog", { name: "Ajouter un document" });
      expect(within(fenetre).getByLabelText("Bien")).toHaveValue("p2");
    });
  });
});
