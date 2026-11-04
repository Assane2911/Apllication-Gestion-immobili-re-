import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import SectionWhatsapp from "./SectionWhatsapp";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn() } };
});
const mocked = vi.mocked(api, { deep: true });

const mois = (m: string, avis = 0, proche = 0, relance = 0, echecs = 0, cout = 0) => ({
  mois: m,
  parType: { avis_echeance: avis, echeance_proche: proche, relance_impaye: relance },
  envoyes: avis + proche + relance,
  echecs,
  coutEstimeUsd: cout,
});
const usage = (surcharge: Record<string, unknown> = {}) => ({
  inclus: true,
  configure: true,
  tarifUsd: 0.004,
  mois: [
    mois("2026-11", 40, 40, 20, 3, 0.4),
    mois("2026-10", 10, 10, 0, 0, 0.08),
    mois("2026-09"),
    mois("2026-08"),
    mois("2026-07"),
    mois("2026-06"),
  ],
  ...surcharge,
});

beforeEach(() => mocked.get.mockReset());

describe("SectionWhatsapp", () => {
  it("interroge l'agence demandée et affiche le mois courant, puis un tableau par mois et par type", async () => {
    mocked.get.mockResolvedValue({ data: usage() });
    render(<SectionWhatsapp managerId="mgr-9" numero="05" />);

    expect(await screen.findByText(/Ce mois-ci : 100 message\(s\)/)).toBeInTheDocument();
    expect(mocked.get).toHaveBeenCalledWith("/admin/managers/mgr-9/whatsapp-usage");
    expect(screen.getByText("Inclus dans sa formule")).toBeInTheDocument();

    const lignes = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(lignes).toHaveLength(6);
    const cellules = within(lignes[0]).getAllByRole("cell").map((c) => c.textContent);
    // avis, rappel avant échéance, relances, total, échecs
    expect(cellules.slice(0, 5)).toEqual(["40", "40", "20", "100", "3"]);
    expect(within(lignes[1]).getAllByRole("cell")[3]).toHaveTextContent("20");
  });

  it("chiffre le coût en dollars et explique que c'est une estimation, au tarif configuré", async () => {
    mocked.get.mockResolvedValue({ data: usage({ tarifUsd: 0.004 }) });
    render(<SectionWhatsapp managerId="m" numero="05" />);
    await screen.findByRole("table");
    expect(screen.getAllByText(/0[,.]40/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Estimation : messages acceptés par Meta/)).toHaveTextContent(/0[,.]004/);
    expect(screen.getByText(/La facture de Meta fait foi/)).toBeInTheDocument();
  });

  it("met les échecs en évidence, et dit qu'une agence sans envoi n'a rien consommé", async () => {
    mocked.get.mockResolvedValue({ data: usage({ mois: [mois("2026-11"), mois("2026-10"), mois("2026-09"), mois("2026-08"), mois("2026-07"), mois("2026-06")] }) });
    render(<SectionWhatsapp managerId="m" numero="05" />);
    expect(await screen.findByText("Aucun message WhatsApp envoyé pour cette agence sur la période.")).toBeInTheDocument();
  });

  it("signale une agence dont la formule n'inclut pas WhatsApp", async () => {
    mocked.get.mockResolvedValue({ data: usage({ inclus: false }) });
    render(<SectionWhatsapp managerId="m" numero="05" />);
    expect(await screen.findByText("Non inclus dans sa formule")).toBeInTheDocument();
  });

  it("prévient quand le service n'est pas branché : les envois sont simulés, donc non comptés", async () => {
    mocked.get.mockResolvedValue({ data: usage({ configure: false }) });
    render(<SectionWhatsapp managerId="m" numero="05" />);
    expect(await screen.findByText(/WhatsApp n'est pas branché sur la plateforme/)).toBeInTheDocument();
  });

  it("affiche l'erreur du serveur sans casser la fiche", async () => {
    mocked.get.mockRejectedValueOnce({ isAxiosError: true, response: { data: { error: "Gestionnaire introuvable" } } });
    render(<SectionWhatsapp managerId="m" numero="05" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Gestionnaire introuvable");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("traite une réponse inattendue comme une consommation indisponible", async () => {
    mocked.get.mockResolvedValue({ data: { id: "mgr-1" } });
    render(<SectionWhatsapp managerId="m" numero="05" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Consommation indisponible.");
  });
});
