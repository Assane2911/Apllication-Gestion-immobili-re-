import { describe, expect, it } from "vitest";
import { CODES_PAYS_ACCEPTES } from "./pays";
import { delaiMiseEnDemeureParDefaut, mentionMiseEnDemeure } from "./reglesPays";

/**
 * Les règles de location propres à chaque pays. Seuls le Sénégal (COCC, art. 571) et le Burkina Faso (loi n° 103-2015/CNT,
 * art. 28 à 30) en portent aujourd'hui, tirées de textes que l'équipe a lus ; les autres pays gardent le comportement neutre d'avant (8 jours, aucune mention) tant que leurs
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

  it("Burkina Faso : 15 jours par défaut et une mention qui rappelle le commandement de payer", () => {
    expect(delaiMiseEnDemeureParDefaut("BF")).toBe(15);
    const mention = mentionMiseEnDemeure("BF");
    expect(mention).toContain("commandement de payer");
    expect(mention).toContain("quinze jours");
    expect(mention).toContain("103-2015/CNT");
    expect(mention).toContain("articles 28 à 30");
    expect(mention).toMatch(/ne remplace pas/);
  });

  it("tout autre pays, et un compte sans pays : le comportement d'avant (8 jours, aucune mention)", () => {
    for (const code of CODES_PAYS_ACCEPTES.filter((c) => c !== "SN" && c !== "BF")) {
      expect(delaiMiseEnDemeureParDefaut(code), code).toBe(8);
      expect(mentionMiseEnDemeure(code), code).toBeNull();
    }
    expect(delaiMiseEnDemeureParDefaut(null)).toBe(8);
    expect(delaiMiseEnDemeureParDefaut(undefined)).toBe(8);
    expect(mentionMiseEnDemeure(null)).toBeNull();
    expect(delaiMiseEnDemeureParDefaut("XX")).toBe(8);
  });

  it("n'attribue pas le COCC aux autres pays de l'UEMOA", () => {
    for (const code of ["CI", "ML", "BJ", "TG", "NE", "GW"]) expect(mentionMiseEnDemeure(code), code).toBeNull();
    expect(mentionMiseEnDemeure("BF")).not.toContain("Code des obligations civiles et commerciales");
  });
});
