import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { CurrencyContext } from "../context/currency";
import MarkPaidModal from "./MarkPaidModal";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { post: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });
const devise = { formatMoney: (n: number) => `${n} €` } as never;

function afficher() {
  const onSuccess = vi.fn();
  render(
    <CurrencyContext.Provider value={devise}>
      <MarkPaidModal invoiceId="inv-1" tenantName="Awa Diallo" amountLabel="500 €" remaining={500} currency="EUR" onSuccess={onSuccess} onClose={vi.fn()} />
    </CurrencyContext.Provider>
  );
  return { onSuccess };
}

describe("MarkPaidModal — règlement partiel et solde", () => {
  beforeEach(() => mockedApi.post.mockReset());

  it("annonce ce qui reste dû après un paiement partiel, et propose de solder en un clic", async () => {
    const user = userEvent.setup();
    afficher();
    const montant = screen.getByLabelText("Montant encaissé");
    expect(screen.queryByText(/Reste dû après ce paiement/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Solder" })).not.toBeInTheDocument();

    await user.clear(montant);
    await user.type(montant, "200");
    expect(screen.getByText("Reste dû après ce paiement : 300 €")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Solder" }));
    expect(montant).toHaveValue(500);
    expect(screen.queryByText(/Reste dû après ce paiement/)).not.toBeInTheDocument();
  });

  it("envoie le montant saisi", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: {} });
    const { onSuccess } = afficher();
    const montant = screen.getByLabelText("Montant encaissé");
    await user.clear(montant);
    await user.type(montant, "200");
    await user.click(screen.getByRole("button", { name: /Enregistrer le paiement partiel|Confirmer/ }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(mockedApi.post).toHaveBeenCalledWith("/invoices/inv-1/mark-paid", expect.objectContaining({ amount: 200 }));
  });
});
