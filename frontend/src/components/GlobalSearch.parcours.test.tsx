import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { SearchResultItem } from "../types";
import GlobalSearch from "./GlobalSearch";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, api: { get: vi.fn() } };
});

const mockedApi = vi.mocked(api, { deep: true });

/**
 * La recherche globale : ce qui arrive quand le serveur échoue, quand on choisit un résultat, qu'on efface la saisie ou qu'on
 * clique ailleurs. Une recherche en panne ne doit jamais laisser des résultats périmés à l'écran, ni faire croire à un « aucun
 * résultat » trompeur sans que la liste soit vidée.
 */

const resultat = (extra: Partial<SearchResultItem> = {}): SearchResultItem => ({
  id: "t1",
  type: "tenant",
  title: "Awa Diallo",
  subtitle: "Locataire",
  link: "/tenants/t1",
  ...extra,
});

function Chemin() {
  return <p data-testid="chemin">{useLocation().pathname}</p>;
}

function afficher() {
  return render(
    <MemoryRouter initialEntries={["/accueil"]}>
      <GlobalSearch />
      <Routes>
        <Route path="*" element={<Chemin />} />
      </Routes>
    </MemoryRouter>
  );
}

const champ = () => screen.getByPlaceholderText("Rechercher un locataire, un bien, un contrat...") as HTMLInputElement;

async function saisir(valeur: string) {
  fireEvent.change(champ(), { target: { value: valeur } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

describe("GlobalSearch : parcours", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("serveur en panne : aucun résultat périmé ne reste affiché, et l'état « recherche… » s'arrête", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { query: "awa", results: [resultat()] } });
    afficher();
    await saisir("awa");
    expect(screen.getByText("Awa Diallo")).toBeInTheDocument();

    mockedApi.get.mockRejectedValueOnce(new Error("Réseau coupé"));
    await saisir("awa d");

    expect(screen.queryByText("Awa Diallo")).not.toBeInTheDocument();
    expect(screen.queryByText("Recherche...")).not.toBeInTheDocument();
    expect(screen.getAllByText("Aucun résultat pour « awa d »").length).toBeGreaterThan(0);
  });

  it("une saisie sans résultat le dit, avec les mots cherchés", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { query: "zzz", results: [] } });
    afficher();

    await saisir("zzz");

    expect(screen.getAllByText("Aucun résultat pour « zzz »").length).toBeGreaterThan(0);
  });

  it("une seule lettre ne lance aucune recherche", async () => {
    afficher();

    await saisir("a");

    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it("choisir un résultat ouvre sa page, ferme la liste et vide la saisie", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { query: "awa", results: [resultat({ link: "/tenants/t1" })] } });
    afficher();
    await saisir("awa");

    fireEvent.click(screen.getByText("Awa Diallo"));

    expect(screen.getByTestId("chemin")).toHaveTextContent("/tenants/t1");
    expect(champ().value).toBe("");
    expect(screen.queryByText("Awa Diallo")).not.toBeInTheDocument();
  });

  it("« Effacer la recherche » vide la saisie et les résultats", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { query: "awa", results: [resultat()] } });
    afficher();
    await saisir("awa");

    fireEvent.click(screen.getByRole("button", { name: "Effacer la recherche" }));

    expect(champ().value).toBe("");
    expect(screen.queryByText("Awa Diallo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Effacer la recherche" })).not.toBeInTheDocument();
  });

  it("un clic ailleurs dans la page referme la liste, sans perdre la saisie", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { query: "awa", results: [resultat()] } });
    afficher();
    await saisir("awa");
    expect(screen.getByText("Awa Diallo")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByText("Awa Diallo")).not.toBeInTheDocument();
    expect(champ().value).toBe("awa");
  });

  it("annonce aux lecteurs d'écran le nombre de résultats", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { query: "a", results: [resultat(), resultat({ id: "t2", title: "Moussa Sow" })] } });
    afficher();

    await saisir("aw");

    expect(screen.getByRole("status")).toHaveTextContent("2 résultats");
  });
});
