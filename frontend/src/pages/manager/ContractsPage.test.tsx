import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { Contract, PaginatedResponse, Property, Tenant } from "../../types";
import ContractsPage from "./ContractsPage";

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

const DAY_MS = 24 * 60 * 60 * 1000;

function property(overrides: Partial<Property> = {}): Property {
  return {
    id: "prop-1",
    title: "Studio Centre-ville",
    address: "1 rue de la Paix",
    surface: 30,
    rent: 500,
    currency: "EUR",
    status: "AVAILABLE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function tenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: "ten-1",
    firstName: "Awa",
    lastName: "Diallo",
    phone: "0600000000",
    email: "awa@example.com",
    createdAt: "2026-01-01T00:00:00.000Z",
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

// Reproduit l'ordre fixe des 3 appels du Promise.all de load() :
// /contracts, /properties, /tenants.
function queueLoad(contracts: Contract[], properties: Property[] = [], tenants: Tenant[] = []) {
  mockedApi.get.mockResolvedValueOnce(paginated(contracts));
  mockedApi.get.mockResolvedValueOnce(paginated(properties));
  mockedApi.get.mockResolvedValueOnce(paginated(tenants));
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

describe("ContractsPage (manager)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    mockedApi.put.mockReset();
    mockedApi.delete.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("affiche la liste des contrats avec loyer, durée, statut et signatures", async () => {
    queueLoad([contract({ id: "c1" })]);
    renderPage();

    await waitFor(() => expect(screen.getAllByText(/Studio Centre-ville/).length).toBeGreaterThan(0));
    expect(screen.getAllByText("Awa Diallo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Actif").length).toBeGreaterThan(0);
    expect(screen.getAllByText("500 €").length).toBeGreaterThan(0);
    // Aucune signature encore posée : bouton "Signer" pour l'agence, mention "En attente" pour le locataire.
    expect(screen.getAllByRole("button", { name: /Signer/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("⏳ En attente").length).toBeGreaterThan(0);
  });

  it("affiche le bail comme signé quand signedByManagerAt/signedByTenantAt sont renseignés", async () => {
    queueLoad([contract({ signedByManagerAt: "2026-02-01T00:00:00.000Z", signedByTenantAt: "2026-02-02T00:00:00.000Z" })]);
    renderPage();

    await waitFor(() => expect(screen.getAllByText("✅ Signé").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: /Signer/ })).not.toBeInTheDocument();
  });

  it("affiche une erreur de chargement avec un bouton réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    queueLoad([contract({ id: "c1" })]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getAllByText(/Studio Centre-ville/).length).toBeGreaterThan(0));
  });

  it("crée un nouveau contrat : pré-remplit loyer/dépôt depuis le bien choisi et envoie le bon payload", async () => {
    const user = userEvent.setup();
    queueLoad([], [property({ id: "prop-1", rent: 500 })], [tenant({ id: "ten-1" })]);
    mockedApi.post.mockResolvedValueOnce({ data: { id: "c-new" } });
    queueLoad([]); // rechargement après création

    const { container } = renderPage();

    await user.click(await screen.findByRole("button", { name: /Nouveau contrat/ }));

    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[0], "prop-1");
    await user.selectOptions(selects[1], "ten-1");

    const rentInput = screen.getAllByRole("spinbutton")[0];
    const depositInput = screen.getAllByRole("spinbutton")[1];
    expect(rentInput).toHaveValue(500);
    expect(depositInput).toHaveValue(1000);

    const dateInputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: "2026-03-01" } });
    fireEvent.change(dateInputs[1], { target: { value: "2027-03-01" } });

    await user.click(screen.getByRole("button", { name: "Créer le contrat" }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/contracts", {
        propertyId: "prop-1",
        tenantId: "ten-1",
        rent: "500",
        deposit: "1000",
        startDate: "2026-03-01",
        endDate: "2027-03-01",
      })
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "Créer le contrat" })).not.toBeInTheDocument());
  });

  it("workflow de renouvellement : propose de renouveler quand le bail expire bientôt", async () => {
    const user = userEvent.setup();
    const soon = contract({ id: "c1", endDate: new Date(Date.now() + 5 * DAY_MS).toISOString() });
    queueLoad([soon]);
    mockedApi.post.mockResolvedValueOnce({ data: {} });
    queueLoad([soon]);

    renderPage();

    await waitFor(() => expect(screen.getAllByRole("button", { name: /Renouveler/ }).length).toBeGreaterThan(0));
    expect(screen.getAllByText("Ne pas renouveler").length).toBeGreaterThan(0);

    const buttons = screen.getAllByRole("button", { name: /Renouveler/ });
    await user.click(buttons[0]);

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/contracts/c1/renew", { months: 12 }));
  });

  it('"Ne pas renouveler" termine le contrat (statut ENDED)', async () => {
    const user = userEvent.setup();
    const soon = contract({ id: "c1", endDate: new Date(Date.now() + 5 * DAY_MS).toISOString() });
    queueLoad([soon]);
    mockedApi.put.mockResolvedValueOnce({ data: {} });
    queueLoad([soon]);

    renderPage();

    await waitFor(() => expect(screen.getAllByText("Ne pas renouveler").length).toBeGreaterThan(0));
    const buttons = screen.getAllByText("Ne pas renouveler");
    await user.click(buttons[0]);

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalledWith("/contracts/c1", { status: "ENDED" }));
  });

  it("résilier un contrat actif envoie le bon statut", async () => {
    const user = userEvent.setup();
    queueLoad([contract({ id: "c1", status: "ACTIVE" })]);
    mockedApi.put.mockResolvedValueOnce({ data: {} });
    queueLoad([contract({ id: "c1", status: "TERMINATED" })]);

    renderPage();

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Résilier" }).length).toBeGreaterThan(0));
    const buttons = screen.getAllByRole("button", { name: "Résilier" });
    await user.click(buttons[0]);

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalledWith("/contracts/c1", { status: "TERMINATED" }));
  });

  it("supprimer un contrat après confirmation", async () => {
    const user = userEvent.setup();
    queueLoad([contract({ id: "c1" })]);
    mockedApi.delete.mockResolvedValueOnce({ data: {} });
    queueLoad([]);

    renderPage();

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Supprimer" }).length).toBeGreaterThan(0));
    const buttons = screen.getAllByRole("button", { name: "Supprimer" });
    await user.click(buttons[0]);

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/contracts/c1"));
  });

  it("signer le bail : ouvre la modale de signature, dessine et enregistre la signature", async () => {
    const user = userEvent.setup();
    queueLoad([contract({ id: "c1", signedByManagerAt: null })]);
    mockedApi.post.mockResolvedValueOnce({ data: {} });
    queueLoad([contract({ id: "c1", signedByManagerAt: "2026-05-01T00:00:00.000Z" })]);

    const { container } = renderPage();

    await waitFor(() => expect(screen.getAllByRole("button", { name: /Signer/ }).length).toBeGreaterThan(0));
    const signButtons = screen.getAllByRole("button", { name: /Signer/ });
    await user.click(signButtons[0]);

    await waitFor(() => expect(screen.getByText(/Bail - Studio Centre-ville/)).toBeInTheDocument());

    const canvas = container.querySelector("canvas")!;
    fireEvent.mouseDown(canvas);

    await user.click(screen.getByRole("button", { name: "Valider ma signature" }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/contracts/c1/sign", {
        signatureDataUrl: "data:image/png;base64,fake",
      })
    );
    await waitFor(() => expect(screen.queryByText(/Bail - Studio Centre-ville/)).not.toBeInTheDocument());
  });
});
