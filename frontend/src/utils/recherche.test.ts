import { describe, expect, it } from "vitest";
import { correspond, normaliser } from "./recherche";

describe("normaliser", () => {
  it("retire accents et majuscules", () => {
    expect(normaliser("  Élodie Thiam ")).toBe("elodie thiam");
  });
});

describe("normaliser (ligatures)", () => {
  it("écrit les ligatures en deux lettres", () => {
    expect(normaliser("Sacré-Cœur")).toBe("sacre-coeur");
  });
});

describe("correspond", () => {
  it("accepte une requête vide", () => {
    expect(correspond("", "Studio")).toBe(true);
    expect(correspond("   ")).toBe(true);
  });

  it("ignore accents et casse", () => {
    expect(correspond("elodie", "Élodie", "Thiam")).toBe(true);
  });

  it("exige tous les mots, dans n'importe quel ordre et sur plusieurs champs", () => {
    expect(correspond("thiam elodie", "Élodie", "Thiam")).toBe(true);
    expect(correspond("thiam marc", "Élodie", "Thiam")).toBe(false);
  });

  it("ignore les champs vides", () => {
    expect(correspond("dakar", null, undefined, "Dakar Plateau")).toBe(true);
  });
});
