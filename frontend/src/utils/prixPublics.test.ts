import { describe, expect, it } from "vitest";
import { economieAnnuelle, formaterPrix, formuleConseillee, lireTarifs } from "./prixPublics";

const reponse = [
  { id: "STARTER", monthlyPrice: 9, annualPrice: 86 },
  { id: "PRO", monthlyPrice: 29, annualPrice: 278 },
  { id: "ENTERPRISE", monthlyPrice: 49, annualPrice: 470 },
];

describe("lireTarifs", () => {
  it("lit les trois formules de la réponse du serveur", () => {
    expect(lireTarifs(reponse)).toEqual({
      STARTER: { monthly: 9, annual: 86 },
      PRO: { monthly: 29, annual: 278 },
      ENTERPRISE: { monthly: 49, annual: 470 },
    });
  });

  it("refuse toute réponse incomplète, mal formée ou à prix nul plutôt que d'inventer un chiffre", () => {
    expect(lireTarifs(undefined)).toBeNull();
    expect(lireTarifs({ items: [] })).toBeNull();
    expect(lireTarifs(reponse.slice(0, 2))).toBeNull();
    expect(lireTarifs([...reponse.slice(0, 2), { id: "ENTERPRISE", monthlyPrice: "49", annualPrice: 470 }])).toBeNull();
    expect(lireTarifs([...reponse.slice(0, 2), { id: "ENTERPRISE", monthlyPrice: 0, annualPrice: 0 }])).toBeNull();
  });
});

describe("economieAnnuelle", () => {
  it("donne la part économisée à l'année", () => {
    expect(economieAnnuelle({ monthly: 9, annual: 86 })).toBe(20);
    expect(economieAnnuelle({ monthly: 15000, annual: 144000 })).toBe(20);
  });

  it("ne promet aucune économie quand l'annuel ne coûte pas moins", () => {
    expect(economieAnnuelle({ monthly: 10, annual: 120 })).toBe(0);
    expect(economieAnnuelle({ monthly: 10, annual: 150 })).toBe(0);
  });
});

describe("formaterPrix", () => {
  it("écrit le symbole de chaque devise, sans décimales sur un prix entier", () => {
    expect(formaterPrix(29, "EUR", "fr")).toMatch(/^29\s€$/);
    expect(formaterPrix(15000, "XOF", "fr")).toMatch(/^15\s?000 FCFA$/);
    expect(formaterPrix(2.5, "EUR", "fr")).toMatch(/^2,5\s€$/);
  });
});

describe("formuleConseillee", () => {
  it("conseille la plus petite formule qui couvre le parc, aux plafonds exacts", () => {
    expect(formuleConseillee(1)).toBe("STARTER");
    expect(formuleConseillee(5)).toBe("STARTER");
    expect(formuleConseillee(6)).toBe("PRO");
    expect(formuleConseillee(25)).toBe("PRO");
    expect(formuleConseillee(26)).toBe("ENTERPRISE");
    expect(formuleConseillee(400)).toBe("ENTERPRISE");
  });
});
