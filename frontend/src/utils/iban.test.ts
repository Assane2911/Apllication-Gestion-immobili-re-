import { describe, expect, it } from "vitest";
import { bicValide, compacter, grouperIban, ibanValide } from "./iban";

describe("iban", () => {
  it("groupe un IBAN par quatre caractères, sans tenir compte des espaces saisis", () => {
    expect(grouperIban("fr7630001007941234567890185")).toBe("FR76 3000 1007 9412 3456 7890 185");
    expect(grouperIban("FR76 3000 1007 9412 3456 7890 185")).toBe("FR76 3000 1007 9412 3456 7890 185");
    expect(compacter(" fr76 3000 ")).toBe("FR763000");
  });

  it("accepte des IBAN dont la clé est juste, avec ou sans espaces", () => {
    expect(ibanValide("FR7630001007941234567890185")).toBe(true);
    expect(ibanValide("FR76 3000 1007 9412 3456 7890 185")).toBe(true);
    expect(ibanValide("GB82 WEST 1234 5698 7654 32")).toBe(true);
    expect(ibanValide("DE89370400440532013000")).toBe(true);
  });

  it("refuse une clé fausse, une faute de frappe ou une saisie qui n'a pas la forme d'un IBAN", () => {
    expect(ibanValide("FR7630001007941234567890186")).toBe(false);
    expect(ibanValide("FR7630001007941234567890158")).toBe(false);
    expect(ibanValide("FR00INVALIDE")).toBe(false);
    expect(ibanValide("")).toBe(false);
  });

  it("reconnaît un BIC de 8 ou 11 caractères", () => {
    expect(bicValide("BDFEFRPP")).toBe(true);
    expect(bicValide("bdfefrppxxx")).toBe(true);
    expect(bicValide("BDFEFRP")).toBe(false);
    expect(bicValide("1234FRPP")).toBe(false);
  });
});
