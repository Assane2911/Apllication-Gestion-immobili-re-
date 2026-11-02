import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { CurrencyContext } from "../context/currency";
import type { Contract } from "../types";
import DepositRefundModal from "./DepositRefundModal";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { put: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });
const devise = { formatMoney: (n: number) => `${n} €` } as never;
const contrat = { id: "c1", deposit: 1000, currency: "EUR", property: { title: "Villa Baobab" } } as unknown as Contract;

function afficher() {
  const onSuccess = vi.fn();
  render(
    <CurrencyContext.Provider value={devise}>
      <DepositRefundModal contract={contrat} onSuccess={onSuccess} onClose={vi.fn()} />
    </CurrencyContext.Provider>
  );
  return { onSuccess };
}

describe("DepositRefundModal", () => {
  beforeEach(() => mockedApi.put.mockReset());

  it("ajoute une retenue pré-remplie avec un motif courant, et totalise les retenues", async () => {
    const user = userEvent.setup();
    afficher();
    const totaux = screen.getByText("Retenues").closest("div") as HTMLElement;
    expect(within(totaux).getByText("0 €")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ Ménage" }));
    const motif = screen.getByLabelText("Motif");
    expect(motif).toHaveValue("Ménage");
    await user.type(screen.getByLabelText("Montant"), "150");

    expect(within(totaux).getByText("150 €")).toBeInTheDocument();
    expect(within(totaux).getByText("15 % du dépôt retenu")).toBeInTheDocument();
  });

  it("bloque la validation quand les retenues dépassent le dépôt", async () => {
    const user = userEvent.setup();
    afficher();
    await user.click(screen.getByRole("button", { name: "+ Peinture" }));
    await user.type(screen.getByLabelText("Montant"), "1200");
    expect(screen.getByRole("button", { name: /Enregistrer la restitution/ })).toBeDisabled();
  });

  it("n'envoie que les retenues complètes", async () => {
    const user = userEvent.setup();
    mockedApi.put.mockResolvedValueOnce({ data: {} });
    const { onSuccess } = afficher();
    await user.click(screen.getByRole("button", { name: "+ Réparations" }));
    await user.type(screen.getByLabelText("Montant"), "80");
    await user.click(screen.getByRole("button", { name: "+ Ajouter une retenue" }));
    await user.click(screen.getByRole("button", { name: /Enregistrer la restitution/ }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(mockedApi.put).toHaveBeenCalledWith("/contracts/c1/deposit-refund", { deductions: [{ label: "Réparations", amount: 80 }] });
  });
});
