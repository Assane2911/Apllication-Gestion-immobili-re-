import { describe, expect, it } from "vitest";
import { nomDevise } from "./nomDevise";

describe("nomDevise", () => {
  it("donne le nom de la devise dans la langue demandée, avec une majuscule", () => {
    expect(nomDevise("USD", "en", "Dollar US")).toBe("US Dollar");
    expect(nomDevise("USD", "es", "Dollar US")).toBe("Dólar estadounidense");
    expect(nomDevise("GBP", "fr", "Livre Sterling")).toMatch(/^Livre sterling$/i);
    expect(nomDevise("EUR", "pt", "Euro")).toBe("Euro");
  });

  it("couvre les devises de la liste de l'application (aucun nom ne retombe sur le code)", () => {
    for (const code of ["EUR", "XOF"]) {
      for (const langue of ["fr", "en", "pt", "es"]) {
        expect(nomDevise(code, langue, "REPLI"), `${code} en ${langue}`).not.toBe("REPLI");
      }
    }
  });

  it("garde le nom de repli pour une devise que le navigateur ne connaît pas ou une langue invalide", () => {
    expect(nomDevise("XYZ", "en", "Devise maison")).toBe("Devise maison");
    expect(nomDevise("USD", "pas une langue", "Dollar US")).toBe("Dollar US");
  });
});
