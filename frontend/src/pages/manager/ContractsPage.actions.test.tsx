import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, MAX_UPLOAD_SIZE_MB } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { Contract, PaginatedResponse, Property, Tenant } from "../../types";
import ContractsPage from "./ContractsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

/**
 * Les actions d'une ligne de la liste des baux (supprimer, résilier, renouveler, annuler une restitution de dépôt,
 * téléverser le scan) quand l'utilisateur REFUSE la confirmation ou que le serveur répond par une erreur. Ce sont des actions
 * lourdes (suppression d'un bail et de ses factures, arrêt de la facturation) : un refus ne doit rien envoyer, et une erreur
 * doit être montrée au gestionnaire au lieu de passer pour un succès.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function contract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: "c1",
    propertyId: "prop-1",
    tenantId: "ten-1",
    rent: 500,
    deposit: 1000,
    currency: "EUR",
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: new Date(Date.now() + 200 * DAY_MS).toISOString(),
    status: "ACTIVE",
    signedByManagerAt: null,
    signedByTenantAt: null,
    property: { title: "Studio Centre-ville" } as unknown as Property,
    tenant: { firstName: "Awa", lastName: "Diallo" } as unknown as Tenant,
    ...overrides,
  };
}

function paginated<T>(items: T[]): { data: PaginatedResponse<T> } {
  return { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 } };
}

/** Reproduit l'ordre fixe des appels de load() : /contracts, /properties, /tenants, puis /contracts/revisions-due. */
function queueLoad(contracts: Contract[]) {
  mockedApi.get.mockResolvedValueOnce(paginated(contracts));
  mockedApi.get.mockResolvedValueOnce(paginated<Property>([]));
  mockedApi.get.mockResolvedValueOnce(paginated<Tenant>([]));
  mockedApi.get.mockResolvedValueOnce({ data: [] });
}

/** Une erreur HTTP du serveur, avec son message. */
function erreurServeur(message: string) {
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 409,
    statusText: "Conflict",
    data: { error: message },
    headers: {},
    config: {} as never,
  });
}

function renderPage() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <ContractsPage />
      </CurrencyProvider>
    </AuthProvider>
  );
}

async function attendreLaListe() {
  await waitFor(() => expect(screen.getAllByText(/Studio Centre-ville/).length).toBeGreaterThan(0));
}

describe("ContractsPage : confirmations refusées et erreurs du serveur", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    mockedApi.put.mockReset();
    mockedApi.delete.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("supprimer : si le gestionnaire refuse la confirmation, rien n'est supprimé", async () => {
    const user = userEvent.setup();
    queueLoad([contract()]);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    await attendreLaListe();

    await user.click(screen.getAllByRole("button", { name: "Supprimer" })[0]);

    expect(window.confirm).toHaveBeenCalled();
    expect(mockedApi.delete).not.toHaveBeenCalled();
  });

  it("supprimer : montre l'erreur du serveur au lieu de laisser croire que le bail est supprimé", async () => {
    const user = userEvent.setup();
    queueLoad([contract()]);
    mockedApi.delete.mockRejectedValueOnce(erreurServeur("Ce bail a encore des paiements enregistrés."));
    renderPage();
    await attendreLaListe();

    await user.click(screen.getAllByRole("button", { name: "Supprimer" })[0]);

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith("Ce bail a encore des paiements enregistrés."));
  });

  it("résilier : montre l'erreur du serveur", async () => {
    const user = userEvent.setup();
    queueLoad([contract()]);
    mockedApi.put.mockRejectedValueOnce(erreurServeur("Résiliation impossible : état des lieux de sortie manquant."));
    renderPage();
    await attendreLaListe();

    await user.click(screen.getAllByRole("button", { name: "Résilier" })[0]);

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith("Résiliation impossible : état des lieux de sortie manquant."));
  });

  describe("renouvellement d'un bail qui expire bientôt", () => {
    const bientot = () => contract({ endDate: new Date(Date.now() + 5 * DAY_MS).toISOString() });

    it("refus de la confirmation : aucun renouvellement n'est envoyé", async () => {
      const user = userEvent.setup();
      queueLoad([bientot()]);
      vi.spyOn(window, "confirm").mockReturnValue(false);
      renderPage();
      await attendreLaListe();

      await user.click(screen.getAllByRole("button", { name: /Renouveler/ })[0]);

      expect(window.confirm).toHaveBeenCalled();
      expect(mockedApi.post).not.toHaveBeenCalled();
    });

    it("erreur du serveur : elle est montrée", async () => {
      const user = userEvent.setup();
      queueLoad([bientot()]);
      mockedApi.post.mockRejectedValueOnce(erreurServeur("Ce bail est déjà renouvelé."));
      renderPage();
      await attendreLaListe();

      await user.click(screen.getAllByRole("button", { name: /Renouveler/ })[0]);

      await waitFor(() => expect(window.alert).toHaveBeenCalledWith("Ce bail est déjà renouvelé."));
    });
  });

  describe("restitution du dépôt de garantie déjà enregistrée", () => {
    const restitue = () => contract({ status: "ENDED", deposit: 1000, depositRefundedAt: "2026-06-01T00:00:00.000Z", depositDeductions: [] });

    it("refus de la confirmation : la restitution n'est pas annulée", async () => {
      const user = userEvent.setup();
      queueLoad([restitue()]);
      vi.spyOn(window, "confirm").mockReturnValue(false);
      renderPage();
      await attendreLaListe();

      await user.click(screen.getAllByRole("button", { name: /Dépôt restitué/ })[0]);

      expect(window.confirm).toHaveBeenCalled();
      expect(mockedApi.put).not.toHaveBeenCalled();
    });

    it("erreur du serveur : elle est montrée", async () => {
      const user = userEvent.setup();
      queueLoad([restitue()]);
      mockedApi.put.mockRejectedValueOnce(erreurServeur("La restitution a déjà été versée au locataire."));
      renderPage();
      await attendreLaListe();

      await user.click(screen.getAllByRole("button", { name: /Dépôt restitué/ })[0]);

      await waitFor(() => expect(window.alert).toHaveBeenCalledWith("La restitution a déjà été versée au locataire."));
    });
  });

  describe("scan du bail papier", () => {
    const fichierScan = (nom = "bail.pdf", type = "application/pdf") => new File(["%PDF-1.4 scan"], nom, { type });

    /** Clique « Scan papier » (qui retient le bail visé) puis dépose un fichier dans le champ caché. */
    async function deposer(fichier: File) {
      const user = userEvent.setup();
      await user.click(screen.getAllByRole("button", { name: /Scan papier/ })[0]);
      const champ = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(champ, { target: { files: [fichier] } });
    }

    it("envoie le fichier au bail visé, puis recharge la liste", async () => {
      queueLoad([contract({ id: "c1" })]);
      mockedApi.post.mockResolvedValueOnce({ data: {} });
      queueLoad([contract({ id: "c1", scannedContractUrl: "https://stockage.test/scan.pdf" })]);
      renderPage();
      await attendreLaListe();

      await deposer(fichierScan());

      await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
      const [url, corps] = mockedApi.post.mock.calls[0];
      expect(url).toBe("/contracts/c1/scan");
      expect((corps as FormData).get("scan")).toBeInstanceOf(File);
      expect(((corps as FormData).get("scan") as File).name).toBe("bail.pdf");
      await waitFor(() => expect(mockedApi.get).toHaveBeenCalledTimes(8)); // la liste a été relue
    });

    it("refuse tout de suite un PDF trop lourd, sans rien envoyer, et le dit au gestionnaire", async () => {
      queueLoad([contract()]);
      renderPage();
      await attendreLaListe();
      const trop = fichierScan();
      Object.defineProperty(trop, "size", { value: (MAX_UPLOAD_SIZE_MB + 10) * 1024 * 1024 });

      await deposer(trop);

      await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining(`max ${MAX_UPLOAD_SIZE_MB} Mo`)));
      expect(mockedApi.post).not.toHaveBeenCalled();
    });

    it("montre l'erreur du serveur quand l'envoi échoue, et ne laisse pas le bouton bloqué sur « envoi en cours »", async () => {
      queueLoad([contract()]);
      mockedApi.post.mockRejectedValueOnce(erreurServeur("Le scan n'a pas pu être enregistré."));
      renderPage();
      await attendreLaListe();

      await deposer(fichierScan());

      await waitFor(() => expect(window.alert).toHaveBeenCalledWith("Le scan n'a pas pu être enregistré."));
      await waitFor(() => expect(screen.getAllByRole("button", { name: /Scan papier/ })[0]).not.toBeDisabled());
    });

    it("ne fait rien quand aucun fichier n'est choisi", async () => {
      queueLoad([contract()]);
      renderPage();
      await attendreLaListe();
      const user = userEvent.setup();
      await user.click(screen.getAllByRole("button", { name: /Scan papier/ })[0]);
      const champ = document.querySelector('input[type="file"]') as HTMLInputElement;

      fireEvent.change(champ, { target: { files: [] } });

      expect(mockedApi.post).not.toHaveBeenCalled();
      expect(window.alert).not.toHaveBeenCalled();
    });

    it("un bail déjà scanné : « Scan papier » ouvre l'aperçu du scan, « Remplacer scan » propose d'en envoyer un autre", async () => {
      const user = userEvent.setup();
      queueLoad([contract({ scannedContractUrl: "https://stockage.test/scan.pdf" })]);
      renderPage();
      await attendreLaListe();
      expect(screen.getAllByRole("button", { name: /Remplacer scan/ }).length).toBeGreaterThan(0);

      await user.click(screen.getAllByRole("button", { name: /Scan papier/ })[0]);

      await waitFor(() => expect(document.querySelector('iframe[src="https://stockage.test/scan.pdf"]')).not.toBeNull());
      expect(mockedApi.get).toHaveBeenCalledTimes(4); // aucun appel de plus : l'adresse était déjà connue
    });
  });
});
