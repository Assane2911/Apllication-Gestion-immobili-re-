import { describe, expect, it } from "vitest";
import { echeanceDuMois, jourEcheanceDuContrat, libelleEcheance } from "./jourEcheance";

describe("jour d'échéance du contrat", () => {
  it("est le jour du mois de la date de début du bail", () => {
    expect(jourEcheanceDuContrat(new Date(2026, 0, 24))).toBe(24);
    expect(jourEcheanceDuContrat(new Date(2026, 4, 1))).toBe(1);
  });

  it("plafonne l'échéance au dernier jour réel du mois", () => {
    expect(echeanceDuMois(31, 2026, 2)).toEqual(new Date(2026, 1, 28));
    expect(echeanceDuMois(31, 2028, 2)).toEqual(new Date(2028, 1, 29));
    expect(echeanceDuMois(31, 2026, 4)).toEqual(new Date(2026, 3, 30));
    expect(echeanceDuMois(24, 2026, 2)).toEqual(new Date(2026, 1, 24));
  });
});

describe("libellé de l'échéance dans le bail", () => {
  it("nomme le vrai jour, jamais un « 5 » en dur", () => {
    expect(libelleEcheance(new Date(2026, 0, 24))).toBe("payable mensuellement au plus tard le 24 de chaque mois");
    expect(libelleEcheance(new Date(2026, 0, 5))).toBe("payable mensuellement au plus tard le 5 de chaque mois");
  });

  it("écrit « 1er » pour le premier du mois", () => {
    expect(libelleEcheance(new Date(2026, 0, 1))).toBe("payable mensuellement au plus tard le 1er de chaque mois");
  });

  it("précise le repli des mois courts à partir du 29", () => {
    expect(libelleEcheance(new Date(2026, 0, 29))).toContain("ou le dernier jour du mois lorsque celui-ci est plus court");
    expect(libelleEcheance(new Date(2026, 0, 28))).not.toContain("dernier jour");
  });
});
