import { describe, expect, it } from "vitest";
import { buildPaginatedResult, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, parsePagination } from "./pagination";

function reqWithQuery(query: Record<string, string>) {
  return { query } as any;
}

describe("parsePagination", () => {
  it("applique les valeurs par défaut sans paramètres", () => {
    const result = parsePagination(reqWithQuery({}));
    expect(result).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE, offset: 0 });
  });

  it("calcule l'offset correctement pour une page donnée", () => {
    const result = parsePagination(reqWithQuery({ page: "3", pageSize: "10" }));
    expect(result).toEqual({ page: 3, pageSize: 10, offset: 20 });
  });

  it("plafonne pageSize à MAX_PAGE_SIZE même si le client en demande plus", () => {
    const result = parsePagination(reqWithQuery({ pageSize: "999999" }));
    expect(result.pageSize).toBe(MAX_PAGE_SIZE);
  });

  it("ramène une page négative ou nulle à 1", () => {
    expect(parsePagination(reqWithQuery({ page: "0" })).page).toBe(1);
    expect(parsePagination(reqWithQuery({ page: "-5" })).page).toBe(1);
  });

  it("ignore les valeurs non numériques et retombe sur les défauts", () => {
    const result = parsePagination(reqWithQuery({ page: "abc", pageSize: "xyz" }));
    expect(result).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE, offset: 0 });
  });
});

describe("buildPaginatedResult", () => {
  it("calcule totalPages par excès", () => {
    const result = buildPaginatedResult([1, 2, 3], 25, { page: 1, pageSize: 10, offset: 0 });
    expect(result.totalPages).toBe(3);
  });

  it("renvoie au moins 1 page même si total est 0", () => {
    const result = buildPaginatedResult([], 0, { page: 1, pageSize: 10, offset: 0 });
    expect(result.totalPages).toBe(1);
    expect(result.items).toEqual([]);
  });
});
