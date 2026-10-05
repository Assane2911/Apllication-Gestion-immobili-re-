import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { Contract, IssueReport, PaginatedResponse, Tenant, Vendor } from "../../types";
import IssuesPage from "./IssuesPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), put: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function tenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: "ten-1",
    firstName: "Fatou",
    lastName: "Diop",
    phone: "+221 77 000 00 00",
    ...overrides,
  } as unknown as Tenant;
}

function contract(overrides: Partial<Contract> = {}): Contract {
  return { id: "c1", property: { title: "Studio Centre-ville" }, ...overrides } as unknown as Contract;
}

function issue(overrides: Partial<IssueReport> = {}): IssueReport {
  return {
    id: "iss-1",
    contractId: "c1",
    tenantId: "ten-1",
    title: "Fuite d'eau sous l'évier",
    description: "Ça goutte depuis ce matin.",
    photoUrl: "/uploads/photo1.jpg",
    additionalPhotos: null,
    status: "OPEN",
    managerNote: null,
    createdAt: "2026-06-15T10:30:00.000Z",
    tenant: tenant(),
    contract: contract(),
    ...overrides,
  };
}

function paginated(items: IssueReport[]): { data: PaginatedResponse<IssueReport> } {
  return { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 } };
}

function vendor(overrides: Partial<Vendor> = {}): Vendor {
  return { id: "ven-1", name: "Plomberie Fall", trade: "Plombier", phone: "+221770001122", createdAt: "2026-01-01T00:00:00.000Z", ...overrides };
}

/**
 * La page charge aussi le carnet de prestataires au montage (effet séparé,
 * déps vides, voir IssuesPage.tsx) — EN PLUS de l'appel /issues, dans cet
 * ordre. Un rendu de la page doit donc toujours mettre en file ce second
 * mock, sans quoi le second appel GET réel (celui des prestataires) consomme
 * par erreur le mock destiné à un rechargement ultérieur des incidents.
 */
function renderWithVendors(vendorList: Vendor[] = []) {
  mockedApi.get.mockResolvedValueOnce({ data: vendorList });
  return render(<IssuesPage />);
}

describe("IssuesPage (gestionnaire)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.put.mockReset();
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("affiche les incidents signalés avec locataire et bien concerné", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([issue()]));
    renderWithVendors();

    await waitFor(() => expect(screen.getByText("Fuite d'eau sous l'évier")).toBeInTheDocument());
    expect(screen.getByText("Ça goutte depuis ce matin.")).toBeInTheDocument();
    expect(screen.getByText("Fatou Diop")).toBeInTheDocument();
    expect(screen.getByText("Studio Centre-ville")).toBeInTheDocument();
  });

  it("affiche un message dédié quand aucun incident ne correspond au filtre", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([]));
    renderWithVendors();

    await waitFor(() => expect(screen.getByText("Aucun incident pour ce filtre")).toBeInTheDocument());
  });

  it("change le statut d'un incident et relance le chargement", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([issue()]));
    renderWithVendors();
    await waitFor(() => expect(screen.getByText("Fuite d'eau sous l'évier")).toBeInTheDocument());

    mockedApi.put.mockResolvedValueOnce({ data: {} });
    mockedApi.get.mockResolvedValueOnce(paginated([issue({ status: "RESOLVED" })]));

    await userEvent.setup().click(screen.getByRole("button", { name: "Résolu" }));

    await waitFor(() =>
      expect(mockedApi.put).toHaveBeenCalledWith("/issues/iss-1/status", {
        status: "RESOLVED",
        managerNote: undefined,
      })
    );
  });

  it("filtre par statut et relance l'appel avec le paramètre status", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([issue()]));
    renderWithVendors();
    await waitFor(() => expect(screen.getByText("Fuite d'eau sous l'évier")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce(paginated([]));
    await userEvent.setup().selectOptions(screen.getByLabelText("Filtrer par statut"), "RESOLVED");

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/issues", {
        params: { page: 1, pageSize: 20, status: "RESOLVED" },
        signal: expect.anything(),
      })
    );
  });

  it("assigne un prestataire du carnet à un incident", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([issue()]));
    renderWithVendors([vendor()]);
    await waitFor(() => expect(screen.getByText("Fuite d'eau sous l'évier")).toBeInTheDocument());

    mockedApi.put.mockResolvedValueOnce({ data: {} });
    mockedApi.get.mockResolvedValueOnce(paginated([issue({ vendor: vendor() })]));

    await userEvent.setup().selectOptions(screen.getByLabelText("Prestataire assigné :"), "ven-1");

    await waitFor(() =>
      expect(mockedApi.put).toHaveBeenCalledWith("/issues/iss-1/status", {
        status: "OPEN",
        managerNote: undefined,
        vendorId: "ven-1",
      })
    );
  });

  it("désassigne un prestataire en revenant à l'option « Aucun prestataire »", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([issue({ vendor: vendor() })]));
    renderWithVendors([vendor()]);
    await waitFor(() => expect(screen.getByText("Fuite d'eau sous l'évier")).toBeInTheDocument());

    mockedApi.put.mockResolvedValueOnce({ data: {} });
    mockedApi.get.mockResolvedValueOnce(paginated([issue({ vendor: null })]));

    await userEvent.setup().selectOptions(screen.getByLabelText("Prestataire assigné :"), "");

    await waitFor(() =>
      expect(mockedApi.put).toHaveBeenCalledWith("/issues/iss-1/status", {
        status: "OPEN",
        managerNote: undefined,
        vendorId: null,
      })
    );
  });
});
