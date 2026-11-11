import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { CurrencyContext } from "../context/currency";
import type { Contract } from "../types";
import DepositRefundModal from "./DepositRefundModal";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { put: vi.fn(), get: vi.fn() } };
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
  beforeEach(() => {
    mockedApi.put.mockReset();
    mockedApi.get.mockReset();
    mockedApi.get.mockResolvedValue({ data: null });
  });

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
  describe("rappel du constat de sortie", () => {
    const constat = {
      property: { id: "p", title: "Villa Baobab" },
      entry: { id: "e", inspectionDate: "2026-01-10T00:00:00.000Z" },
      exit: { id: "s", inspectionDate: "2026-11-02T00:00:00.000Z" },
      rooms: [
        { name: "Salon", variation: "DEGRADE", entry: { condition: "BON", notes: "" }, exit: { condition: "MAUVAIS", notes: "tache au mur" } },
        { name: "Cuisine", variation: "INCHANGE", entry: { condition: "BON", notes: "" }, exit: { condition: "BON", notes: "" } },
      ],
      meters: [],
      keys: [{ label: "Porte d'entrée", entry: 3, exit: 2, missing: 1 }],
      summary: { degraded: 1, improved: 0, unchanged: 1, added: 0, removed: 0, missingKeys: 1 },
    };

    it("n'affiche rien quand il n'y a rien à comparer", async () => {
      afficher();
      await waitFor(() => expect(mockedApi.get).toHaveBeenCalledWith("/contracts/c1/exit-comparison"));
      expect(screen.queryByText("Constat de sortie")).not.toBeInTheDocument();
    });

    it("rappelle les pièces dégradées et les clés manquantes, et pré-remplit un motif sans montant", async () => {
      mockedApi.get.mockResolvedValue({ data: constat });
      const user = userEvent.setup();
      afficher();

      expect(await screen.findByText("tache au mur", { exact: false })).toBeInTheDocument();
      expect(screen.queryByText("Cuisine")).not.toBeInTheDocument();
      await user.click(screen.getAllByRole("button", { name: "Ajouter une retenue" })[0]);

      expect(screen.getByLabelText("Motif")).toHaveValue("Remise en état : Salon");
      expect(screen.getByLabelText("Montant")).toHaveValue(null);
      await user.click(screen.getAllByRole("button", { name: "Ajouter une retenue" })[1]);
      expect(screen.getAllByLabelText("Motif")[1]).toHaveValue("Clé manquante : Porte d'entrée");
    });

    it("dit qu'il n'y a rien à signaler quand tout est conforme", async () => {
      mockedApi.get.mockResolvedValue({ data: { ...constat, rooms: [constat.rooms[1]], keys: [] } });
      afficher();
      expect(await screen.findByText("Aucune dégradation ni clé manquante entre l'entrée et la sortie.")).toBeInTheDocument();
    });

    it("reste utilisable si le rappel ne se charge pas", async () => {
      mockedApi.get.mockRejectedValue(new Error("réseau"));
      afficher();
      await waitFor(() => expect(mockedApi.get).toHaveBeenCalled());
      expect(screen.getByRole("button", { name: "+ Ajouter une retenue" })).toBeInTheDocument();
    });
  });
});
