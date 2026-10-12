import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { CurrencyContext } from "../context/currency";
import type { CrgSynthesis } from "../types";
import ReversementsSection from "./ReversementsSection";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });
const devise = { formatMoney: (n: number, c?: string) => `${n} ${c ?? "EUR"}` } as never;

function crg(extra: Partial<CrgSynthesis> = {}): CrgSynthesis {
  return {
    ownerId: "o1",
    ownerName: "Fatou Diop",
    managementFeeRate: 10,
    month: 9,
    year: 2026,
    properties: [],
    totalLoyersByCurrency: { EUR: 1000 },
    totalChargesByCurrency: { EUR: 100 },
    totalCommissionByCurrency: { EUR: 100 },
    totalNetByCurrency: { EUR: 800 },
    reversements: [{ id: "p1", currency: "EUR", amount: 500, paidAt: "2026-10-05T00:00:00.000Z", method: "BANK_TRANSFER", reference: "VIR-0925", note: null }],
    totalReverseByCurrency: { EUR: 500 },
    resteAReverserByCurrency: { EUR: 300 },
    ...extra,
  };
}

function afficher(donnees: CrgSynthesis, edition?: { ownerId: string; onChange: () => void }) {
  return render(
    <CurrencyContext.Provider value={devise}>
      <ReversementsSection crg={donnees} edition={edition} />
    </CurrencyContext.Provider>
  );
}

beforeEach(() => {
  mockedApi.post.mockReset();
  mockedApi.delete.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("ReversementsSection", () => {
  it("propriétaire : voit le net, le déjà reversé, le reste et le détail, sans formulaire", () => {
    afficher(crg());
    expect(screen.getByText("Net du mois 800 EUR · déjà reversé 500 EUR")).toBeInTheDocument();
    expect(screen.getByText("Reste à reverser : 300 EUR")).toBeInTheDocument();
    expect(screen.getByText(/Virement/)).toBeInTheDocument();
    expect(screen.getByText(/VIR-0925/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enregistrer le reversement" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Supprimer ce reversement" })).not.toBeInTheDocument();
  });

  it("signale un mois entièrement reversé, ou un trop-versé", () => {
    const { unmount } = afficher(crg({ resteAReverserByCurrency: { EUR: 0 } }));
    expect(screen.getByText("Entièrement reversé")).toBeInTheDocument();
    unmount();
    afficher(crg({ resteAReverserByCurrency: { EUR: -50 } }));
    expect(screen.getByText("Versé en trop : 50 EUR")).toBeInTheDocument();
  });

  it("gestionnaire : propose le reste dû et enregistre le reversement du mois affiché", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mockedApi.post.mockResolvedValueOnce({ data: {} });
    afficher(crg(), { ownerId: "o1", onChange });

    expect(screen.getByLabelText("Montant versé")).toHaveValue("300");
    await user.selectOptions(screen.getByLabelText("Moyen"), "MOBILE_MONEY");
    await user.type(screen.getByLabelText("Référence (facultative)"), "OM-77");
    await user.click(screen.getByRole("button", { name: "Enregistrer le reversement" }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(mockedApi.post).toHaveBeenCalledWith(
      "/crg/o1/payouts",
      expect.objectContaining({ month: 9, year: 2026, currency: "EUR", amount: 300, method: "MOBILE_MONEY", reference: "OM-77", notifyOwner: true })
    );
  });

  it("gestionnaire : affiche le refus du serveur et désactive l'envoi quand il ne reste rien", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValueOnce({ isAxiosError: true, response: { data: { error: "Le montant dépasse ce qui reste à reverser pour ce mois." } } });
    const { unmount } = afficher(crg(), { ownerId: "o1", onChange: vi.fn() });
    await user.clear(screen.getByLabelText("Montant versé"));
    await user.type(screen.getByLabelText("Montant versé"), "9000");
    await user.click(screen.getByRole("button", { name: "Enregistrer le reversement" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("dépasse ce qui reste");
    unmount();

    afficher(crg({ resteAReverserByCurrency: { EUR: 0 } }), { ownerId: "o1", onChange: vi.fn() });
    expect(screen.getByRole("button", { name: "Enregistrer le reversement" })).toBeDisabled();
  });

  it("gestionnaire : supprime un reversement après confirmation", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mockedApi.delete.mockResolvedValueOnce({});
    afficher(crg(), { ownerId: "o1", onChange });
    await user.click(screen.getByRole("button", { name: "Supprimer ce reversement" }));
    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/crg/o1/payouts/p1"));
    expect(onChange).toHaveBeenCalled();
  });

  it("un CRG sans champ de reversement (ancienne réponse) s'affiche sans erreur", () => {
    afficher(crg({ reversements: undefined, totalReverseByCurrency: undefined, resteAReverserByCurrency: undefined }));
    expect(screen.getByText("Aucun reversement enregistré pour ce mois.")).toBeInTheDocument();
  });
});
