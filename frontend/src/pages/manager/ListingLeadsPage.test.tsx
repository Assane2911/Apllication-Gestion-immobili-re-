import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { Listing, ListingLead, PaginatedResponse } from "../../types";
import ListingLeadsPage from "./ListingLeadsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), patch: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

function lead(overrides: Partial<ListingLead> = {}): ListingLead {
  return {
    id: "lead-1",
    listingId: "list-1",
    listingTitle: "Appartement 2 pièces vue mer",
    managerId: "mgr-1",
    prospectName: "Aïcha Ndiaye",
    prospectEmail: "aicha@example.com",
    prospectPhone: "+221 77 111 22 33",
    requestType: "VISIT",
    preferredDate: null,
    message: "Disponible ce week-end ?",
    status: "NEW",
    notes: null,
    createdAt: "2026-09-10T10:00:00.000Z",
    updatedAt: "2026-09-10T10:00:00.000Z",
    ...overrides,
  };
}

function leadsPaginated(items: ListingLead[]): { data: PaginatedResponse<ListingLead> } {
  return { data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 } };
}

function listingsPaginated(items: Listing[] = []): { data: PaginatedResponse<Listing> } {
  return { data: { items, page: 1, pageSize: 100, total: items.length, totalPages: 1 } };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ListingLeadsPage />
    </MemoryRouter>
  );
}

describe("ListingLeadsPage (manager)", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.patch.mockReset();
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("affiche les demandes reçues avec l'annonce, le contact et le type de demande", async () => {
    mockedApi.get.mockResolvedValueOnce(leadsPaginated([lead()]));
    mockedApi.get.mockResolvedValueOnce(listingsPaginated());
    renderPage();

    await waitFor(() => expect(screen.getByText("Aïcha Ndiaye")).toBeInTheDocument());
    expect(screen.getByText("Appartement 2 pièces vue mer")).toBeInTheDocument();
    expect(screen.getByText("aicha@example.com")).toBeInTheDocument();
    expect(screen.getByText("Demande de visite")).toBeInTheDocument();
    expect(screen.getByText("Disponible ce week-end ?")).toBeInTheDocument();
  });

  it("affiche un état vide quand aucune demande n'est reçue", async () => {
    mockedApi.get.mockResolvedValueOnce(leadsPaginated([]));
    mockedApi.get.mockResolvedValueOnce(listingsPaginated());
    renderPage();

    await waitFor(() => expect(screen.getByText("Aucune demande pour l'instant")).toBeInTheDocument());
  });

  it("affiche une erreur de chargement avec un bouton réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      response: { data: { error: "Erreur serveur" } },
      isAxiosError: true,
    });
    mockedApi.get.mockResolvedValueOnce(listingsPaginated());
    renderPage();

    await waitFor(() => expect(screen.getByText("Erreur serveur")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce(leadsPaginated([lead()]));
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("Aïcha Ndiaye")).toBeInTheDocument());
  });

  it("change le statut d'une demande et relance le chargement", async () => {
    mockedApi.get.mockResolvedValueOnce(leadsPaginated([lead()]));
    mockedApi.get.mockResolvedValueOnce(listingsPaginated());
    mockedApi.patch.mockResolvedValueOnce({ data: {} });
    mockedApi.get.mockResolvedValueOnce(leadsPaginated([lead({ status: "CONTACTED" })]));

    renderPage();
    await waitFor(() => expect(screen.getByText("Aïcha Ndiaye")).toBeInTheDocument());

    await userEvent.setup().click(screen.getByRole("button", { name: "Contacté" }));

    await waitFor(() =>
      expect(mockedApi.patch).toHaveBeenCalledWith("/listings/leads/lead-1", {
        status: "CONTACTED",
        notes: undefined,
      })
    );
  });

  it("filtre par statut et relance l'appel avec le paramètre status", async () => {
    mockedApi.get.mockResolvedValueOnce(leadsPaginated([lead()]));
    mockedApi.get.mockResolvedValueOnce(listingsPaginated());
    renderPage();
    await waitFor(() => expect(screen.getByText("Aïcha Ndiaye")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce(leadsPaginated([]));
    await userEvent.setup().selectOptions(screen.getByLabelText("Filtrer par statut"), "CONVERTED");

    await waitFor(() =>
      expect(mockedApi.get).toHaveBeenLastCalledWith("/listings/leads", {
        params: { page: 1, pageSize: 20, status: "CONVERTED" },
      })
    );
  });
});
