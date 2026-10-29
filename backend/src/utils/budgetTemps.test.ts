import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { budgetTemps, SANS_LIMITE, traiterParLots } from "./budgetTemps";

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

/**
 * Un envoi d'e-mail attend le serveur d'envoi : traités un par un, quelques centaines d'envois remplissaient les quatre minutes
 * du budget. `traiterParLots` en mène plusieurs de front, sans jamais dépasser le plafond, et garde l'arrêt au budget.
 */
describe("traiterParLots", () => {
  const attendre = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("traite chaque élément une fois, sans jamais dépasser le nombre d'éléments simultanés demandé", async () => {
    let enCours = 0;
    let maximum = 0;
    const vus: number[] = [];
    const elements = Array.from({ length: 20 }, (_, i) => i);

    const { interrompu } = await traiterParLots(elements, 4, SANS_LIMITE, async (element) => {
      enCours++;
      maximum = Math.max(maximum, enCours);
      await attendre(5);
      vus.push(element);
      enCours--;
    });

    expect(interrompu).toBe(false);
    expect(maximum).toBe(4);
    expect(vus.sort((a, b) => a - b)).toEqual(elements);
  });

  it("va plus vite qu'un par un : cinq envois de 40 ms tiennent dans un peu plus de 40 ms, pas 200", async () => {
    const debut = Date.now();
    await traiterParLots([1, 2, 3, 4, 5], 5, SANS_LIMITE, async () => {
      await attendre(40);
    });
    expect(Date.now() - debut).toBeLessThan(120);
  });

  it("une concurrence de 1 retrouve l'ordre séquentiel d'avant", async () => {
    const ordre: number[] = [];
    await traiterParLots([1, 2, 3, 4], 1, SANS_LIMITE, async (e) => {
      await attendre(5 - e);
      ordre.push(e);
    });
    expect(ordre).toEqual([1, 2, 3, 4]);
  });

  it("donne à chaque élément son rang d'origine, même s'il finit dans le désordre", async () => {
    const rangs = new Map<string, number>();
    await traiterParLots(["a", "b", "c"], 3, SANS_LIMITE, async (e, rang) => {
      await attendre(e === "a" ? 20 : 1);
      rangs.set(e, rang);
    });
    expect([...rangs.entries()].sort()).toEqual([["a", 0], ["b", 1], ["c", 2]]);
  });

  it("s'arrête avant de prendre un élément de plus quand le budget est épuisé, et le signale", async () => {
    const traites: number[] = [];
    const { interrompu } = await traiterParLots([1, 2, 3, 4, 5, 6], 2, budgetTemps(0), async (e) => {
      traites.push(e);
    });
    expect(traites).toEqual([]);
    expect(interrompu).toBe(true);
  });

  it("épuisé en cours de route : les éléments en cours vont à leur terme, les suivants ne sont pas pris", async () => {
    let epuise = false;
    const budget = { epuise: () => epuise, restant: () => 0 };
    const traites: number[] = [];

    const { interrompu } = await traiterParLots([1, 2, 3, 4, 5, 6], 2, budget, async (e) => {
      if (e === 2) epuise = true;
      await attendre(5);
      traites.push(e);
    });

    expect(interrompu).toBe(true);
    expect(traites.sort()).toEqual([1, 2]);
  });

  it("une liste vide, ou entièrement traitée à temps, n'est pas une interruption", async () => {
    expect(await traiterParLots([], 3, budgetTemps(0), async () => {})).toEqual({ interrompu: false });
    expect(await traiterParLots([1], 3, SANS_LIMITE, async () => {})).toEqual({ interrompu: false });
  });

  it("une erreur arrête la prise de nouveaux éléments et est relayée, comme l'arrêt de la boucle d'avant", async () => {
    const traites: number[] = [];
    await expect(
      traiterParLots([1, 2, 3, 4, 5, 6, 7, 8], 2, SANS_LIMITE, async (e) => {
        traites.push(e);
        await attendre(2);
        if (e === 2) throw new Error("panne");
      })
    ).rejects.toThrow("panne");
    expect(traites.length).toBeLessThan(8);
  });

  it("une concurrence absurde (0, négative, décimale) est ramenée à au moins un", async () => {
    for (const c of [0, -3, 0.4]) {
      const vus: number[] = [];
      await traiterParLots([1, 2, 3], c, SANS_LIMITE, async (e) => {
        vus.push(e);
      });
      expect(vus).toEqual([1, 2, 3]);
    }
  });
});
