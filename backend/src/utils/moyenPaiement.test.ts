import { describe, expect, it } from "vitest";
import { libelleMoyenPaiement } from "./moyenPaiement";

describe("libelleMoyenPaiement", () => {
  it.each([
    ["BANK_TRANSFER", "Virement bancaire"],
    ["STRIPE", "Carte bancaire (en ligne)"],
    ["PAYDUNYA", "Mobile Money / carte (en ligne)"],
    ["DEMO", "Paiement de démonstration"],
  ])("traduit %s en « %s » : jamais le code technique", (code, attendu) => {
    expect(libelleMoyenPaiement(code)).toBe(attendu);
    expect(libelleMoyenPaiement(code)).not.toMatch(/^[A-Z_]+$/);
  });

  it("n'invente aucun moyen quand rien n'a été enregistré", () => {
    expect(libelleMoyenPaiement(null)).toBe("Non précisé");
    expect(libelleMoyenPaiement(undefined)).toBe("Non précisé");
    expect(libelleMoyenPaiement("")).toBe("Non précisé");
  });

  it("garde une valeur inconnue visible plutôt que de la perdre", () => {
    expect(libelleMoyenPaiement("CHEQUE")).toBe("CHEQUE");
  });
});
