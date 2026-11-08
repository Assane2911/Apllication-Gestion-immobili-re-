import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function afficher(onChange = vi.fn()) {
  render(
    <MemoryRouter>
      <LeaseNoticeModal contract={bail} onChange={onChange} onClose={vi.fn()} />
    </MemoryRouter>
  );
  return onChange;
}

beforeEach(() => {
  mockedApi.get.mockReset();
  mockedApi.post.mockReset();
  mockedApi.put.mockReset();
});

describe("LeaseNoticeModal — enregistrer un congé", () => {
  it("rappelle que l'application enregistre le congé sans le notifier", async () => {
    mockedApi.get.mockResolvedValueOnce(reponse());
    afficher();
    expect(await screen.findByText(/ENREGISTRE un congé donné par un autre moyen/)).toBeInTheDocument();
    expect(screen.getByText(/peut devoir être signifié par huissier de justice/)).toBeInTheDocument();
  });

  it("propose la date de sortie à partir de la signification et de la durée saisie, sans durée par défaut", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(reponse());
    afficher();
    const duree = await screen.findByLabelText("Durée du préavis");
    expect(duree).toHaveValue(null);

    await user.type(screen.getByLabelText("Date de signification"), "2026-03-10");
    await user.type(duree, "3");
    expect(screen.getByLabelText("Date de sortie prévue")).toHaveValue("2026-06-10");
  });

  it("n'affiche l'huissier et la référence de l'acte que pour un acte d'huissier", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce(reponse());
    afficher();
    expect(await screen.findByLabelText("Huissier (étude)")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Remis par"), "REGISTERED_MAIL");
    expect(screen.queryByLabelText("Huissier (étude)")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Date de réception")).toBeInTheDocument();
  });

  it("envoie le congé, puis le scan du document remis au locataire", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mockedApi.get.mockResolvedValueOnce(reponse()).mockResolvedValueOnce(reponse({ conges: [conge()], etapes: { etatDesLieuxDeSortie: "NONE", depotRestitue: false } }));
    mockedApi.post.mockResolvedValueOnce({ data: conge() }).mockResolvedValueOnce({ data: conge() });
    afficher(onChange);

    await user.type(await screen.findByLabelText("Huissier (étude)"), "Étude Me Ndiaye");
    await user.type(screen.getByLabelText("Référence de l'acte"), "ACTE-0142");
    await user.type(screen.getByLabelText("Date de signification"), "2026-03-10");
    await user.type(screen.getByLabelText("Durée du préavis"), "3");
    await user.upload(screen.getByLabelText("Document remis au locataire (scan)"), new File(["%PDF-1.4"], "acte.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer le congé" }));

    expect(mockedApi.post).toHaveBeenNthCalledWith(
      1,
      "/contracts/c1/notices",
      expect.objectContaining({
        givenBy: "LANDLORD",
        deliveryMode: "BAILIFF",
        servedAt: "2026-03-10",
        periodValue: 3,
        periodUnit: "MONTHS",
        exitDate: "2026-06-10",
        bailiffName: "Étude Me Ndiaye",
        actReference: "ACTE-0142",
      })
    );
    expect(mockedApi.post).toHaveBeenNthCalledWith(2, "/contracts/c1/notices/n1/document", expect.any(FormData), expect.anything());
    expect(await screen.findByText("Congé en cours")).toBeInTheDocument();
    expect(onChange).toHaveBeenCalled();
  });
});

describe("LeaseNoticeModal — congé en cours", () => {
  const enCours = (extra: Partial<LeaseNoticesResponse> = {}, noticeExtra: Partial<LeaseNotice> = {}) =>
    reponse({ conges: [conge(noticeExtra)], etapes: { etatDesLieuxDeSortie: "NONE", depotRestitue: false }, ...extra });

  it("résume le congé et la date de sortie, sans UTC décalé", async () => {
    mockedApi.get.mockResolvedValueOnce(enCours());
    afficher();
    expect(await screen.findByText("Congé en cours")).toBeInTheDocument();
    expect(screen.getByText("Étude Me Ndiaye")).toBeInTheDocument();
    expect(screen.getByText("ACTE-0142")).toBeInTheDocument();
    expect(screen.getByText("10/06/2026")).toBeInTheDocument();
    expect(screen.getByText("3 mois")).toBeInTheDocument();
  });

  it("montre l'avancement de la sortie et renvoie vers les états des lieux", async () => {
    mockedApi.get.mockResolvedValueOnce(enCours());
    afficher();
    expect(await screen.findByText("État des lieux de sortie : à faire")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ouvrir les états des lieux" })).toHaveAttribute("href", "/etats-des-lieux");
    expect(screen.getByText(/Dépôt de garantie : restitution à enregistrer/)).toBeInTheDocument();
  });

  it("signale les factures déjà émises après la sortie, sans les annuler", async () => {
    mockedApi.get.mockResolvedValueOnce(enCours({ facturesApresSortie: 2 }));
    afficher();
    expect(await screen.findByRole("note")).toHaveTextContent("2 facture(s) déjà émise(s)");
  });

  it("propose de joindre le scan quand aucun document n'est encore attaché, et le lien quand il l'est", async () => {
    mockedApi.get.mockResolvedValueOnce(enCours());
    afficher();
    expect(await screen.findByText("Aucun document joint pour l'instant.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Joindre le scan/ })).toBeInTheDocument();
  });

  it("affiche le lien vers le document joint", async () => {
    mockedApi.get.mockResolvedValueOnce(enCours({}, { documentUrl: "https://test.local/acte.pdf" }));
    afficher();
    expect(await screen.findByRole("link", { name: "Voir le document" })).toHaveAttribute("href", "https://test.local/acte.pdf");
    expect(screen.getByRole("button", { name: /Remplacer le scan/ })).toBeInTheDocument();
  });

  it("retire le congé après une confirmation", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mockedApi.get.mockResolvedValueOnce(enCours()).mockResolvedValueOnce(reponse({ conges: [conge({ status: "WITHDRAWN", withdrawnAt: "2026-04-01T00:00:00.000Z" })] }));
    mockedApi.post.mockResolvedValueOnce({ data: conge({ status: "WITHDRAWN" }) });
    afficher(onChange);

    await user.click(await screen.findByRole("button", { name: "Retirer le congé" }));
    expect(mockedApi.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Oui, retirer" }));

    expect(mockedApi.post).toHaveBeenCalledWith("/contracts/c1/notices/n1/withdraw");
    expect(await screen.findByText("Congés retirés")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer le congé" })).toBeInTheDocument();
    expect(onChange).toHaveBeenCalled();
  });

  it("modifie le congé en cours avec les valeurs déjà saisies", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValue(enCours());
    mockedApi.put.mockResolvedValueOnce({ data: conge({ periodValue: 2 }) });
    afficher();

    await user.click(await screen.findByRole("button", { name: "Modifier" }));
    expect(screen.getByLabelText("Durée du préavis")).toHaveValue(3);
    expect(screen.getByLabelText("Date de sortie prévue")).toHaveValue("2026-06-10");
    await user.clear(screen.getByLabelText("Durée du préavis"));
    await user.type(screen.getByLabelText("Durée du préavis"), "2");
    await user.click(screen.getByRole("button", { name: "Enregistrer le congé" }));

    expect(mockedApi.put).toHaveBeenCalledWith("/contracts/c1/notices/n1", expect.objectContaining({ periodValue: 2, exitDate: "2026-06-10" }));
  });
});
