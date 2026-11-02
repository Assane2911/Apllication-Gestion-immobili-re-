import { describe, expect, it } from "vitest";
import type { InsurancePolicy } from "../types";
import { etatPolice, partDesDepenses, repartitionParCategorie, syntheseAssurances, variationAnnuelle } from "./syntheseFinances";

describe("partDesDepenses", () => {
  it("rapporte les dépenses aux revenus dans une devise unique", () => {
    expect(partDesDepenses({ EUR: 2000 }, { EUR: 500 })).toBe(25);
  });
  it("ne calcule rien avec plusieurs devises ou sans revenus", () => {
    expect(partDesDepenses({ EUR: 2000, XOF: 100 }, { EUR: 500 })).toBeNull();
    expect(partDesDepenses({}, { EUR: 500 })).toBeNull();
    expect(partDesDepenses({}, {})).toBeNull();
  });
});

describe("repartitionParCategorie", () => {
  it("donne la part de chaque catégorie, de la plus lourde à la plus légère", () => {
    const r = repartitionParCategorie({ TAX: { EUR: 100 }, MAINTENANCE: { EUR: 300 }, OTHER: { EUR: 100 } });
    expect(r.map((l) => [l.categorie, l.part])).toEqual([
      ["MAINTENANCE", 60],
      ["TAX", 20],
      ["OTHER", 20],
    ]);
  });
  it("ne donne aucune part quand les devises diffèrent", () => {
    const r = repartitionParCategorie({ TAX: { EUR: 100 }, MAINTENANCE: { XOF: 300000 } });
    expect(r.every((l) => l.part === null)).toBe(true);
    expect(r.map((l) => l.categorie)).toEqual(["MAINTENANCE", "TAX"]);
  });
  it("renvoie une liste vide sans dépense", () => {
    expect(repartitionParCategorie({})).toEqual([]);
  });
});

describe("assurances", () => {
  const maintenant = new Date(2026, 10, 1);
  const police = (surcharge: Partial<InsurancePolicy>): InsurancePolicy => ({ id: "p", propertyId: "b", insurerName: "AXA", policyNumber: "1", currency: "EUR", expiryDate: "2027-06-01T00:00:00.000Z", createdAt: "", ...surcharge });

  it("classe une police échue, bientôt échue ou valide", () => {
    expect(etatPolice("2026-10-20T00:00:00.000Z", maintenant)).toBe("expired");
    expect(etatPolice("2026-11-15T00:00:00.000Z", maintenant)).toBe("soon");
    expect(etatPolice("2026-12-01T00:00:00.000Z", maintenant)).toBe("soon");
    expect(etatPolice("2026-12-02T00:00:00.000Z", maintenant)).toBe("valid");
  });

  it("cumule les primes des polices non échues, par devise", () => {
    const s = syntheseAssurances(
      [
        police({ id: "1", premiumAmount: 300 }),
        police({ id: "2", premiumAmount: 200, expiryDate: "2026-11-10T00:00:00.000Z" }),
        police({ id: "3", premiumAmount: 999, expiryDate: "2026-01-10T00:00:00.000Z" }),
        police({ id: "4", premiumAmount: 150000, currency: "XOF" }),
        police({ id: "5", premiumAmount: null }),
      ],
      maintenant
    );
    expect(s).toEqual({
      total: 5,
      echues: 1,
      bientot: 1,
      primes: [
        { currency: "EUR", total: 500 },
        { currency: "XOF", total: 150000 },
      ],
    });
  });
});

describe("variationAnnuelle", () => {
  it("compare à l'année précédente", () => {
    expect(variationAnnuelle(1200, 1000)).toBe(20);
    expect(variationAnnuelle(800, 1000)).toBe(-20);
  });
  it("renvoie null sans base", () => {
    expect(variationAnnuelle(1200, undefined)).toBeNull();
    expect(variationAnnuelle(1200, 0)).toBeNull();
  });
});
