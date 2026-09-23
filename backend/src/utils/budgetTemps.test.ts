import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { budgetTemps, SANS_LIMITE } from "./budgetTemps";

describe("budgetTemps", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("n'est pas épuisé tant que la durée n'est pas écoulée", () => {
    const budget = budgetTemps(10_000);
    expect(budget.epuise()).toBe(false);
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 9));
    expect(budget.epuise()).toBe(false);
    expect(budget.restant()).toBe(1_000);
  });

  it("est épuisé une fois la durée atteinte", () => {
    const budget = budgetTemps(10_000);
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 10));
    expect(budget.epuise()).toBe(true);
    expect(budget.restant()).toBe(0);
  });

  it("qu'on le dépasse largement, le temps restant ne devient jamais négatif", () => {
    const budget = budgetTemps(10_000);
    vi.setSystemTime(new Date(2026, 0, 1, 13, 0, 0));
    expect(budget.restant()).toBe(0);
  });

  it("un budget de durée nulle est épuisé d'emblée", () => {
    // C'est la valeur qu'emploient les tests des tâches planifiées pour
    // provoquer une interruption sans attendre.
    expect(budgetTemps(0).epuise()).toBe(true);
  });

  it("SANS_LIMITE ne s'épuise jamais", () => {
    vi.setSystemTime(new Date(2030, 0, 1));
    expect(SANS_LIMITE.epuise()).toBe(false);
  });
});
