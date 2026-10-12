import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { CurrencyContext } from "../context/currency";
import RentRevisionModal, { apercuNouveauLoyer, moisProposes } from "./RentRevisionModal";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });

const devise = { formatMoney: (n: number) => `${n} €` } as never;

function afficher(props: Partial<React.ComponentProps<typeof RentRevisionModal>> = {}) {
  const onSuccess = vi.fn();
  const onClose = vi.fn();
  render(
    <CurrencyContext.Provider value={devise}>
      <RentRevisionModal contractId="c1" rent={500} currency="EUR" endDate="2099-12-31T00:00:00.000Z" onSuccess={onSuccess} onClose={onClose} {...props} />
    </CurrencyContext.Provider>
  );
  return { onSuccess, onClose };
}

beforeEach(() => {
  mockedApi.get.mockReset().mockResolvedValue({ data: [] });
  mockedApi.post.mockReset();
  mockedApi.delete.mockReset();
});

describe("apercuNouveauLoyer", () => {
  const vide = { percent: "", indexOld: "", indexNew: "", amount: "" };
  it("calcule comme le serveur : pourcentage, indice, montant, virgule décimale, arrondi au centime", () => {
    expect(apercuNouveauLoyer(500, "PERCENT", { ...vide, percent: "3" })).toBe(515);
    expect(apercuNouveauLoyer(500, "PERCENT", { ...vide, percent: "2,5" })).toBe(512.5);
    expect(apercuNouveauLoyer(500, "INDEX", { ...vide, indexOld: "142,06", indexNew: "144" })).toBe(506.83);
    expect(apercuNouveauLoyer(500, "AMOUNT", { ...vide, amount: "540" })).toBe(540);
  });
  it("renvoie null tant que la saisie est incomplète ou absurde", () => {
    expect(apercuNouveauLoyer(500, "PERCENT", vide)).toBeNull();
    expect(apercuNouveauLoyer(500, "INDEX", { ...vide, indexOld: "0", indexNew: "144" })).toBeNull();
    expect(apercuNouveauLoyer(500, "AMOUNT", { ...vide, amount: "-3" })).toBeNull();
    expect(apercuNouveauLoyer(500, "AMOUNT", { ...vide, amount: "abc" })).toBeNull();
  });
});

describe("moisProposes", () => {
  it("part du mois en cours, en premier de mois, et s'arrête à la fin du bail", () => {
    expect(moisProposes("2026-12-20T00:00:00.000Z", new Date("2026-10-12T09:00:00Z"))).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
  });
  it("plafonne à 24 mois", () => {
    expect(moisProposes("2099-01-01T00:00:00.000Z", new Date("2026-10-12T09:00:00Z"))).toHaveLength(24);
  });
});

describe("RentRevisionModal", () => {
  it("montre le nouveau loyer avant validation, puis envoie la révision au serveur", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: {} });
    const { onSuccess } = afficher();

    await user.type(screen.getByLabelText("Variation (%)"), "3");
    expect(screen.getByRole("status")).toHaveTextContent("Nouveau loyer : 515 € (+15 €)");
    await user.type(screen.getByLabelText("Note (facultative, jointe à l'email)"), "Indexation annuelle");
    await user.click(screen.getByRole("button", { name: "Réviser le loyer" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const [url, corps] = mockedApi.post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe("/contracts/c1/rent-revisions");
    expect(corps).toMatchObject({ mode: "PERCENT", percent: 3, notifyTenant: true, note: "Indexation annuelle" });
    expect(corps.effectiveDate).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it("le mode indice envoie les deux valeurs et le nom de l'indice", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockResolvedValueOnce({ data: {} });
    afficher();
    await user.click(screen.getByRole("radio", { name: "Indice (IRL…)" }));
    await user.type(screen.getByLabelText("Nom de l'indice (facultatif)"), "IRL");
    await user.type(screen.getByLabelText("Valeur de référence (ancienne)"), "142,06");
    await user.type(screen.getByLabelText("Dernière valeur publiée"), "144");
    expect(screen.getByRole("status")).toHaveTextContent("506.83");
    await user.click(screen.getByRole("button", { name: "Réviser le loyer" }));
    await waitFor(() => expect(mockedApi.post).toHaveBeenCalled());
    expect(mockedApi.post.mock.calls[0][1]).toMatchObject({ mode: "INDEX", indexName: "IRL", indexOld: 142.06, indexNew: 144 });
  });

  it("le bouton reste inactif tant que le calcul est incomplet, et l'erreur du serveur s'affiche", async () => {
    const user = userEvent.setup();
    mockedApi.post.mockRejectedValueOnce({ isAxiosError: true, response: { data: { error: "Le loyer de 10/2026 est déjà encaissé : choisissez un mois suivant." } } });
    afficher();
    expect(screen.getByRole("button", { name: "Réviser le loyer" })).toBeDisabled();
    await user.type(screen.getByLabelText("Variation (%)"), "3");
    await user.click(screen.getByRole("button", { name: "Réviser le loyer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("déjà encaissé");
  });

  it("affiche l'historique, et une révision programmée à la place du formulaire, avec son annulation", async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValue({
      data: [
        { id: "r2", previousRent: 515, newRent: 530, effectiveDate: "2027-01-01T00:00:00.000Z", method: "AMOUNT", status: "PENDING", percent: null, indexName: null, indexOld: null, indexNew: null, note: null, tenantNotifiedAt: null },
        { id: "r1", previousRent: 500, newRent: 515, effectiveDate: "2026-10-01T00:00:00.000Z", method: "PERCENT", status: "APPLIED", percent: 3, indexName: null, indexOld: null, indexNew: null, note: null, tenantNotifiedAt: null },
      ],
    });
    mockedApi.delete.mockResolvedValueOnce({});
    afficher();

    expect(await screen.findByText(/Une révision est programmée : 515 € → 530 €/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Variation (%)")).not.toBeInTheDocument();
    expect(screen.getByText("(Appliquée)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Annuler cette révision" }));
    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith("/contracts/c1/rent-revisions/r2"));
  });
});
