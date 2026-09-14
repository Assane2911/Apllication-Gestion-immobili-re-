import { describe, expect, it } from "vitest";
import { bicValide, ibanValide, normaliserBic, normaliserIban } from "./iban";

describe("normaliserIban / normaliserBic", () => {
  it("retire les espaces et met en majuscules", () => {
    expect(normaliserIban("fr76 3000 6000 0112 3456 7890 189")).toBe("FR7630006000011234567890189");
    expect(normaliserBic("bnpafrpp xxx")).toBe("BNPAFRPPXXX");
  });

  it("retire aussi les tirets", () => {
    expect(normaliserIban("FR76-3000-6000-0112-3456-7890-189")).toBe("FR7630006000011234567890189");
  });
});

describe("ibanValide", () => {
  it("accepte des IBAN réels de plusieurs pays", () => {
    expect(ibanValide("FR76 3000 6000 0112 3456 7890 189")).toBe(true);
    expect(ibanValide("DE89370400440532013000")).toBe(true);
    expect(ibanValide("GB29 NWBK 6016 1331 9268 19")).toBe(true);
  });

  it("refuse une clé de contrôle fausse (chiffre inversé)", () => {
    // Régression du cas le plus probable en pratique : une agence recopie son
    // IBAN à la main et inverse deux chiffres au milieu.
    expect(ibanValide("FR76 3000 6000 0112 3456 7809 189")).toBe(false);
  });

  it("refuse une structure incorrecte", () => {
    expect(ibanValide("PAS-UN-IBAN")).toBe(false);
    expect(ibanValide("FR76")).toBe(false);
    expect(ibanValide("")).toBe(false);
    expect(ibanValide("1234567890123456789")).toBe(false);
  });
});

describe("bicValide", () => {
  it("accepte les formats à 8 et 11 caractères", () => {
    expect(bicValide("BNPAFRPP")).toBe(true);
    expect(bicValide("BNPAFRPPXXX")).toBe(true);
    expect(bicValide("bnpa frpp xxx")).toBe(true);
  });

  it("refuse une longueur ou des caractères invalides", () => {
    expect(bicValide("BNPAFRP")).toBe(false);
    expect(bicValide("BNPAFRPPX")).toBe(false);
    expect(bicValide("12PAFRPP")).toBe(false);
  });
});
