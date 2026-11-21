import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { Contract, LeaseNotice, LeaseNoticesResponse } from "../types";
import LeaseNoticeModal from "./LeaseNoticeModal";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });

/**
 * Le congé (préavis de départ) est un acte à portée juridique : le retirer relance les loyers, le joindre à son scan en est la
 * preuve. Ces tests exercent ce que le serveur peut refuser : le retrait, l'enregistrement, l'envoi du scan, et la distinction
 * entre « le congé est enregistré mais son scan a échoué » et « rien n'est enregistré ».
 */

const bail = {
  id: "c1",
  property: { title: "Studio A" },
  tenant: { firstName: "Awa", lastName: "Sow" },
} as unknown as Contract;

const conge = (extra: Partial<LeaseNotice> = {}): LeaseNotice => ({
  id: "n1",
  contractId: "c1",
  givenBy: "LANDLORD",
  deliveryMode: "BAILIFF",
  servedAt: "2026-03-10T00:00:00.000Z",
  periodValue: 3,
  periodUnit: "MONTHS",
  exitDate: "2026-06-10T00:00:00.000Z",
  bailiffName: "Étude Me Ndiaye",
  actReference: "ACTE-0142",
  reason: null,
  documentUrl: null,
  status: "ACTIVE",
  withdrawnAt: null,
  createdAt: "2026-03-11T00:00:00.000Z",
  ...extra,
});

const reponse = (extra: Partial<LeaseNoticesResponse> = {}): { data: LeaseNoticesResponse } => ({
  data: { conges: [], etapes: null, facturesApresSortie: 0, ...extra },
});

const enCours = (noticeExtra: Partial<LeaseNotice> = {}) =>
  reponse({ conges: [conge(noticeExtra)], etapes: { etatDesLieuxDeSortie: "NONE", depotRestitue: false } });

function erreurServeur(message: string) {
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 409,
    statusText: "Conflict",
    data: { error: message },
    headers: {},
    config: {} as never,
  });
}

function afficher(onChange = vi.fn()) {
  const rendu = render(
    <MemoryRouter>
      <LeaseNoticeModal contract={bail} onChange={onChange} onClose={vi.fn()} />
    </MemoryRouter>
  );
  return { onChange, ...rendu };
}

const pdf = () => new File(["%PDF-1.4"], "acte.pdf", { type: "application/pdf" });

beforeEach(() => {
  mockedApi.get.mockReset();
  mockedApi.post.mockReset();
  mockedApi.put.mockReset();
});

describe("LeaseNoticeModal : retirer un congé", () => {
  it("« Annuler » dans la confirmation : rien n'est envoyé, le congé reste en cours", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(enCours());
    afficher();

    await user.click(await screen.findByRole("button", { name: "Retirer le congé" }));
    await user.click(screen.getByRole("button", { name: "Annuler" }));

    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(screen.getByText("Congé en cours")).toBeInTheDocument();
  });

  it("refusé par le serveur : l'erreur s'affiche, le congé reste en cours, rien n'est annoncé comme retiré", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(enCours());
    mockedApi.post.mockRejectedValueOnce(erreurServeur("Ce congé a déjà donné lieu à un état des lieux de sortie finalisé."));
    const { onChange } = afficher();

    await user.click(await screen.findByRole("button", { name: "Retirer le congé" }));
    await user.click(screen.getByRole("button", { name: "Oui, retirer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ce congé a déjà donné lieu à un état des lieux de sortie finalisé.");
    expect(screen.queryByText("Congés retirés")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled(); // la liste des baux n'est pas rechargée comme si le bail était repris
    expect(screen.getByRole("button", { name: "Oui, retirer" })).toBeEnabled(); // pas bloqué sur « Retrait… »
  });
});

describe("LeaseNoticeModal : enregistrer un congé refusé ou à moitié enregistré", () => {
  async function remplir(user: ReturnType<typeof userEvent.setup>, avecScan: boolean) {
    await user.type(await screen.findByLabelText("Huissier (étude)"), "Étude Me Ndiaye");
    await user.type(screen.getByLabelText("Référence de l'acte"), "ACTE-0142");
    await user.type(screen.getByLabelText("Date de signification"), "2026-03-10");
    await user.type(screen.getByLabelText("Durée du préavis"), "3");
    if (avecScan) await user.upload(screen.getByLabelText("Document remis au locataire (scan)"), pdf());
    await user.click(screen.getByRole("button", { name: "Enregistrer le congé" }));
  }

  it("refusé par le serveur : l'erreur s'affiche dans le formulaire, rien n'est annoncé comme enregistré", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(reponse());
    mockedApi.post.mockRejectedValueOnce(erreurServeur("Un congé est déjà en cours pour ce bail."));
    const { onChange } = afficher();

    await remplir(user, false);

    expect(await screen.findByRole("alert")).toHaveTextContent("Un congé est déjà en cours pour ce bail.");
    expect(screen.queryByText("Congé en cours")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(mockedApi.post).toHaveBeenCalledTimes(1);
  });

  it("congé enregistré mais scan refusé : le dit clairement (le congé EST enregistré), et la liste des baux est rechargée", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(reponse()).mockResolvedValueOnce(enCours());
    mockedApi.post.mockResolvedValueOnce({ data: conge() }).mockRejectedValueOnce(erreurServeur("Le fichier est illisible."));
    const { onChange } = afficher();

    await remplir(user, true);

    await waitFor(() => expect(onChange).toHaveBeenCalled()); // le congé est bien pris en compte
    expect(await screen.findByText("Congé en cours")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Le congé est enregistré, mais le scan n'a pas pu être joint : Le fichier est illisible.");
  });
});

describe("LeaseNoticeModal : joindre le scan à un congé en cours", () => {
  const champFichier = (conteneur: HTMLElement) => conteneur.querySelector('input[type="file"]') as HTMLInputElement;

  it("envoie le fichier au bon congé, puis recharge et prévient la liste des baux", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(enCours()).mockResolvedValueOnce(enCours({ documentUrl: "https://test.local/acte.pdf" }));
    mockedApi.post.mockResolvedValueOnce({ data: conge() });
    const { onChange, container } = afficher();
    await screen.findByText("Congé en cours");

    await user.upload(champFichier(container), pdf());

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith("/contracts/c1/notices/n1/document", expect.any(FormData), expect.anything()));
    expect(((mockedApi.post.mock.calls[0][1]) as FormData).get("document")).toBeInstanceOf(File);
    expect(await screen.findByRole("link", { name: "Voir le document" })).toHaveAttribute("href", "https://test.local/acte.pdf");
    expect(onChange).toHaveBeenCalled();
  });

  it("refusé par le serveur : l'erreur s'affiche, rien n'est annoncé comme joint, le bouton n'est pas bloqué", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(enCours());
    mockedApi.post.mockRejectedValueOnce(erreurServeur("Format de fichier non accepté."));
    const { onChange, container } = afficher();
    await screen.findByText("Congé en cours");

    await user.upload(champFichier(container), pdf());

    expect(await screen.findByRole("alert")).toHaveTextContent("Format de fichier non accepté.");
    expect(screen.queryByRole("link", { name: "Voir le document" })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Joindre le scan/ })).toBeEnabled();
  });
});
