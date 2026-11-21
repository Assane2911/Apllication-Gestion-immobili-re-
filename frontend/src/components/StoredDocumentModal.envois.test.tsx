import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, DELAI_UPLOAD_MS } from "../api/client";
import type { Property, StoredDocument, Tenant } from "../types";
import StoredDocumentModal from "./StoredDocumentModal";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { post: vi.fn(), put: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

/**
 * Le dépôt et la correction d'un document rangé : les cas que le test de base n'exerçait pas. Un fichier trop lourd est refusé
 * AVANT l'envoi (Vercel répondrait lui-même 413 sans message exploitable), tous les champs facultatifs partent quand ils sont
 * remplis, le bouton se bloque pendant l'envoi (pas de double dépôt), et une erreur du serveur n'enregistre rien.
 */

const biens = [{ id: "p1", title: "Villa Baobab" }] as unknown as Property[];
const locataires = [{ id: "t1", firstName: "Awa", lastName: "Sow" }] as unknown as Tenant[];

function erreurServeur(message: string) {
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 409,
    statusText: "Conflict",
    data: { error: message },
    headers: {},
    config: {} as never,
  });
}

function afficher(props: Partial<React.ComponentProps<typeof StoredDocumentModal>> = {}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(<StoredDocumentModal properties={biens} tenants={locataires} onSaved={onSaved} onClose={onClose} {...props} />);
  return { onSaved, onClose };
}

const pdf = (nom = "DPE_villa_2026.pdf") => new File(["%PDF-1.4"], nom, { type: "application/pdf" });
const pdfTropLourd = () => new File([new Uint8Array(5 * 1024 * 1024)], "scan_lourd.pdf", { type: "application/pdf" });
const existant = (extra: Partial<StoredDocument> = {}) =>
  ({ id: "d9", title: "DPE", category: "DIAGNOSTIC", propertyId: "p1", tenantId: null, expiresAt: null, notes: null, ...extra }) as unknown as StoredDocument;

describe("StoredDocumentModal : envois et refus", () => {
  beforeEach(() => {
    mockedApi.post.mockReset();
    mockedApi.put.mockReset();
  });

  it("refuse un PDF trop lourd avant tout envoi, vide le champ fichier, et l'erreur disparaît avec un fichier correct", async () => {
    const user = userEvent.setup();
    afficher({ initialPropertyId: "p1" });
    const champ = screen.getByLabelText("Fichier") as HTMLInputElement;

    await user.upload(champ, pdfTropLourd());

    expect(await screen.findByRole("alert")).toHaveTextContent("Ce fichier est trop volumineux (max 4 Mo)");
    expect(champ.files).toHaveLength(0);
    await user.type(screen.getByLabelText("Intitulé"), "Scan");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choisissez un fichier.");
    expect(mockedApi.post).not.toHaveBeenCalled();

    await user.upload(champ, pdf());
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("un fichier trop lourd choisi après un bon fichier remplace le premier : rien n'est envoyé avec l'ancien", async () => {
    const user = userEvent.setup();
    afficher({ initialPropertyId: "p1" });
    await user.upload(screen.getByLabelText("Fichier"), pdf());
    await waitFor(() => expect(screen.getByLabelText("Intitulé")).toHaveValue("DPE villa 2026"));

    await user.upload(screen.getByLabelText("Fichier"), pdfTropLourd());
    await screen.findByText(/trop volumineux/);
    await user.click(screen.getByRole("button", { name: "Ajouter" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Choisissez un fichier.");
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("envoie le locataire, l'expiration et les notes (sans espaces superflus) quand ils sont remplis", async () => {
    mockedApi.post.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    const { onSaved } = afficher();

    await user.upload(screen.getByLabelText("Fichier"), pdf());
    await user.selectOptions(screen.getByLabelText("Locataire"), "t1");
    fireEvent.change(screen.getByLabelText("Expire le"), { target: { value: "2027-03-15" } });
    await user.type(screen.getByLabelText("Notes"), "  à renouveler  ");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [, corps] = mockedApi.post.mock.calls[0] as [string, FormData, unknown];
    expect(corps.get("tenantId")).toBe("t1");
    expect(corps.get("propertyId")).toBeNull();
    expect(corps.get("expiresAt")).toBe("2027-03-15");
    expect(corps.get("notes")).toBe("à renouveler");
  });

  it("laisse un délai d'envoi long pour une connexion mobile", async () => {
    mockedApi.post.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    afficher({ initialPropertyId: "p1" });

    await user.upload(screen.getByLabelText("Fichier"), pdf());
    await user.click(screen.getByRole("button", { name: "Ajouter" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalled());
    expect(mockedApi.post.mock.calls[0][2]).toEqual({ timeout: DELAI_UPLOAD_MS });
  });

  it("garde l'intitulé déjà saisi au lieu de le remplacer par le nom du fichier", async () => {
    const user = userEvent.setup();
    afficher({ initialPropertyId: "p1" });

    await user.type(screen.getByLabelText("Intitulé"), "Mon diagnostic");
    await user.upload(screen.getByLabelText("Fichier"), pdf());

    await waitFor(() => expect(screen.getByLabelText("Fichier")).toBeInTheDocument());
    expect(screen.getByLabelText("Intitulé")).toHaveValue("Mon diagnostic");
  });

  it("pendant l'envoi : bouton « Enregistrement... » bloqué, annulation bloquée, un seul dépôt même si on insiste", async () => {
    let finir!: (v: unknown) => void;
    mockedApi.post.mockReturnValue(new Promise((resolve) => (finir = resolve)));
    const user = userEvent.setup();
    const { onSaved } = afficher({ initialPropertyId: "p1" });
    await user.upload(screen.getByLabelText("Fichier"), pdf());

    await user.click(screen.getByRole("button", { name: "Ajouter" }));

    const enCours = await screen.findByRole("button", { name: "Enregistrement..." });
    expect(enCours).toBeDisabled();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeDisabled();
    await user.click(enCours);
    expect(mockedApi.post).toHaveBeenCalledTimes(1);

    finir({ data: {} });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("erreur du serveur : message montré, rien n'est considéré comme enregistré, le bouton se débloque", async () => {
    mockedApi.post.mockRejectedValue(erreurServeur("Ce fichier existe déjà dans vos documents."));
    const user = userEvent.setup();
    const { onSaved } = afficher({ initialPropertyId: "p1" });
    await user.upload(screen.getByLabelText("Fichier"), pdf());

    await user.click(screen.getByRole("button", { name: "Ajouter" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ce fichier existe déjà dans vos documents.");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Ajouter" })).toBeEnabled();
  });

  it("correction d'un document : notes envoyées sans espaces, expiration effaçable (null), erreur du serveur montrée", async () => {
    const user = userEvent.setup();
    const { onSaved } = afficher({ document: existant({ expiresAt: "2026-09-01T00:00:00.000Z", notes: "ancienne note" }) });

    fireEvent.change(screen.getByLabelText("Expire le"), { target: { value: "" } });
    await user.clear(screen.getByLabelText("Notes"));
    await user.type(screen.getByLabelText("Notes"), "  nouvelle note  ");
    mockedApi.put.mockRejectedValueOnce(erreurServeur("Document supprimé entre-temps."));
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Document supprimé entre-temps.");
    expect(onSaved).not.toHaveBeenCalled();
    expect(mockedApi.put).toHaveBeenCalledWith("/stored-documents/d9", { title: "DPE", category: "DIAGNOSTIC", expiresAt: null, notes: "nouvelle note" });
  });

  it("« Annuler » ferme la fenêtre sans rien envoyer", async () => {
    const user = userEvent.setup();
    const { onClose } = afficher();

    await user.click(screen.getByRole("button", { name: "Annuler" }));

    expect(onClose).toHaveBeenCalled();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });
});
