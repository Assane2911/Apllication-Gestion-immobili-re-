import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { Listing, ListingLead, PaginatedResponse } from "../../types";
import ListingLeadsPage from "./ListingLeadsPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });

/**
 * Les demandes de contact reçues sur les annonces (données personnelles de prospects : nom, e-mail, téléphone) : quand le
 * serveur refuse un changement de statut ou une suppression, l'erreur doit être montrée et la liste ne doit pas faire croire que
 * l'action a eu lieu ; la note saisie part avec le statut ; le filtre par annonce transmet la bonne annonce.
 */

function erreurServeur(message: string) {
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 409,
    statusText: "Conflict",
    data: { error: message },
    headers: {},
    config: {} as never,
  });
}

const demande = (o: Partial<ListingLead> = {}): ListingLead =>
  ({
    id: "lead-1", listingId: "list-1", listingTitle: "Appartement 2 pièces vue mer", managerId: "mgr-1", prospectName: "Aïcha Ndiaye", prospectEmail: "aicha@example.com",
    prospectPhone: "+221 77 111 22 33", requestType: "VISIT", preferredDate: null, message: "Disponible ce week-end ?", status: "NEW", notes: null,
    createdAt: "2026-09-10T10:00:00.000Z", updatedAt: "2026-09-10T10:00:00.000Z", ...o,
  }) as ListingLead;
const pageDemandes = (items: ListingLead[]): { data: PaginatedResponse<ListingLead> } => ({ data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 } });
const annonces = [{ id: "list-1", title: "Appartement 2 pièces vue mer" }, { id: "list-2", title: "Villa Almadies" }] as unknown as Listing[];

/** Les demandes et les annonces répondent par adresse ; `demandes` peut changer d'un appel à l'autre. */
function servir(demandes: Array<{ data: PaginatedResponse<ListingLead> }>, annoncesOuErreur: Listing[] | Error = annonces) {
  const file = [...demandes];
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === "/listings/leads") return file.length > 1 ? file.shift()! : file[0];
    if (url === "/listings") {
      if (annoncesOuErreur instanceof Error) throw annoncesOuErreur;
      return { data: { items: annoncesOuErreur, page: 1, pageSize: 100, total: annoncesOuErreur.length, totalPages: 1 } };
    }
    throw new Error(`appel inattendu ${url}`);
  });
}
const appelsDemandes = () => mockedApi.get.mock.calls.filter(([url]) => url === "/listings/leads");
const attendre = () => screen.findByText("Aïcha Ndiaye");
const statuts = () => within(screen.getByRole("group", { name: "Changer le statut :" }));

describe("ListingLeadsPage : refus du serveur, notes et filtre par annonce", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.patch.mockReset();
    mockedApi.delete.mockReset();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("changement de statut refusé : l'erreur du serveur est montrée et la liste n'est pas rechargée", async () => {
    servir([pageDemandes([demande()])]);
    mockedApi.patch.mockRejectedValue(erreurServeur("Cette demande a été archivée par un collègue."));
    const user = userEvent.setup();
    render(<MemoryRouter><ListingLeadsPage /></MemoryRouter>);
    await attendre();

    await user.click(statuts().getByRole("button", { name: "Contacté" }));

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith("Cette demande a été archivée par un collègue."));
    expect(appelsDemandes()).toHaveLength(1);
  });

  it("la note saisie part avec le nouveau statut", async () => {
    servir([pageDemandes([demande()]), pageDemandes([demande({ status: "CONTACTED" })])]);
    mockedApi.patch.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    render(<MemoryRouter><ListingLeadsPage /></MemoryRouter>);
    await attendre();

    await user.type(screen.getByLabelText(/Note interne/), "Rappeler jeudi matin");
    await user.click(statuts().getByRole("button", { name: "Contacté" }));

    await waitFor(() => expect(mockedApi.patch).toHaveBeenCalledWith("/listings/leads/lead-1", { status: "CONTACTED", notes: "Rappeler jeudi matin" }));
    await waitFor(() => expect(appelsDemandes()).toHaveLength(2));
  });

  it("suppression refusée par le serveur : l'erreur est montrée, la demande reste listée, la liste n'est pas rechargée", async () => {
    servir([pageDemandes([demande()])]);
    mockedApi.delete.mockRejectedValue(erreurServeur("Suppression impossible pour le moment."));
    const user = userEvent.setup();
    render(<MemoryRouter><ListingLeadsPage /></MemoryRouter>);
    await attendre();

    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith("Suppression impossible pour le moment."));
    expect(screen.getByText("Aïcha Ndiaye")).toBeInTheDocument();
    expect(appelsDemandes()).toHaveLength(1);
  });

  it("suppression : confirmation refusée, rien n'est envoyé et la demande reste", async () => {
    servir([pageDemandes([demande()])]);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<MemoryRouter><ListingLeadsPage /></MemoryRouter>);
    await attendre();

    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    expect(mockedApi.delete).not.toHaveBeenCalled();
    expect(screen.getByText("Aïcha Ndiaye")).toBeInTheDocument();
    expect(appelsDemandes()).toHaveLength(1);
  });

  it("suppression réussie : la liste est rechargée et la demande disparaît", async () => {
    servir([pageDemandes([demande()]), pageDemandes([])]);
    mockedApi.delete.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    render(<MemoryRouter><ListingLeadsPage /></MemoryRouter>);
    await attendre();

    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    await waitFor(() => expect(screen.queryByText("Aïcha Ndiaye")).not.toBeInTheDocument());
    expect(appelsDemandes()).toHaveLength(2);
  });

  it("liste des annonces indisponible : les demandes restent consultables, avec le seul choix « Toutes les annonces »", async () => {
    servir([pageDemandes([demande()])], new Error("réseau coupé"));
    render(<MemoryRouter><ListingLeadsPage /></MemoryRouter>);
    await attendre();

    const choix = (await screen.findByRole("combobox", { name: /annonce/i })) as HTMLSelectElement;
    expect(choix.options).toHaveLength(1);
  });

  it("changer d'annonce revient à la première page", async () => {
    const deuxPages = (items: ListingLead[], page: number) => ({ data: { items, page, pageSize: 20, total: 30, totalPages: 2 } as PaginatedResponse<ListingLead> });
    servir([deuxPages([demande()], 1), deuxPages([demande({ id: "lead-9", prospectName: "Page deux" })], 2), pageDemandes([demande({ id: "lead-2", prospectName: "Moussa Fall", listingId: "list-2" })])]);
    const user = userEvent.setup();
    render(<MemoryRouter><ListingLeadsPage /></MemoryRouter>);
    await attendre();
    await user.click(screen.getByRole("button", { name: "Suivant" }));
    await screen.findByText("Page deux");
    const choix = await screen.findByRole("combobox", { name: /annonce/i });
    await waitFor(() => expect((choix as HTMLSelectElement).options.length).toBe(3));

    await user.selectOptions(choix, "list-2");

    await screen.findByText("Moussa Fall");
    expect((appelsDemandes()[2][1] as { params: Record<string, unknown> }).params).toMatchObject({ page: 1, listingId: "list-2" });
  });

  it("filtre par annonce : la bonne annonce est demandée au serveur, et « Toutes les annonces » retire le filtre", async () => {
    servir([pageDemandes([demande()]), pageDemandes([demande({ id: "lead-2", prospectName: "Moussa Fall", listingId: "list-2" })]), pageDemandes([demande()])]);
    const user = userEvent.setup();
    render(<MemoryRouter><ListingLeadsPage /></MemoryRouter>);
    await attendre();
    const choix = await screen.findByRole("combobox", { name: /annonce/i });
    await waitFor(() => expect((choix as HTMLSelectElement).options.length).toBe(3));

    await user.selectOptions(choix, "list-2");

    await screen.findByText("Moussa Fall");
    expect((appelsDemandes()[1][1] as { params: Record<string, unknown> }).params).toMatchObject({ page: 1, listingId: "list-2" });

    await user.selectOptions(choix, "ALL");
    await waitFor(() => expect(appelsDemandes()).toHaveLength(3));
    expect((appelsDemandes()[2][1] as { params: Record<string, unknown> }).params).not.toHaveProperty("listingId");
  });
});
