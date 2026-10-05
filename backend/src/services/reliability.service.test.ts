import { describe, expect, it } from "vitest";
import { calculerFiabilite } from "./reliability.service";

describe("calculerFiabilite", () => {
  it("renvoie un score nul et le niveau 'insuffisant' sous le seuil minimum de factures", () => {
    expect(calculerFiabilite({ payeATemps: 0, payeEnRetard: 0, enRetardActuel: 0 })).toEqual({
      payeATemps: 0,
      payeEnRetard: 0,
      enRetardActuel: 0,
      score: null,
      niveau: "insuffisant",
    });
    expect(calculerFiabilite({ payeATemps: 2, payeEnRetard: 0, enRetardActuel: 0 }).niveau).toBe("insuffisant");
    expect(calculerFiabilite({ payeATemps: 2, payeEnRetard: 0, enRetardActuel: 0 }).score).toBeNull();
  });

  it("attribue 100 et 'excellent' quand tout a été payé à temps", () => {
    const f = calculerFiabilite({ payeATemps: 6, payeEnRetard: 0, enRetardActuel: 0 });
    expect(f.score).toBe(100);
    expect(f.niveau).toBe("excellent");
  });

  it("attribue 0 et 'risque' quand tout est actuellement impayé", () => {
    const f = calculerFiabilite({ payeATemps: 0, payeEnRetard: 0, enRetardActuel: 5 });
    expect(f.score).toBe(0);
    expect(f.niveau).toBe("risque");
  });

  it("compte un paiement en retard pour un demi-point", () => {
    // 5 factures payées en retard : 2,5 / 5 = 50 %
    const f = calculerFiabilite({ payeATemps: 0, payeEnRetard: 5, enRetardActuel: 0 });
    expect(f.score).toBe(50);
    expect(f.niveau).toBe("moyen");
  });

  it("place correctement les bornes des niveaux (90 / 75 / 50)", () => {
    // 9 à temps + 1 en retard = 9,5/10 = 95 % -> excellent
    expect(calculerFiabilite({ payeATemps: 9, payeEnRetard: 1, enRetardActuel: 0 }).niveau).toBe("excellent");
    // 8 à temps + 2 impayés = 8/10 = 80 % -> bon
    expect(calculerFiabilite({ payeATemps: 8, payeEnRetard: 0, enRetardActuel: 2 }).niveau).toBe("bon");
    // 6 à temps + 4 impayés = 6/10 = 60 % -> moyen
    expect(calculerFiabilite({ payeATemps: 6, payeEnRetard: 0, enRetardActuel: 4 }).niveau).toBe("moyen");
    // 4 à temps + 6 impayés = 4/10 = 40 % -> risque
    expect(calculerFiabilite({ payeATemps: 4, payeEnRetard: 0, enRetardActuel: 6 }).niveau).toBe("risque");
  });

  it("ignore les factures PENDING et CANCELLED (elles ne sont pas comptées dans les stats transmises)", () => {
    // Le service d'agrégation ne transmet que PAID/LATE — ce test documente
    // simplement que la fonction pure ne voit et ne juge que ce total-là.
    const f = calculerFiabilite({ payeATemps: 3, payeEnRetard: 0, enRetardActuel: 0 });
    expect(f.score).toBe(100);
  });
});
