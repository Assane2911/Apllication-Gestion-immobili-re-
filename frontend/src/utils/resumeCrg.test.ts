import { describe, expect, it } from "vitest";
import type { CrgSynthesis } from "../types";
import { etatReversement, resumeCrg } from "./resumeCrg";

function crg(surcharge: Partial<CrgSynthesis> = {}): CrgSynthesis {
  return {
    ownerId: "o1",
    ownerName: "Fatou Diop",
    managementFeeRate: 10,
    month: 9,
    year: 2026,
    properties: [],
    totalLoyersByCurrency: { EUR: 1000 },
    totalChargesByCurrency: { EUR: 100 },
    totalCommissionByCurrency: { EUR: 100 },
    totalNetByCurrency: { EUR: 800 },
    ...surcharge,
  };
}
const libelles = { titre: "CRG", loyers: "Loyers", charges: "Charges", commission: "Commission", net: "Net" };
const argent = (m: number, d: string) => `${m} ${d}`;

describe("resumeCrg", () => {
  it("écrit une ligne par poste, sans étiquette de devise quand il n'y en a qu'une", () => {
    expect(resumeCrg(crg(), "septembre 2026", libelles, argent)).toBe(
      ["CRG — Fatou Diop — septembre 2026", "Loyers : 1000 EUR", "Charges : 100 EUR", "Commission : 100 EUR", "Net : 800 EUR"].join("\n")
    );
  });

  it("sépare les devises au lieu de les additionner", () => {
    const texte = resumeCrg(
      crg({
        totalLoyersByCurrency: { EUR: 1000, XOF: 500000 },
        totalChargesByCurrency: { EUR: 100, XOF: 0 },
        totalCommissionByCurrency: { EUR: 100, XOF: 50000 },
        totalNetByCurrency: { EUR: 800, XOF: 450000 },
      }),
      "septembre 2026",
      libelles,
      argent
    );
    expect(texte).toContain("[EUR]");
    expect(texte).toContain("[XOF]");
    expect(texte).toContain("Net : 450000 XOF");
  });
});

describe("etatReversement", () => {
  it("ne conclut rien sans information de reste", () => {
    expect(etatReversement(crg())).toBeNull();
  });

  it("distingue rien versé, versé en partie, versé en totalité et trop versé", () => {
    expect(etatReversement(crg({ resteAReverserByCurrency: { EUR: 800 }, totalReverseByCurrency: { EUR: 0 } }))).toBe("none");
    expect(etatReversement(crg({ resteAReverserByCurrency: { EUR: 300 }, totalReverseByCurrency: { EUR: 500 } }))).toBe("partial");
    expect(etatReversement(crg({ resteAReverserByCurrency: { EUR: 0 }, totalReverseByCurrency: { EUR: 800 } }))).toBe("done");
    expect(etatReversement(crg({ resteAReverserByCurrency: { EUR: -50 }, totalReverseByCurrency: { EUR: 850 } }))).toBe("over");
  });

  it("ne dit rien d'un mois sans net ni versement", () => {
    expect(etatReversement(crg({ totalNetByCurrency: { EUR: 0 }, resteAReverserByCurrency: { EUR: 0 }, totalReverseByCurrency: {} }))).toBeNull();
  });
});
