import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
 * Recherche globale : Échap ne fermait pas la liste de résultats (mesuré dans un navigateur), et rien n'annonçait aux
 * lecteurs d'écran qu'une recherche était en cours, ni combien de résultats elle avait trouvés.
 */
const resultat = (id: string, titre: string): SearchResultItem => ({ id, type: "tenant", title: titre, subtitle: "Locataire", link: `/tenants/${id}` });

const champ = () => screen.getByPlaceholderText("Rechercher un locataire, un bien, un contrat...");

async function chercher(valeur: string, resultats: SearchResultItem[]) {
  mockedApi.get.mockResolvedValueOnce({ data: { query: valeur, results: resultats } });
  render(
    <MemoryRouter>
      <GlobalSearch />
    </MemoryRouter>
  );
  fireEvent.change(champ(), { target: { value: valeur } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

describe("GlobalSearch — clavier et lecteur d'écran", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("Échap ferme la liste des résultats sans effacer la saisie", async () => {
    await chercher("awa", [resultat("t1", "Awa Diallo")]);
    expect(screen.getByText("Awa Diallo")).toBeInTheDocument();

    fireEvent.keyDown(champ(), { key: "Escape" });

    expect(screen.queryByText("Awa Diallo")).not.toBeInTheDocument();
    expect(champ()).toHaveValue("awa");
  });

  it("Échap fonctionne aussi depuis un résultat de la liste", async () => {
    await chercher("awa", [resultat("t1", "Awa Diallo")]);
    const bouton = screen.getByText("Awa Diallo").closest("button") as HTMLButtonElement;
    bouton.focus();

    fireEvent.keyDown(bouton, { key: "Escape" });

    expect(screen.queryByText("Awa Diallo")).not.toBeInTheDocument();
  });

  it("annonce le nombre de résultats dans une région de statut", async () => {
    await chercher("awa", [resultat("t1", "Awa Diallo"), resultat("t2", "Awa Ba")]);
    expect(screen.getByRole("status")).toHaveTextContent("2 résultats");
  });

  it("annonce l'absence de résultat, et un seul résultat au singulier", async () => {
    await chercher("zzz", []);
    expect(screen.getByRole("status")).toHaveTextContent("Aucun résultat pour « zzz »");
  });

  it("annonce « 1 résultat » au singulier", async () => {
    await chercher("awa", [resultat("t1", "Awa Diallo")]);
    expect(screen.getByRole("status")).toHaveTextContent(/^1 résultat$/);
  });

  it("la région de statut est présente (et vide) avant toute recherche : c'est ce qui permet de l'annoncer ensuite", () => {
    render(
      <MemoryRouter>
        <GlobalSearch />
      </MemoryRouter>
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
