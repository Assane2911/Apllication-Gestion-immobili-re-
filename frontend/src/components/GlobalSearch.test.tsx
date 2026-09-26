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

function result(overrides: Partial<SearchResultItem> = {}): SearchResultItem {
  return {
    id: "t1",
    type: "tenant",
    title: "Awa Diallo",
    subtitle: "Locataire",
    link: "/tenants/t1",
    ...overrides,
  };
}

function renderSearch() {
  return render(
    <MemoryRouter>
      <GlobalSearch />
    </MemoryRouter>
  );
}

describe("GlobalSearch", () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("interroge /search 300ms après la dernière frappe (débit) et affiche les résultats", async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { query: "awa", results: [result()] } });

    renderSearch();
    fireEvent.change(screen.getByPlaceholderText("Rechercher un locataire, un bien, un contrat..."), {
      target: { value: "awa" },
    });
    expect(mockedApi.get).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(screen.getByText("Awa Diallo")).toBeInTheDocument();
    expect(mockedApi.get).toHaveBeenCalledWith("/search", {
      params: { q: "awa" },
      signal: expect.anything(),
    });
  });

  /**
   * Régression : sans AbortController sur la requête debouncée, une réponse
   * pour une saisie plus ANCIENNE pouvait arriver après celle d'une saisie
   * plus récente (débit réseau variable) et écraser des résultats plus
   * pertinents par des résultats obsolètes. Le debounce protège seulement
   * contre l'ENVOI de requêtes en trop, pas contre l'ordre d'arrivée de
   * celles déjà parties.
   */
  it("n'affiche jamais les résultats d'une saisie antérieure arrivés en retard", async () => {
    let rejectFirst!: (err: unknown) => void;
    const firstRequest = new Promise((_resolve, reject) => {
      rejectFirst = reject;
    });
    mockedApi.get.mockImplementationOnce((_url: string, config?: { signal?: AbortSignal }) => {
      config?.signal?.addEventListener("abort", () => rejectFirst({ __CANCEL__: true }));
      return firstRequest;
    });

    renderSearch();
    const input = screen.getByPlaceholderText("Rechercher un locataire, un bien, un contrat...");
    fireEvent.change(input, { target: { value: "aw" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // La requête de "aw" est désormais en vol (jamais résolue) : l'utilisateur
    // tape la suite avant qu'elle ne réponde.
    mockedApi.get.mockResolvedValueOnce({
      data: { query: "awa", results: [result({ title: "Awa Diallo" })] },
    });
    fireEvent.change(input, { target: { value: "awa" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(screen.getByText("Awa Diallo")).toBeInTheDocument();
    await expect(firstRequest).rejects.toEqual({ __CANCEL__: true });
    expect(screen.getByText("Awa Diallo")).toBeInTheDocument();
  });
});
