import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { Property, StoredDocument, Tenant } from "../types";
import StoredDocumentModal from "./StoredDocumentModal";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { post: vi.fn(), put: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });
const biens = [{ id: "p1", title: "Villa Baobab" }] as unknown as Property[];
const locataires = [{ id: "t1", firstName: "Awa", lastName: "Sow" }] as unknown as Tenant[];

function afficher(props: Partial<React.ComponentProps<typeof StoredDocumentModal>> = {}) {
  const onSaved = vi.fn();
  render(<StoredDocumentModal properties={biens} tenants={locataires} onSaved={onSaved} onClose={vi.fn()} {...props} />);
  return { onSaved };
}
const pdf = () => new File(["%PDF-1.4"], "DPE_villa_2026.pdf", { type: "application/pdf" });

describe("StoredDocumentModal", () => {
  beforeEach(() => {
    mockedApi.post.mockReset();
    mockedApi.put.mockReset();
  });

  it("propose le nom du fichier comme intitulé, puis envoie fichier et informations en une requête", async () => {
    mockedApi.post.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    const { onSaved } = afficher({ initialPropertyId: "p1" });

    await user.upload(screen.getByLabelText("Fichier"), pdf());
    await waitFor(() => expect(screen.getByLabelText("Intitulé")).toHaveValue("DPE villa 2026"));
    await user.selectOptions(screen.getByLabelText("Catégorie"), "DIAGNOSTIC");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, corps] = mockedApi.post.mock.calls[0] as [string, FormData];
    expect(url).toBe("/stored-documents");
    expect(corps.get("title")).toBe("DPE villa 2026");
    expect(corps.get("category")).toBe("DIAGNOSTIC");
    expect(corps.get("propertyId")).toBe("p1");
    expect(corps.get("tenantId")).toBeNull();
    expect(corps.get("expiresAt")).toBeNull();
    expect((corps.get("file") as File).name).toBe("DPE_villa_2026.pdf");
  });

  it("refuse un dépôt sans fichier ou sans rattachement, sans rien envoyer", async () => {
    const user = userEvent.setup();
    afficher();

    await user.type(screen.getByLabelText("Intitulé"), "Un titre");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choisissez un fichier.");

    await user.upload(screen.getByLabelText("Fichier"), pdf());
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Rattachez le document à un bien ou à un locataire.");
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("modifie seulement les informations d'un document existant, expiration comprise", async () => {
    mockedApi.put.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    const existant = { id: "d9", title: "DPE", category: "DIAGNOSTIC", propertyId: "p1", tenantId: null, expiresAt: "2026-09-01T00:00:00.000Z", notes: null } as unknown as StoredDocument;
    const { onSaved } = afficher({ document: existant });

    expect(screen.queryByLabelText("Fichier")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Expire le")).toHaveValue("2026-09-01");
    await user.clear(screen.getByLabelText("Intitulé"));
    await user.type(screen.getByLabelText("Intitulé"), "DPE 2026");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockedApi.put).toHaveBeenCalledWith("/stored-documents/d9", { title: "DPE 2026", category: "DIAGNOSTIC", expiresAt: "2026-09-01", notes: null });
  });

  it("montre le message du serveur quand l'envoi échoue", async () => {
    mockedApi.post.mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { error: "x", code: "STORED_DOCUMENT_LIMIT", params: { max: 100 } } } });
    const user = userEvent.setup();
    afficher({ initialPropertyId: "p1" });

    await user.upload(screen.getByLabelText("Fichier"), pdf());
    await user.click(screen.getByRole("button", { name: "Ajouter" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Limite de 100 documents atteinte");
  });
});
