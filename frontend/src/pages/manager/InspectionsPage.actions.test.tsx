import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { Contract, Inspection, PaginatedResponse, Property, Tenant } from "../../types";
import InspectionsPage from "./InspectionsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

/**
 * Les actions de la page des états des lieux quand la confirmation est refusée ou que le serveur répond par une erreur.
 * Finaliser est IRRÉVERSIBLE (« le contenu ne pourra plus être modifié ensuite ») : un refus ne doit rien envoyer, et une
 * erreur doit rester affichée dans l'éditeur au lieu de le fermer comme si tout s'était bien passé.
 */

function inspection(overrides: Partial<Inspection> = {}): Inspection {
  return {
    id: "insp-1",
    contractId: "c1",
    propertyId: "prop-1",
    tenantId: "ten-1",
    managerId: "mgr-1",
    type: "ENTRY",
    status: "DRAFT",
    inspectionDate: "2026-01-15T00:00:00.000Z",
    rooms: [],
    meters: { electricity: "", water: "", gas: "" },
    keys: [],
    generalComments: null,
    managerSignatureUrl: null,
    signedByManagerAt: null,
    tenantSignatureUrl: null,
    signedByTenantAt: null,
    createdAt: "2026-01-15T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:00.000Z",
    property: { title: "Studio Centre-ville" } as unknown as Property,
    tenant: { firstName: "Awa", lastName: "Diallo" } as unknown as Tenant,
    ...overrides,
  };
}

function contract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: "c1",
    propertyId: "prop-1",
    tenantId: "ten-1",
    rent: 500,
    deposit: 1000,
    currency: "EUR",
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2027-01-01T00:00:00.000Z",
    status: "ACTIVE",
    property: { title: "Studio Centre-ville" } as unknown as Property,
    tenant: { firstName: "Awa", lastName: "Diallo" } as unknown as Tenant,
    ...overrides,
  };
}

function paginated<T>(items: T[]): { data: PaginatedResponse<T> } {
  return { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 } };
}

/** Reproduit l'ordre fixe des 2 appels du Promise.all de load() : /inspections, /contracts. */
function queueLoad(inspections: Inspection[], contracts: Contract[] = []) {
  mockedApi.get.mockResolvedValueOnce(paginated(inspections));
  mockedApi.get.mockResolvedValueOnce(paginated(contracts));
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
        <InspectionsPage />
      </CurrencyProvider>
    </AuthProvider>
  );
}

async function ouvrirLEditeur(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Éditer" }).length).toBeGreaterThan(0));
  await user.click(screen.getAllByRole("button", { name: "Éditer" })[0]);
}

describe("InspectionsPage : confirmations refusées et erreurs du serveur", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    mockedApi.put.mockReset();
    mockedApi.delete.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  describe("finaliser (irréversible)", () => {
    it("confirmation refusée : rien n'est envoyé et l'éditeur reste ouvert", async () => {
      const user = userEvent.setup();
      queueLoad([inspection()]);
      vi.spyOn(window, "confirm").mockReturnValue(false);
      renderPage();
      await ouvrirLEditeur(user);

      await user.click(screen.getByRole("button", { name: "Finaliser" }));

      expect(window.confirm).toHaveBeenCalled();
      expect(mockedApi.put).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Finaliser" })).toBeInTheDocument();
    });

    it("erreur du serveur : le message s'affiche dans l'éditeur, qui reste ouvert pour réessayer", async () => {
      const user = userEvent.setup();
      queueLoad([inspection()]);
      mockedApi.put.mockRejectedValueOnce(erreurServeur("Les deux compteurs doivent être renseignés avant de finaliser."));
      renderPage();
      await ouvrirLEditeur(user);

      await user.click(screen.getByRole("button", { name: "Finaliser" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Les deux compteurs doivent être renseignés avant de finaliser.");
      expect(screen.getByRole("button", { name: "Finaliser" })).toBeEnabled(); // pas bloqué sur « enregistrement en cours »
    });
  });

  it("enregistrer un brouillon : l'erreur du serveur s'affiche dans l'éditeur", async () => {
    const user = userEvent.setup();
    queueLoad([inspection()]);
    mockedApi.put.mockRejectedValueOnce(erreurServeur("Ce brouillon a été modifié par un autre collaborateur."));
    renderPage();
    await ouvrirLEditeur(user);

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ce brouillon a été modifié par un autre collaborateur.");
    expect(mockedApi.put).toHaveBeenCalledTimes(1);
  });

  describe("supprimer un brouillon", () => {
    it("confirmation refusée : rien n'est supprimé", async () => {
      const user = userEvent.setup();
      queueLoad([inspection()]);
      vi.spyOn(window, "confirm").mockReturnValue(false);
      renderPage();
      await waitFor(() => expect(screen.getAllByRole("button", { name: "Supprimer" }).length).toBeGreaterThan(0));

      await user.click(screen.getAllByRole("button", { name: "Supprimer" })[0]);

      expect(window.confirm).toHaveBeenCalled();
      expect(mockedApi.delete).not.toHaveBeenCalled();
    });

    it("erreur du serveur : le message est montré au gestionnaire", async () => {
      const user = userEvent.setup();
      queueLoad([inspection()]);
      mockedApi.delete.mockRejectedValueOnce(erreurServeur("Cet état des lieux est déjà signé."));
      renderPage();
      await waitFor(() => expect(screen.getAllByRole("button", { name: "Supprimer" }).length).toBeGreaterThan(0));

      await user.click(screen.getAllByRole("button", { name: "Supprimer" })[0]);

      await waitFor(() => expect(window.alert).toHaveBeenCalledWith("Cet état des lieux est déjà signé."));
    });
  });

  it("créer : l'erreur du serveur s'affiche dans le formulaire, qui reste ouvert", async () => {
    const user = userEvent.setup();
    queueLoad([inspection()], [contract()]);
    mockedApi.post.mockRejectedValueOnce(erreurServeur("Un état des lieux d'entrée existe déjà pour ce bail."));
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "+ Nouvel état des lieux" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "+ Nouvel état des lieux" }));
    await user.selectOptions(screen.getByLabelText("Contrat concerné"), "c1");

    await user.click(screen.getByRole("button", { name: "Créer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Un état des lieux d'entrée existe déjà pour ce bail.");
    expect(screen.getByRole("button", { name: "Créer" })).toBeEnabled();
  });

  describe("édition d'un brouillon : retirer une ligne, saisir les compteurs", () => {
    it("retire la bonne pièce et la bonne clé, et n'envoie que les lignes restantes", async () => {
      const user = userEvent.setup();
      queueLoad([
        inspection({
          rooms: [
            { name: "Salon", condition: "BON", notes: "" },
            { name: "Cave", condition: "MAUVAIS", notes: "Humidité" },
          ],
          keys: [
            { label: "Clé porte", quantity: 2 },
            { label: "Clé boîte aux lettres", quantity: 1 },
          ],
        }),
      ]);
      mockedApi.put.mockResolvedValueOnce({ data: {} });
      queueLoad([inspection()]);
      renderPage();
      await ouvrirLEditeur(user);

      const retirer = screen.getAllByRole("button", { name: "Retirer" }); // pièces d'abord, puis clés
      await user.click(retirer[1]); // la cave
      await user.click(screen.getAllByRole("button", { name: "Retirer" })[1]); // la 1re clé (la liste a perdu une ligne)
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedApi.put).toHaveBeenCalledTimes(1));
      const [, corps] = mockedApi.put.mock.calls[0];
      expect((corps as { rooms: Array<{ name: string }> }).rooms.map((p) => p.name)).toEqual(["Salon"]);
      expect((corps as { keys: Array<{ label: string }> }).keys.map((k) => k.label)).toEqual(["Clé boîte aux lettres"]);
    });

    it("envoie les relevés de compteurs saisis (électricité, eau, gaz)", async () => {
      const user = userEvent.setup();
      queueLoad([inspection()]);
      mockedApi.put.mockResolvedValueOnce({ data: {} });
      queueLoad([inspection()]);
      renderPage();
      await ouvrirLEditeur(user);

      await user.type(screen.getByLabelText("Électricité"), "12345");
      await user.type(screen.getByLabelText("Eau"), "678");
      await user.type(screen.getByLabelText("Gaz"), "90");
      await user.click(screen.getByRole("button", { name: "Enregistrer" }));

      await waitFor(() => expect(mockedApi.put).toHaveBeenCalledTimes(1));
      expect(mockedApi.put.mock.calls[0][1]).toMatchObject({ meters: { electricity: "12345", water: "678", gas: "90" } });
    });

    it("« Annuler » ferme l'éditeur sans rien envoyer", async () => {
      const user = userEvent.setup();
      queueLoad([inspection()]);
      renderPage();
      await ouvrirLEditeur(user);

      await user.click(screen.getByRole("button", { name: "Annuler" }));

      expect(screen.queryByRole("button", { name: "Finaliser" })).not.toBeInTheDocument();
      expect(mockedApi.put).not.toHaveBeenCalled();
    });
  });
});
