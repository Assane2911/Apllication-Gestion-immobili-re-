import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import BoutonExportCsv from "./BoutonExportCsv";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

describe("BoutonExportCsv", () => {
  let telechargements: string[];

  beforeEach(() => {
    mockedApi.get.mockReset();
    telechargements = [];
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
    // jsdom ne télécharge rien : on relève le nom que le navigateur aurait proposé.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      telechargements.push(this.download);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("demande le fichier avec les filtres de la page et le télécharge sous un nom daté", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: new Blob(["a;b"]) });
    render(<BoutonExportCsv chemin="/admin/exports/managers.csv" params={{ plan: "PRO" }} prefixeFichier="gestionnaires" />);

    await userEvent.click(screen.getByRole("button", { name: "Exporter en CSV" }));

    await waitFor(() => expect(telechargements).toHaveLength(1));
    expect(mockedApi.get).toHaveBeenCalledWith("/admin/exports/managers.csv", { params: { plan: "PRO" }, responseType: "blob" });
    expect(telechargements[0]).toMatch(/^gestionnaires-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });

  it("désactive le bouton pendant l'export, puis le rend", async () => {
    let terminer: (v: unknown) => void = () => {};
    mockedApi.get.mockReturnValueOnce(new Promise((r) => (terminer = r)) as never);
    render(<BoutonExportCsv chemin="/x.csv" prefixeFichier="x" />);

    await userEvent.click(screen.getByRole("button", { name: "Exporter en CSV" }));

    const enCours = screen.getByRole("button", { name: "Export en cours..." });
    expect(enCours).toBeDisabled();
    terminer({ data: new Blob(["a"]) });
    expect(await screen.findByRole("button", { name: "Exporter en CSV" })).toBeEnabled();
  });

  it("affiche le message du serveur, même lu dans un blob, et ne télécharge rien", async () => {
    const corps = new Blob([JSON.stringify({ error: "Paramètres de recherche invalides" })]);
    mockedApi.get.mockRejectedValueOnce({ isAxiosError: true, response: { data: corps } });
    render(<BoutonExportCsv chemin="/x.csv" prefixeFichier="x" />);

    await userEvent.click(screen.getByRole("button", { name: "Exporter en CSV" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Paramètres de recherche invalides");
    expect(telechargements).toHaveLength(0);
  });

  it("efface l'erreur précédente à la tentative suivante", async () => {
    mockedApi.get.mockRejectedValueOnce({ isAxiosError: true, response: { data: new Blob([JSON.stringify({ error: "Oups" })]) } });
    mockedApi.get.mockResolvedValueOnce({ data: new Blob(["a"]) });
    render(<BoutonExportCsv chemin="/x.csv" prefixeFichier="x" />);

    await userEvent.click(screen.getByRole("button", { name: "Exporter en CSV" }));
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: "Exporter en CSV" }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(telechargements).toHaveLength(1);
  });
});
