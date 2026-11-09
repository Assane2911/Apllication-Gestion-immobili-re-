import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("affiche « photo indisponible » quand la photo n'a pas pu être signée, et l'incident reste listé", async () => {
    mockedApi.get.mockResolvedValueOnce(paginated([issue({ photoUrl: "" })]));
    renderWithVendors();
    expect(await screen.findByText("Photo momentanément indisponible")).toBeInTheDocument();
    expect(screen.getByText("Fuite d'eau sous l'évier")).toBeInTheDocument();
    expect(screen.queryByAltText(/Photo incident/)).not.toBeInTheDocument();
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

    await userEvent.setup().click(within(screen.getByRole("group", { name: "Changer le statut :" })).getByRole("button", { name: "Résolu" }));

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
    await userEvent.setup().click(within(screen.getByRole("group", { name: "Filtrer par statut" })).getByRole("button", { name: "Résolu" }));

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

  describe("planification de l'intervention", () => {
    it("désactive le champ de planification tant qu'aucun prestataire n'est assigné", async () => {
      mockedApi.get.mockResolvedValueOnce(paginated([issue()]));
      renderWithVendors([vendor()]);
      await waitFor(() => expect(screen.getByText("Fuite d'eau sous l'évier")).toBeInTheDocument());

      expect(screen.getByLabelText("Intervention planifiée :")).toBeDisabled();
    });

    it("planifie une intervention une fois un prestataire assigné", async () => {
      mockedApi.get.mockResolvedValueOnce(paginated([issue({ vendor: vendor() })]));
      renderWithVendors([vendor()]);
      await waitFor(() => expect(screen.getByText("Fuite d'eau sous l'évier")).toBeInTheDocument());

      const champ = screen.getByLabelText("Intervention planifiée :");
      expect(champ).toBeEnabled();

      mockedApi.put.mockResolvedValueOnce({ data: {} });
      mockedApi.get.mockResolvedValueOnce(
        paginated([issue({ vendor: vendor(), scheduledAt: "2026-11-05T09:00:00.000Z" })])
      );

      fireEvent.change(champ, { target: { value: "2026-11-05T10:00" } });

      await waitFor(() => expect(mockedApi.put).toHaveBeenCalledWith("/issues/iss-1/status", expect.anything()));
      const [, body] = mockedApi.put.mock.calls[0];
      expect((body as { scheduledAt: string }).scheduledAt).not.toBeNull();
    });

    it("efface la planification quand le champ est vidé", async () => {
      mockedApi.get.mockResolvedValueOnce(
        paginated([issue({ vendor: vendor(), scheduledAt: "2026-11-05T09:00:00.000Z" })])
      );
      renderWithVendors([vendor()]);
      await waitFor(() => expect(screen.getByText("Fuite d'eau sous l'évier")).toBeInTheDocument());

      mockedApi.put.mockResolvedValueOnce({ data: {} });
      mockedApi.get.mockResolvedValueOnce(paginated([issue({ vendor: vendor(), scheduledAt: null })]));

      fireEvent.change(screen.getByLabelText("Intervention planifiée :"), { target: { value: "" } });

      await waitFor(() =>
        expect(mockedApi.put).toHaveBeenCalledWith("/issues/iss-1/status", {
          status: "OPEN",
          managerNote: undefined,
          scheduledAt: null,
        })
      );
    });
  });

  describe("synthèse, ancienneté, recherche et sans prestataire", () => {
    const il_y_a = (j: number) => new Date(Date.now() - j * 86_400_000).toISOString();
    const parc = () => [
      issue({ id: "a", title: "Fuite d'eau", createdAt: il_y_a(10) }),
      issue({ id: "b", title: "Porte bloquée", createdAt: il_y_a(1), vendor: { id: "ven-1", name: "Plomberie Fall", trade: "Plombier" } }),
      issue({ id: "c", title: "Ampoule grillée", createdAt: il_y_a(0), tenant: tenant({ firstName: "Moussa", lastName: "Ba" }) }),
      issue({ id: "d", title: "Volet cassé", status: "RESOLVED", createdAt: il_y_a(20) }),
    ];
    const titres = () => screen.getAllByRole("article").map((a) => within(a).getByRole("heading", { level: 3 }).textContent);

    async function afficher() {
      mockedApi.get.mockResolvedValueOnce(paginated(parc()));
      renderWithVendors([vendor()]);
      await screen.findByText("Fuite d'eau");
    }

    it("résume les incidents ouverts, sans prestataire, anciens et planifiés", async () => {
      await afficher();
      const synthese = screen.getByLabelText("Synthèse des incidents");
      const valeur = (libelle: string) => within(synthese).getByText(libelle).nextElementSibling;
      expect(valeur("Ouverts")).toHaveTextContent("3");
      expect(valeur("Sans prestataire")).toHaveTextContent("2");
      expect(valeur("Anciens")).toHaveTextContent("1");
      expect(valeur("Interventions planifiées")).toHaveTextContent("0");
    });

    it("indique l'ancienneté de chaque incident à traiter, et marque l'ancien", async () => {
      await afficher();
      const fuite = screen.getByRole("heading", { level: 3, name: "Fuite d'eau" }).closest("article") as HTMLElement;
      expect(within(fuite).getByText(/Signalé il y a 10 j · Ancien/)).toBeInTheDocument();
      const ampoule = screen.getByRole("heading", { level: 3, name: "Ampoule grillée" }).closest("article") as HTMLElement;
      expect(within(ampoule).getByText(/Signalé aujourd'hui/)).toBeInTheDocument();
      const volet = screen.getByRole("heading", { level: 3, name: "Volet cassé" }).closest("article") as HTMLElement;
      expect(within(volet).queryByText(/Signalé il y a|Signalé aujourd/)).not.toBeInTheDocument();
    });

    it("cherche par titre ou locataire, et isole les incidents sans prestataire", async () => {
      const user = userEvent.setup();
      await afficher();
      await user.type(screen.getByRole("searchbox"), "moussa");
      expect(titres()).toEqual(["Ampoule grillée"]);
      await user.clear(screen.getByRole("searchbox"));

      await user.click(screen.getByRole("button", { name: "Sans prestataire" }));
      expect(titres()).toEqual(["Fuite d'eau", "Ampoule grillée"]);
    });
  });
});
