import { describe, expect, it } from "vitest";
import { versE164 } from "./phone";

describe("versE164", () => {
  it("accepte un numéro déjà au format international avec +", () => {
    expect(versE164("+221771234567")).toBe("+221771234567");
  });

  it("nettoie espaces, tirets et parenthèses avant de valider", () => {
    expect(versE164("+221 77 123 45 67")).toBe("+221771234567");
    expect(versE164("+221-77-123-45-67")).toBe("+221771234567");
    expect(versE164("+(221) 771234567")).toBe("+221771234567");
  });

  it("convertit un préfixe international 00 en +", () => {
    expect(versE164("00221771234567")).toBe("+221771234567");
  });

  // Régression : un numéro local sans indicatif pays (comme la valeur par
  // défaut des comptes de test, "0600000000") ne doit JAMAIS être deviné —
  // lui inventer un indicatif enverrait potentiellement le message à
  // quelqu'un d'autre, dans un autre pays.
  it("refuse un numéro local sans indicatif pays plutôt que de deviner", () => {
    expect(versE164("0600000000")).toBeNull();
    expect(versE164("771234567")).toBeNull();
  });

  it("refuse une chaîne vide ou manifestement invalide", () => {
    expect(versE164("")).toBeNull();
    expect(versE164("+")).toBeNull();
    expect(versE164("abc")).toBeNull();
  });
});
