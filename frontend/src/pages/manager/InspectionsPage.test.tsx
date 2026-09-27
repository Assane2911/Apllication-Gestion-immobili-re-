import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// jsdom n'implémente pas l'API Canvas : on la stub pour pouvoir tester le
// parcours complet de signature électronique (SignatureModal) sans crasher.
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  lineWidth: 0,
  lineCap: "",
  lineJoin: "",
  strokeStyle: "",
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  clearRect: vi.fn(),
}) as unknown as typeof HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.toDataURL = vi
  .fn()
  .mockReturnValue("data:image/png;base64,fake") as unknown as typeof HTMLCanvasElement.prototype.toDataURL;

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

// Reproduit l'ordre fixe des 2 appels du Promise.all de load() :
// /inspections, /contracts.
function queueLoad(inspections: Inspection[], contracts: Contract[] = []) {
  mockedApi.get.mockResolvedValueOnce(paginated(inspections));
  mockedApi.get.mockResolvedValueOnce(paginated(contracts));
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

describe("InspectionsPage (manager)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    mockedApi.put.mockReset();
    mockedApi.delete.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("affiche la liste des états des lieux avec bien, locataire, type et statut", async () => {
    queueLoad([inspection()]);
    renderPage();

    await waitFor(() => expect(screen.getAllByText("Studio Centre-ville").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Awa Diallo/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Entrée").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Brouillon").length).toBeGreaterThan(0);
  });

  it("affiche l'état vide avec un bouton d'ajout", async () => {
    queueLoad([]);
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucun état des lieux pour l'instant")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "+ Nouvel état des lieux" }).length).toBeGreaterThan(0);
  });

  it("affiche une erreur de chargement avec un bouton réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    queueLoad([inspection()]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getAllByText("Studio Centre-ville").length).toBeGreaterThan(0));
  });

  it("crée un état des lieux : sélectionne un contrat et le type, puis POST /inspections", async () => {
    const user = userEvent.setup();
    queueLoad([inspection()], [contract()]);
    mockedApi.post.mockResolvedValueOnce({ data: { id: "insp-new" } });
    queueLoad([inspection(), inspection({ id: "insp-new", type: "EXIT" })]);

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "+ Nouvel état des lieux" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "+ Nouvel état des lieux" }));

    await user.selectOptions(screen.getByLabelText("Contrat concerné"), "c1");
    await user.selectOptions(screen.getByLabelText("Type"), "EXIT");
    await user.click(screen.getByRole("button", { name: "Créer" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/inspections", { contractId: "c1", type: "EXIT" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Créer" })).not.toBeInTheDocument());
  });

  it("édite un brouillon : ajoute une pièce et une clé, puis envoie le contenu par PUT", async () => {
    const user = userEvent.setup();
    queueLoad([inspection({ id: "insp-1" })]);
    mockedApi.put.mockResolvedValueOnce({ data: {} });
    queueLoad([inspection({ id: "insp-1" })]);

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Éditer" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "Éditer" })[0]);

    await user.click(screen.getByRole("button", { name: "+ Ajouter une pièce" }));
    await user.type(screen.getByPlaceholderText("Nom de la pièce"), "Chambre 1");
    await user.type(screen.getByPlaceholderText("Observations"), "RAS");

    await user.click(screen.getByRole("button", { name: "+ Ajouter" }));
    await user.type(screen.getByPlaceholderText("Désignation"), "Clé principale");

    await user.type(screen.getByLabelText("Observations générales"), "État des lieux d'entrée sans réserve.");

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalledTimes(1));
    const [url, body] = mockedApi.put.mock.calls[0];
    expect(url).toBe("/inspections/insp-1");
    expect(body).toMatchObject({
      rooms: [{ name: "Chambre 1", condition: "BON", notes: "RAS" }],
      keys: [{ label: "Clé principale", quantity: 1 }],
      generalComments: "État des lieux d'entrée sans réserve.",
    });
  });

  it("finalise un état des lieux après confirmation", async () => {
    const user = userEvent.setup();
    queueLoad([inspection({ id: "insp-1" })]);
    mockedApi.put.mockResolvedValueOnce({ data: {} });
    queueLoad([inspection({ id: "insp-1", status: "COMPLETED" })]);

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Éditer" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "Éditer" })[0]);
    await user.click(screen.getByRole("button", { name: "Finaliser" }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(mockedApi.put).toHaveBeenCalledWith("/inspections/insp-1", expect.objectContaining({ status: "COMPLETED" }))
    );
  });

  it("supprime un brouillon après confirmation", async () => {
    const user = userEvent.setup();
    queueLoad([inspection({ id: "insp-1" })]);
    mockedApi.delete.mockResolvedValueOnce({ data: {} });
    queueLoad([]);

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Supprimer" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "Supprimer" })[0]);

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/inspections/insp-1"));
  });

  it("signe un état des lieux finalisé côté agence", async () => {
    const user = userEvent.setup();
    queueLoad([inspection({ id: "insp-1", status: "COMPLETED" })]);
    mockedApi.post.mockResolvedValueOnce({ data: {} });

    const { container } = renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Signer/ }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: /Signer/ })[0]);

    await waitFor(() => expect(screen.getByText(/États des Lieux - Studio Centre-ville/)).toBeInTheDocument());

    const canvas = container.querySelector("canvas")!;
    fireEvent.mouseDown(canvas);

    await user.click(screen.getByRole("button", { name: "Valider ma signature" }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/inspections/insp-1/sign", {
        signatureDataUrl: "data:image/png;base64,fake",
      })
    );
    await waitFor(() => expect(screen.queryByText(/États des Lieux - Studio Centre-ville/)).not.toBeInTheDocument());
  });

  it("affiche le rapport d'un état des lieux finalisé", async () => {
    const user = userEvent.setup();
    queueLoad([inspection({ id: "insp-1", status: "COMPLETED", signedByManagerAt: "2026-02-01T00:00:00.000Z" })]);
    mockedApi.get.mockResolvedValueOnce({ data: "<html><body>Rapport EDL</body></html>" });

    renderPage();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Voir le rapport" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "Voir le rapport" })[0]);

    await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith("/documents/inspection/insp-1", expect.objectContaining({ responseType: "text" })));
  });
});
