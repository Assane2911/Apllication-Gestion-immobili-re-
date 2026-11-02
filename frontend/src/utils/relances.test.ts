import { describe, expect, it } from "vitest";
import { calendrierRelances, RETARD_MAX_RELANCE_JOURS } from "./relances";

describe("calendrierRelances", () => {
  it("place les trois relances au délai, puis à chaque intervalle", () => {
    expect(calendrierRelances("5", "10")).toEqual({ first: 5, second: 15, third: 25 });
    expect(calendrierRelances(1, 3)).toEqual({ first: 1, second: 4, third: 7 });
  });
  it("ne descend jamais sous un jour, même pour une saisie vide ou absurde", () => {
    expect(calendrierRelances("", "abc")).toEqual({ first: 1, second: 2, third: 3 });
    expect(calendrierRelances("0", "-4")).toEqual({ first: 1, second: 2, third: 3 });
  });
  it("reste dans la limite des 90 jours pour les plus grands réglages permis", () => {
    expect(calendrierRelances(30, 30).third).toBeLessThanOrEqual(RETARD_MAX_RELANCE_JOURS);
  });
});
