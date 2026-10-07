import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AuthProvider } from "../../context/AuthContext";
import { CurrencyProvider } from "../../context/CurrencyContext";
import type { InsurancePolicy, PaginatedResponse, Property } from "../../types";
import InsurancePage from "./InsurancePage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function property(overrides: Partial<Property> = {}): Property {
  return {
    id: "prop-1",
    title: "Studio Centre-ville",
    address: "1 rue de la Paix",
    surface: 30,
    rent: 500,
    currency: "EUR",
    status: "OCCUPIED",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function insurancePolicy(overrides: Partial<InsurancePolicy> = {}): InsurancePolicy {
  return {
    id: "pol-1",
    propertyId: "prop-1",
    insurerName: "AXA Habitat",
    policyNumber: "AXA-2026-001",
    premiumAmount: 240,
    currency: "EUR",
    expiryDate: "2030-01-01T00:00:00.000Z",
    property: { title: "Studio Centre-ville" } as unknown as Property,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function paginated<T>(items: T[]): { data: PaginatedResponse<T> } {
  return { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 } };
}

// Reproduit l'ordre fixe des 2 appels du Promise.all de loadData() :
// /properties, /insurance-policies.
function queueLoad(properties: Property[], policies: InsurancePolicy[]) {
  mockedApi.get.mockResolvedValueOnce(paginated(properties));
  mockedApi.get.mockResolvedValueOnce(paginated(policies));
}

function renderPage() {
  return render(
    <AuthProvider>
      <CurrencyProvider>
        <InsurancePage />
      </CurrencyProvider>
    </AuthProvider>
  );
}

describe("InsurancePage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    mockedApi.put.mockReset();
    mockedApi.delete.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 15));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("affiche la liste des polices avec assureur, numéro et prime", async () => {
    queueLoad([property()], [insurancePolicy()]);
    renderPage();

    await waitFor(() => expect(screen.getByText("AXA Habitat")).toBeInTheDocument());
    expect(screen.getByText("AXA-2026-001")).toBeInTheDocument();
    expect(screen.getByText("240 €")).toBeInTheDocument();
  });

  it("affiche un message quand il n'y a aucune police", async () => {
    queueLoad([property()], []);
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Aucune police d'assurance enregistrée pour le moment.")).toBeInTheDocument()
    );
  });

  it("affiche un badge « échéance proche » pour une police expirant bientôt", async () => {
    queueLoad([property()], [insurancePolicy({ expiryDate: "2026-06-25T00:00:00.000Z" })]);
    renderPage();

    await waitFor(() => expect(screen.getByText("Dans 10 j.")).toBeInTheDocument());
  });

  it("affiche un badge « expirée » pour une police déjà expirée", async () => {
    queueLoad([property()], [insurancePolicy({ expiryDate: "2026-01-01T00:00:00.000Z" })]);
    renderPage();

    await waitFor(() => expect(screen.getByText("Expirée")).toBeInTheDocument());
  });

  it("n'affiche aucun badge pour une police dont l'échéance est lointaine", async () => {
    queueLoad([property()], [insurancePolicy({ expiryDate: "2030-01-01T00:00:00.000Z" })]);
    renderPage();

    await waitFor(() => expect(screen.getByText("AXA Habitat")).toBeInTheDocument());
    expect(screen.queryByText("Expirée")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Dans /)).not.toBeInTheDocument();
  });

  it("le filtre par bien recharge la liste avec le bon paramètre", async () => {
    const user = userEvent.setup();
    queueLoad([property({ id: "prop-1" })], [insurancePolicy()]);
    queueLoad([property({ id: "prop-1" })], [insurancePolicy()]);

    renderPage();
    await waitFor(() => expect(screen.getByText("AXA Habitat")).toBeInTheDocument());

    const filterSelect = screen.getAllByRole("combobox")[0];
    await user.selectOptions(filterSelect, "prop-1");

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenCalledWith("/insurance-policies", {
        params: { page: 1, pageSize: 20, propertyId: "prop-1" },
        signal: expect.anything(),
      })
    );
  });

  it("crée une nouvelle police d'assurance", async () => {
    const user = userEvent.setup();
    queueLoad([property({ id: "prop-1" })], []);
    mockedApi.post.mockResolvedValueOnce({ data: { id: "pol-new" } });
    queueLoad([property({ id: "prop-1" })], [insurancePolicy({ id: "pol-new" })]);

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /Ajouter une police/ })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Ajouter une police/ }));

    const selects = screen.getAllByRole("combobox");
    // Le 1er combobox est le filtre par bien (hors modale).
    await user.selectOptions(selects[1], "prop-1");
    await user.type(screen.getByLabelText("Assureur *"), "AXA Habitat");
    await user.type(screen.getByLabelText("N° de police *"), "AXA-2026-002");
    fireEvent.change(screen.getByLabelText("Prime annuelle"), { target: { value: "300" } });
    fireEvent.change(screen.getByLabelText("Date d'échéance *"), { target: { value: "2027-01-01" } });

    await user.click(screen.getByRole("button", { name: "Enregistrer la police" }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith("/insurance-policies", {
        propertyId: "prop-1",
        insurerName: "AXA Habitat",
        policyNumber: "AXA-2026-002",
        premiumAmount: 300,
        startDate: undefined,
        expiryDate: "2027-01-01",
        notes: "",
      })
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "Enregistrer la police" })).not.toBeInTheDocument());
  });

  it("modifie une police existante : le formulaire est pré-rempli puis envoie un PUT", async () => {
    const user = userEvent.setup();
    const existante = insurancePolicy({ id: "pol-1", insurerName: "Ancien assureur" });
    queueLoad([property({ id: "prop-1" })], [existante]);
    mockedApi.put.mockResolvedValueOnce({ data: { ...existante, insurerName: "Nouvel assureur" } });
    queueLoad([property({ id: "prop-1" })], [{ ...existante, insurerName: "Nouvel assureur" }]);

    renderPage();
    await waitFor(() => expect(screen.getByText("Ancien assureur")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Modifier" }));
    const insurerInput = screen.getByLabelText("Assureur *") as HTMLInputElement;
    expect(insurerInput.value).toBe("Ancien assureur");

    await user.clear(insurerInput);
    await user.type(insurerInput, "Nouvel assureur");
    await user.click(screen.getByRole("button", { name: "Enregistrer la police" }));

    await waitFor(() =>
      expect(mockedApi.put).toHaveBeenCalledWith(
        "/insurance-policies/pol-1",
        expect.objectContaining({ insurerName: "Nouvel assureur" })
      )
    );
  });

  it("supprime une police après confirmation", async () => {
    const user = userEvent.setup();
    queueLoad([property()], [insurancePolicy()]);
    mockedApi.delete.mockResolvedValueOnce({ data: {} });
    queueLoad([property()], []);

    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Supprimer" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/insurance-policies/pol-1"));
  });

  it("affiche une erreur de chargement avec un bouton réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    queueLoad([property()], [insurancePolicy()]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("AXA Habitat")).toBeInTheDocument());
  });
});
