import { describe, expect, it } from "vitest";
import { dateDeSortieProposee } from "./conge";

describe("dateDeSortieProposee", () => {
  it("ajoute des jours civils", () => {
    expect(dateDeSortieProposee("2026-01-15", 30, "DAYS")).toBe("2026-02-14");
  });

  it("ajoute des mois de calendrier, au même quantième, en passant l'année", () => {
    expect(dateDeSortieProposee("2026-01-15", 3, "MONTHS")).toBe("2026-04-15");
    expect(dateDeSortieProposee("2026-11-20", 3, "MONTHS")).toBe("2027-02-20");
  });

  it("un quantième absent du mois d'arrivée retombe sur le dernier jour de ce mois", () => {
    expect(dateDeSortieProposee("2026-01-31", 1, "MONTHS")).toBe("2026-02-28");
    expect(dateDeSortieProposee("2028-01-31", 1, "MONTHS")).toBe("2028-02-29");
  });

  it("ne propose rien sans date valide ni durée entière positive", () => {
    expect(dateDeSortieProposee("", 3, "MONTHS")).toBe("");
    expect(dateDeSortieProposee("2026-01-15", 0, "MONTHS")).toBe("");
    expect(dateDeSortieProposee("2026-01-15", 1.5, "DAYS")).toBe("");
    expect(dateDeSortieProposee("15/01/2026", 3, "DAYS")).toBe("");
  });
});
