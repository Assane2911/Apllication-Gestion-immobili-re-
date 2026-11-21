import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { IssueReport, PaginatedResponse, Vendor } from "../../types";
import IssuesPage from "./IssuesPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn(), put: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

/**
 * Les incidents signalés par les locataires : ce qui arrive quand le serveur refuse un changement de statut, une assignation
 * ou une planification (l'erreur doit être montrée au gestionnaire, la liste ne doit pas être rechargée comme si de rien
 * n'était), quand la liste ou le carnet de prestataires ne se charge pas, et la galerie de photos.
 */

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

function incident(extra: Partial<IssueReport> = {}): IssueReport {
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
    tenant: { id: "ten-1", firstName: "Fatou", lastName: "Diop", phone: "+221 77 000 00 00" },
    contract: { id: "c1", property: { title: "Studio Centre-ville" } },
    ...extra,
  } as unknown as IssueReport;
}

const prestataire = (): Vendor => ({ id: "ven-1", name: "Plomberie Fall", trade: "Plombier", phone: "+221770001122", createdAt: "2026-01-01T00:00:00.000Z" });

const page = (items: IssueReport[]): { data: PaginatedResponse<IssueReport> } => ({
  data: { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 },
});

/** La page appelle les incidents PUIS le carnet de prestataires (deux effets, dans cet ordre). */
function afficher(items: IssueReport[], vendors: Vendor[] = []) {
  mockedApi.get.mockResolvedValueOnce(page(items));
  mockedApi.get.mockResolvedValueOnce({ data: vendors });
  return render(<IssuesPage />);
}
const attendreLaListe = () => waitFor(() => expect(screen.getByText("Fuite d'eau sous l'évier")).toBeInTheDocument());
const nombreDAppelsListe = () => mockedApi.get.mock.calls.filter(([url]) => url === "/issues").length;

describe("IssuesPage : refus du serveur et chargements en échec", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.put.mockReset();
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  it("changement de statut refusé : l'erreur du serveur est montrée et la liste n'est pas rechargée", async () => {
    const user = userEvent.setup();
    afficher([incident()]);
    await attendreLaListe();
    mockedApi.put.mockRejectedValueOnce(erreurServeur("Incident déjà clôturé par un autre gestionnaire."));

    await user.click(within(screen.getByRole("group", { name: "Changer le statut :" })).getByRole("button", { name: "Résolu" }));

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith("Incident déjà clôturé par un autre gestionnaire."));
    expect(nombreDAppelsListe()).toBe(1);
  });

  it("envoie avec le statut la réponse saisie au locataire", async () => {
    const user = userEvent.setup();
    afficher([incident()]);
    await attendreLaListe();
    mockedApi.put.mockResolvedValueOnce({ data: {} });
    mockedApi.get.mockResolvedValueOnce(page([incident({ status: "IN_PROGRESS" })]));

    await user.type(screen.getByLabelText("Note de traitement / Réponse au locataire :"), "Un plombier passe demain.");
    await user.click(within(screen.getByRole("group", { name: "Changer le statut :" })).getByRole("button", { name: "En cours" }));

    await waitFor(() =>
      expect(mockedApi.put).toHaveBeenCalledWith("/issues/iss-1/status", { status: "IN_PROGRESS", managerNote: "Un plombier passe demain." })
    );
  });

  it("assignation d'un prestataire refusée : l'erreur est montrée, la liste n'est pas rechargée", async () => {
    const user = userEvent.setup();
    afficher([incident()], [prestataire()]);
    await attendreLaListe();
    mockedApi.put.mockRejectedValueOnce(erreurServeur("Ce prestataire n'existe plus."));

    await user.selectOptions(screen.getByLabelText("Prestataire assigné :"), "ven-1");

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith("Ce prestataire n'existe plus."));
    expect(nombreDAppelsListe()).toBe(1);
  });

  it("planification refusée : l'erreur est montrée, la liste n'est pas rechargée", async () => {
    afficher([incident({ vendor: prestataire() })], [prestataire()]);
    await attendreLaListe();
    mockedApi.put.mockRejectedValueOnce(erreurServeur("Date d'intervention dans le passé."));

    fireEvent.change(screen.getByLabelText("Intervention planifiée :"), { target: { value: "2020-01-01T10:00" } });

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith("Date d'intervention dans le passé."));
    expect(nombreDAppelsListe()).toBe(1);
  });

  it("liste des incidents en échec : le message du serveur s'affiche et « Réessayer » recharge la liste", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockRejectedValueOnce(erreurServeur("Base de données indisponible."));
    mockedApi.get.mockResolvedValueOnce({ data: [] });
    render(<IssuesPage />);
    await waitFor(() => expect(screen.getByText("Base de données indisponible.")).toBeInTheDocument());

    mockedApi.get.mockResolvedValueOnce(page([incident()]));
    await user.click(screen.getByRole("button", { name: "Réessayer" }));

    await attendreLaListe();
    expect(screen.queryByText("Base de données indisponible.")).not.toBeInTheDocument();
  });

  it("carnet de prestataires indisponible : la page reste utilisable, sans prestataire proposé", async () => {
    mockedApi.get.mockResolvedValueOnce(page([incident()]));
    mockedApi.get.mockRejectedValueOnce(new Error("Réseau coupé"));
    render(<IssuesPage />);
    await attendreLaListe();

    const choix = screen.getByLabelText("Prestataire assigné :") as HTMLSelectElement;
    expect(choix.options).toHaveLength(1);
    expect(screen.queryByText("Plomberie Fall")).not.toBeInTheDocument();
  });

  describe("galerie de photos", () => {
    const deuxPhotos = () => incident({ photoUrl: "/uploads/a.jpg", additionalPhotos: JSON.stringify(["/uploads/b.jpg"]) });

    it("une vignette choisit la photo affichée en grand", async () => {
      const user = userEvent.setup();
      afficher([deuxPhotos()]);
      await attendreLaListe();
      expect(screen.getByText("Photo 1/2")).toBeInTheDocument();

      await user.click(screen.getAllByRole("button", { name: "Photo incident 2" })[0]);

      expect(screen.getByText("Photo 2/2")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "Photo incident 2" })[0]).toHaveAttribute("aria-pressed", "true");
    });

    it("la photo agrandie s'ouvre au clic et se referme au clic", async () => {
      const user = userEvent.setup();
      afficher([deuxPhotos()]);
      await attendreLaListe();

      await user.click(screen.getByRole("button", { name: "Photo agrandie" }));
      const agrandie = await screen.findByRole("dialog");
      expect(within(agrandie).getByRole("img")).toHaveAttribute("src", expect.stringContaining("a.jpg"));

      await user.click(agrandie);
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });
  });
});
