import { describe, expect, it } from "vitest";
import { echeanceDuMois, jourEcheanceDuContrat, libelleEcheance } from "./jourEcheance";

const bail = (jour: number, paymentDay?: number | null) => ({ startDate: new Date(2026, 0, jour), paymentDay });

describe("jour d'échéance du contrat", () => {
  it("sans réglage : le jour du mois de la date de début du bail (contrats d'avant le champ)", () => {
    expect(jourEcheanceDuContrat(bail(24))).toBe(24);
    expect(jourEcheanceDuContrat(bail(1))).toBe(1);
    expect(jourEcheanceDuContrat(bail(24, null))).toBe(24);
  });

  it("avec un jour fixé par le gestionnaire : ce jour-là, quel que soit le début du bail", () => {
    expect(jourEcheanceDuContrat(bail(24, 5))).toBe(5);
    expect(jourEcheanceDuContrat(bail(5, 28))).toBe(28);
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
    expect(libelleEcheance(bail(24))).toBe("payable mensuellement au plus tard le 24 de chaque mois");
    expect(libelleEcheance(bail(24, 5))).toBe("payable mensuellement au plus tard le 5 de chaque mois");
  });

  it("écrit « 1er » pour le premier du mois", () => {
    expect(libelleEcheance(bail(10, 1))).toBe("payable mensuellement au plus tard le 1er de chaque mois");
  });

  it("jour issu de la date de début à partir du 29 : précise le repli des mois courts", () => {
    expect(libelleEcheance(bail(29))).toContain("ou le dernier jour du mois lorsque celui-ci est plus court");
    expect(libelleEcheance(bail(28))).not.toContain("dernier jour");
  });

  it("« dernier jour du mois » choisi explicitement : formulé sans ambiguïté", () => {
    expect(libelleEcheance(bail(10, 31))).toBe("payable mensuellement au plus tard le dernier jour de chaque mois");
  });
});
