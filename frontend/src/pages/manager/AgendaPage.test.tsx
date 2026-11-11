import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { CurrencyContext } from "../../context/currency";
import type { EvenementAgenda } from "../../types";
import AgendaPage from "./AgendaPage";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { get: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });
const devise = { formatMoney: (n: number) => `${n} €` } as never;

// Jour courant : 15 juin 2026 (les écarts « dans X jours » en dépendent).
const evt = (id: string, type: EvenementAgenda["type"], date: string, extra: Partial<EvenementAgenda> = {}): EvenementAgenda => ({
  id, type, date, enRetard: false, propertyId: "p", propertyTitle: "Villa Baobab", contractId: "c", tenantName: null, amount: null, currency: null, label: null, ...extra,
});
const liste: EvenementAgenda[] = [
  evt("r1", "RENT_DUE", "2026-05-05T00:00:00.000Z", { enRetard: true, tenantName: "Awa Sow", amount: 300, currency: "EUR", propertyTitle: "Studio Plateau" }),
  evt("r2", "RENT_DUE", "2026-06-20T00:00:00.000Z", { tenantName: "Moussa Ba", amount: 500, currency: "EUR" }),
  evt("a1", "INSURANCE_EXPIRY", "2026-07-02T00:00:00.000Z", { label: "AXA" }),
  evt("l1", "LEASE_END", "2026-07-31T00:00:00.000Z", { tenantName: "Fatou Diop" }),
];

function afficher() {
  return render(
    <MemoryRouter>
      <CurrencyContext.Provider value={devise}>
        <AgendaPage />
      </CurrencyContext.Provider>
    </MemoryRouter>
  );
}

describe("AgendaPage", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 15, 9, 0, 0));
  });

  it("charge l'agenda sur 90 jours et met le retard en tête, puis les mois à venir", async () => {
    mockedApi.get.mockResolvedValue({ data: liste });
    afficher();

    expect(await screen.findByRole("region", { name: /En retard \(1\)/ })).toBeInTheDocument();
    expect(mockedApi.get).toHaveBeenCalledWith("/agenda", expect.objectContaining({ params: { days: 90 } }));
    expect(screen.getByText("Studio Plateau")).toBeInTheDocument();
    expect(screen.getByText(/Reste à payer : 300 €/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /juin 2026/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /juillet 2026/i })).toBeInTheDocument();
    expect(screen.getByText(/Dans 5 jours/)).toBeInTheDocument();
    expect(screen.getByText(/Retard de 41 j/)).toBeInTheDocument();
  });

  it("relie chaque échéance à l'écran où on la traite", async () => {
    mockedApi.get.mockResolvedValue({ data: liste });
    afficher();
    await screen.findByText("Studio Plateau");

    const juillet = screen.getByRole("region", { name: /juillet 2026/i });
    const liens = within(juillet).getAllByRole("link", { name: "Ouvrir" });
    expect(liens.map((l) => l.getAttribute("href"))).toEqual(["/assurances", "/contracts"]);
  });

  it("filtre par type et par recherche", async () => {
    mockedApi.get.mockResolvedValue({ data: liste });
    vi.useRealTimers();
    const user = userEvent.setup();
    afficher();
    await screen.findByText("Studio Plateau");

    await user.click(screen.getByRole("button", { name: /Assurance/ }));
    expect(screen.queryByText("Studio Plateau")).not.toBeInTheDocument();
    expect(screen.getByText(/AXA/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Tous/ }));
    await user.type(screen.getByRole("searchbox"), "fatou");
    expect(screen.queryByText(/AXA/)).not.toBeInTheDocument();
    expect(screen.getByText(/Fatou Diop/)).toBeInTheDocument();
  });

  it("recharge avec l'horizon choisi", async () => {
    mockedApi.get.mockResolvedValue({ data: liste });
    vi.useRealTimers();
    const user = userEvent.setup();
    afficher();
    await screen.findByText("Studio Plateau");

    await user.selectOptions(screen.getByLabelText("Horizon"), "366");

    await waitFor(() => expect(mockedApi.get).toHaveBeenLastCalledWith("/agenda", expect.objectContaining({ params: { days: 366 } })));
  });

  it("affiche l'état vide quand il n'y a rien à signaler", async () => {
    mockedApi.get.mockResolvedValue({ data: [] });
    afficher();
    expect(await screen.findByText("Rien à signaler")).toBeInTheDocument();
  });

  it("affiche l'erreur et permet de réessayer", async () => {
    mockedApi.get.mockRejectedValueOnce({ isAxiosError: true, response: { data: { error: "Erreur serveur" } } });
    afficher();
    expect(await screen.findByText("Erreur serveur")).toBeInTheDocument();

    mockedApi.get.mockResolvedValueOnce({ data: liste });
    vi.useRealTimers();
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Studio Plateau")).toBeInTheDocument();
  });
});
