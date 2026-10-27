import { describe, expect, it } from "vitest";
import { CODES_PAYS_ACCEPTES } from "./pays";
import { delaiMiseEnDemeureParDefaut, mentionMiseEnDemeure } from "./reglesPays";

/**
 * Les règles de location propres à chaque pays. Seul le Sénégal en porte aujourd'hui, tirées du COCC (art. 571) que
 * l'équipe a lu ; les autres pays gardent le comportement neutre d'avant (8 jours, aucune mention) tant que leurs
 * règles n'ont pas été lues et validées. Le COCC est un code sénégalais, pas un texte de l'UEMOA.
 */
describe("règles par pays — mise en demeure", () => {
  it("Sénégal : 30 jours par défaut et une mention qui rappelle l'acte extrajudiciaire", () => {
    expect(delaiMiseEnDemeureParDefaut("SN")).toBe(30);
    const mention = mentionMiseEnDemeure("SN");
    expect(mention).toContain("acte extrajudiciaire");
    expect(mention).toContain("article 571");
    expect(mention).toMatch(/ne remplace pas|ne se substitue pas/);
  });

  it("tout autre pays, et un compte sans pays : le comportement d'avant (8 jours, aucune mention)", () => {
    for (const code of CODES_PAYS_ACCEPTES.filter((c) => c !== "SN")) {
      expect(delaiMiseEnDemeureParDefaut(code), code).toBe(8);
      expect(mentionMiseEnDemeure(code), code).toBeNull();
    }
    expect(delaiMiseEnDemeureParDefaut(null)).toBe(8);
    expect(delaiMiseEnDemeureParDefaut(undefined)).toBe(8);
    expect(mentionMiseEnDemeure(null)).toBeNull();
    expect(delaiMiseEnDemeureParDefaut("XX")).toBe(8);
  });

  it("n'attribue pas le COCC aux autres pays de l'UEMOA", () => {
    for (const code of ["CI", "ML", "BF", "BJ", "TG", "NE", "GW"]) expect(mentionMiseEnDemeure(code), code).toBeNull();
  });
});
