import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import WhatsappPlateforme from "./WhatsappPlateforme";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn() } };
});
const mocked = vi.mocked(api, { deep: true });

const mois = (m: string, envoyes = 0, echecs = 0, cout = 0) => ({ mois: m, envoyes, echecs, coutEstimeUsd: cout });
const agence = (id: string, nom: string, envoyes: number, echecs = 0, cout = 0) => ({ managerId: id, nom, ...mois("2026-11", envoyes, echecs, cout) });
const usage = (surcharge: Record<string, unknown> = {}) => ({
  configure: true,
  tarifUsd: 0.004,
  moisChoisi: "2026-11",
  mois: [mois("2026-11", 140, 5, 0.56), mois("2026-10", 7, 0, 0.028), mois("2026-09"), mois("2026-08"), mois("2026-07"), mois("2026-06")],
  agences: [agence("m-b", "Agence Baobab", 100, 4, 0.4), agence("m-a", "a@test.local", 40, 1, 0.16)],
  ...surcharge,
});

const rendre = () =>
  render(
    <MemoryRouter>
      <WhatsappPlateforme />
    </MemoryRouter>
  );

beforeEach(() => mocked.get.mockReset());

describe("WhatsappPlateforme", () => {
  it("résume le mois courant, puis détaille le total par mois et la part de chaque agence", async () => {
    mocked.get.mockResolvedValueOnce({ data: usage() });
    rendre();

    expect(await screen.findByText(/Ce mois-ci : 140 message\(s\)/)).toBeInTheDocument();
    expect(mocked.get).toHaveBeenCalledWith("/admin/whatsapp-usage", undefined);

    const [parMois, parAgence] = screen.getAllByRole("table");
    const lignesMois = within(parMois).getAllByRole("row").slice(1);
    expect(lignesMois).toHaveLength(6);
    expect(within(lignesMois[0]).getAllByRole("cell").map((c) => c.textContent)).toEqual(["140", "5", expect.stringMatching(/0[,.]56/)]);

    const lignesAgences = within(parAgence).getAllByRole("row").slice(1);
    expect(lignesAgences.map((l) => within(l).getByRole("rowheader").textContent)).toEqual(["Agence Baobab", "a@test.local"]);
    expect(within(lignesAgences[0]).getAllByRole("cell")[0]).toHaveTextContent("100");
  });

  it("relie chaque agence à sa fiche", async () => {
    mocked.get.mockResolvedValueOnce({ data: usage() });
    rendre();
    const lien = await screen.findByRole("link", { name: "Agence Baobab" });
    expect(lien).toHaveAttribute("href", "/admin/gestionnaires/m-b");
  });

  it("change de mois : redemande au serveur le détail de ce mois", async () => {
    const user = userEvent.setup();
    mocked.get.mockResolvedValueOnce({ data: usage() });
    mocked.get.mockResolvedValueOnce({ data: usage({ moisChoisi: "2026-10", agences: [{ managerId: "m-c", nom: "Agence Ndiaye", ...mois("2026-10", 7, 0, 0.028) }] }) });
    rendre();
    await screen.findByRole("link", { name: "Agence Baobab" });

    await user.selectOptions(screen.getByRole("combobox"), "2026-10");

    await waitFor(() => expect(mocked.get).toHaveBeenLastCalledWith("/admin/whatsapp-usage", { params: { mois: "2026-10" } }));
    expect(await screen.findByRole("link", { name: "Agence Ndiaye" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Agence Baobab" })).not.toBeInTheDocument();
  });

  it("sans envoi, le dit : aucune agence ce mois-là, et rien sur la période", async () => {
    mocked.get.mockResolvedValueOnce({ data: usage({ agences: [], mois: [mois("2026-11"), mois("2026-10"), mois("2026-09"), mois("2026-08"), mois("2026-07"), mois("2026-06")] }) });
    rendre();
    expect(await screen.findByText(/Aucune agence n'a envoyé de message WhatsApp en novembre 2026/)).toBeInTheDocument();
    expect(screen.getByText("Aucun message WhatsApp envoyé sur les six derniers mois.")).toBeInTheDocument();
  });

  it("prévient quand le service n'est pas branché, et rappelle que c'est une estimation", async () => {
    mocked.get.mockResolvedValueOnce({ data: usage({ configure: false }) });
    rendre();
    expect(await screen.findByText(/WhatsApp n'est pas branché sur la plateforme/)).toBeInTheDocument();
    expect(screen.getByText(/Estimation : messages acceptés par Meta/)).toHaveTextContent(/0[,.]004/);
    expect(screen.getByText(/La facture de Meta fait foi/)).toBeInTheDocument();
  });

  it("affiche l'erreur du serveur, et traite une réponse inattendue comme une consommation indisponible", async () => {
    mocked.get.mockRejectedValueOnce({ isAxiosError: true, response: { data: { error: "Accès refusé" } } });
    const { unmount } = rendre();
    expect(await screen.findByRole("alert")).toHaveTextContent("Accès refusé");
    unmount();

    mocked.get.mockResolvedValueOnce({ data: { total: 0 } });
    rendre();
    expect(await screen.findByRole("alert")).toHaveTextContent("Consommation indisponible.");
  });
});
