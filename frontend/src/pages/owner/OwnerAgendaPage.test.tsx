import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { EvenementAgenda } from "../../types";
import OwnerAgendaPage from "./OwnerAgendaPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });

const evt = (id: string, type: EvenementAgenda["type"], date: string, extra: Partial<EvenementAgenda> = {}): EvenementAgenda => ({
  id, type, date, enRetard: false, propertyId: "p", propertyTitle: "Villa Baobab", contractId: null, tenantName: null, amount: null, currency: null, label: null, ...extra,
});

const afficher = () => render(<MemoryRouter><OwnerAgendaPage /></MemoryRouter>);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-15T10:00:00.000Z"));
  mockedApi.get.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("OwnerAgendaPage", () => {
  it("charge ses échéances sur six mois et les range : dépassées en tête, puis par mois", async () => {
    mockedApi.get.mockResolvedValue({
      data: [
        evt("a1", "INSURANCE_EXPIRY", "2026-06-01T00:00:00.000Z", { enRetard: true, label: "AXA" }),
        evt("e1", "EXIT", "2026-07-01T00:00:00.000Z", { propertyTitle: "Studio Plateau" }),
        evt("l1", "LEASE_END", "2026-08-31T00:00:00.000Z"),
      ],
    } as never);
    afficher();

    expect(await screen.findByText("3 échéance(s)")).toBeInTheDocument();
    expect(mockedApi.get).toHaveBeenCalledWith("/owners/mine/agenda", expect.objectContaining({ params: { days: 180 } }));

    const retard = screen.getByRole("region", { name: /En retard/ });
    expect(within(retard).getByText("Villa Baobab")).toBeInTheDocument();
    expect(within(retard).getByText(/AXA/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /juillet 2026/i })).toHaveTextContent("Studio Plateau");
    expect(screen.getByRole("region", { name: /août 2026/i })).toHaveTextContent("Villa Baobab");
  });

  it("n'affiche aucun lien d'action : la page informe, l'agence traite", async () => {
    mockedApi.get.mockResolvedValue({ data: [evt("l1", "LEASE_END", "2026-08-31T00:00:00.000Z")] } as never);
    afficher();
    await screen.findByText("1 échéance(s)");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("recharge avec l'horizon choisi", async () => {
    vi.useRealTimers();
    mockedApi.get.mockResolvedValue({ data: [] } as never);
    afficher();
    await screen.findByText("Aucune échéance à venir");

    await userEvent.selectOptions(screen.getByLabelText("Horizon"), "30");

    expect(mockedApi.get).toHaveBeenLastCalledWith("/owners/mine/agenda", expect.objectContaining({ params: { days: 30 } }));
  });

  it("affiche l'erreur et permet de réessayer", async () => {
    vi.useRealTimers();
    mockedApi.get.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ data: [] } as never);
    afficher();

    await userEvent.click(await screen.findByRole("button", { name: "Réessayer" }));

    expect(await screen.findByText("Aucune échéance à venir")).toBeInTheDocument();
  });
});
