import { describe, expect, it } from "vitest";
import { libelleSurface, titreDuBail } from "./typeBail";

describe("type de bail", () => {
  it.each([
    ["HABITATION", "CONTRAT DE BAIL D'HABITATION"],
    ["MEUBLE", "CONTRAT DE BAIL D'HABITATION MEUBLÉE"],
    ["COMMERCIAL", "CONTRAT DE BAIL COMMERCIAL"],
    ["PROFESSIONNEL", "CONTRAT DE BAIL PROFESSIONNEL"],
  ])("%s → « %s »", (type, titre) => {
    expect(titreDuBail(type)).toBe(titre);
  });

  it("un type absent ou inconnu retombe sur le bail d'habitation (tous les baux d'avant)", () => {
    expect(titreDuBail(undefined)).toBe("CONTRAT DE BAIL D'HABITATION");
    expect(titreDuBail(null)).toBe("CONTRAT DE BAIL D'HABITATION");
    expect(titreDuBail("INCONNU")).toBe("CONTRAT DE BAIL D'HABITATION");
  });

  it("« surface habitable » pour un logement, « surface » pour un local professionnel ou commercial", () => {
    expect(libelleSurface("HABITATION")).toBe("Surface habitable");
    expect(libelleSurface("MEUBLE")).toBe("Surface habitable");
    expect(libelleSurface(undefined)).toBe("Surface habitable");
    expect(libelleSurface("COMMERCIAL")).toBe("Surface");
    expect(libelleSurface("PROFESSIONNEL")).toBe("Surface");
  });
});
