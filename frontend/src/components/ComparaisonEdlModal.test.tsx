import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { ComparaisonEdl } from "../types";
import ComparaisonEdlModal from "./ComparaisonEdlModal";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn() } };
});
const mockedApi = vi.mocked(api, { deep: true });

const comparaison: ComparaisonEdl = {
  property: { id: "p1", title: "Studio Centre-ville" },
  entry: { id: "e1", inspectionDate: "2026-01-10T00:00:00.000Z" },
  exit: { id: "s1", inspectionDate: "2026-11-02T00:00:00.000Z" },
  rooms: [
    { name: "Salon", variation: "DEGRADE", entry: { condition: "BON", notes: "RAS" }, exit: { condition: "MAUVAIS", notes: "tache au mur" } },
    { name: "Cuisine", variation: "INCHANGE", entry: { condition: "BON", notes: "" }, exit: { condition: "BON", notes: "" } },
    { name: "Garage", variation: "AJOUTEE", entry: null, exit: { condition: "BON", notes: "" } },
  ],
  meters: [
    { type: "electricity", entry: "100", exit: "180", consumption: 80 },
    { type: "water", entry: "abc", exit: "300", consumption: null },
  ],
  keys: [{ label: "Porte d'entrée", entry: 3, exit: 2, missing: 1 }],
  summary: { degraded: 1, improved: 0, unchanged: 1, added: 1, removed: 0, missingKeys: 1 },
};

describe("ComparaisonEdlModal", () => {
  beforeEach(() => mockedApi.get.mockReset());

  it("charge la comparaison de l'état des lieux de sortie et l'affiche pièce par pièce", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: comparaison });
    render(<ComparaisonEdlModal inspectionId="s1" titre="Studio Centre-ville" onClose={() => {}} />);

    expect(await screen.findByText("Salon")).toBeInTheDocument();
    expect(mockedApi.get).toHaveBeenCalledWith("/inspections/s1/comparison", expect.anything());
    expect(screen.getByText("tache au mur")).toBeInTheDocument();
    expect(screen.getByText("Dégradée")).toBeInTheDocument();
    expect(screen.getByText("Nouvelle pièce")).toBeInTheDocument();
    expect(screen.getByText("Garage")).toBeInTheDocument();
  });

  it("affiche la consommation des compteurs et les clés manquantes", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: comparaison });
    render(<ComparaisonEdlModal inspectionId="s1" titre="Studio" onClose={() => {}} />);

    await screen.findByText("Salon");
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("non calculable")).toBeInTheDocument();
    expect(screen.getByText("1 manquante(s)")).toBeInTheDocument();
    expect(screen.getByText(/ne les chiffre pas/)).toBeInTheDocument();
  });

  it("montre le message du serveur quand il n'y a rien à comparer", async () => {
    mockedApi.get.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 404, data: { error: "x", code: "INSPECTION_COMPARE_NO_ENTRY" } },
    });
    render(<ComparaisonEdlModal inspectionId="s1" titre="Studio" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Aucun état des lieux d'entrée finalisé"));
  });
});
