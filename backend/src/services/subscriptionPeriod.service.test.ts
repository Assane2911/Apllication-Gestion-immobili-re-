import { describe, expect, it } from "vitest";
import { ajouterJours, calculerJoursCredit, calculerPeriode } from "./subscriptionPeriod.service";

/** Écriture lisible d'une date locale, pour que l'intention des cas reste évidente. */
function d(annee: number, mois: number, jour: number): Date {
  return new Date(annee, mois - 1, jour);
}

describe("calculerPeriode", () => {
  describe("premier abonnement (aucun droit en cours)", () => {
    it("part de maintenant et couvre un mois", () => {
      const { startDate, endDate } = calculerPeriode({
        maintenant: d(2026, 9, 10),
        cycle: "MONTHLY",
        finActuelle: null,
      });

      expect(startDate).toEqual(d(2026, 9, 10));
      expect(endDate).toEqual(d(2026, 10, 10));
    });

    it("couvre un an pour un cycle annuel", () => {
      const { endDate } = calculerPeriode({
        maintenant: d(2026, 9, 10),
        cycle: "ANNUAL",
        finActuelle: null,
      });

      expect(endDate).toEqual(d(2027, 9, 10));
    });
  });

  describe("renouvellement anticipé", () => {
    it("ne fait PAS perdre les jours déjà payés", () => {
      // Régression. L'abonnement court jusqu'au 30 septembre et le
      // gestionnaire renouvelle le 10. L'ancien calcul repartait de la
      // demande et le renvoyait au 10 octobre : 20 jours déjà réglés
      // s'évaporaient. Renouveler en avance — ce que l'interface encourage,
      // et le seul moyen d'éviter une coupure d'accès — était puni.
      const { startDate, endDate } = calculerPeriode({
        maintenant: d(2026, 9, 10),
        cycle: "MONTHLY",
        finActuelle: d(2026, 9, 30),
      });

      expect(startDate).toEqual(d(2026, 9, 30));
      expect(endDate).toEqual(d(2026, 10, 30));
    });

    it("empile correctement un cycle annuel sur le reliquat", () => {
      const { endDate } = calculerPeriode({
        maintenant: d(2026, 9, 10),
        cycle: "ANNUAL",
        finActuelle: d(2026, 9, 30),
      });

      expect(endDate).toEqual(d(2027, 9, 30));
    });

    it("n'offre rien quand les droits sont déjà expirés", () => {
      // L'inverse du cas précédent : une date de fin dépassée ne doit pas
      // servir de point de départ, sans quoi le client paierait un mois pour
      // une période en partie révolue.
      const { startDate, endDate } = calculerPeriode({
        maintenant: d(2026, 9, 10),
        cycle: "MONTHLY",
        finActuelle: d(2026, 6, 1),
      });

      expect(startDate).toEqual(d(2026, 9, 10));
      expect(endDate).toEqual(d(2026, 10, 10));
    });

    it("traite une fin d'abonnement absente comme aucun droit acquis", () => {
      const { startDate } = calculerPeriode({
        maintenant: d(2026, 9, 10),
        cycle: "MONTHLY",
      });

      expect(startDate).toEqual(d(2026, 9, 10));
    });
  });

  describe("fins de mois", () => {
    it("plafonne au dernier jour du mois visé au lieu de déborder", () => {
      // `new Date(2026, 0, 31).setMonth(1)` ne donne pas le 28 février mais le
      // 3 mars : février n'ayant pas de 31, JavaScript reporte sur le mois
      // suivant. L'abonnement durait 31 jours au lieu de 28.
      const { endDate } = calculerPeriode({
        maintenant: d(2026, 1, 31),
        cycle: "MONTHLY",
        finActuelle: null,
      });

      expect(endDate).toEqual(d(2026, 2, 28));
    });

    it("tient compte des années bissextiles", () => {
      const { endDate } = calculerPeriode({
        maintenant: d(2028, 1, 31),
        cycle: "MONTHLY",
        finActuelle: null,
      });

      expect(endDate).toEqual(d(2028, 2, 29));
    });

    it("ramène un 29 février au 28 l'année suivante", () => {
      const { endDate } = calculerPeriode({
        maintenant: d(2028, 2, 29),
        cycle: "ANNUAL",
        finActuelle: null,
      });

      expect(endDate).toEqual(d(2029, 2, 28));
    });

    it("garde le 31 quand le mois visé en a un", () => {
      const { endDate } = calculerPeriode({
        maintenant: d(2026, 7, 31),
        cycle: "MONTHLY",
        finActuelle: null,
      });

      expect(endDate).toEqual(d(2026, 8, 31));
    });

    it("conserve l'heure du point de départ", () => {
      const depart = new Date(2026, 8, 10, 14, 30, 15);
      const { endDate } = calculerPeriode({
        maintenant: depart,
        cycle: "MONTHLY",
        finActuelle: null,
      });

      expect(endDate).toEqual(new Date(2026, 9, 10, 14, 30, 15));
    });
  });

  it("ne modifie pas les dates qu'on lui passe", () => {
    const maintenant = d(2026, 9, 10);
    const finActuelle = d(2026, 9, 30);

    calculerPeriode({ maintenant, cycle: "ANNUAL", finActuelle });

    expect(maintenant).toEqual(d(2026, 9, 10));
    expect(finActuelle).toEqual(d(2026, 9, 30));
  });
});

describe("calculerJoursCredit", () => {
  /**
   * Régression (proratisation lors d'un changement de plan) : un
   * gestionnaire a payé un mois de STARTER (9 €, cycle de 30 jours) et lui
   * reste 10 jours avant échéance. Il passe à PRO (29 €/mois, cycle de 30
   * jours). Valeur non consommée de STARTER : 9 × 10/30 = 3 €. Au tarif
   * journalier de PRO (29/30 ≈ 0,9667 €/jour), 3 € valent environ 3,1 jours
   * de PRO — nettement moins que les 10 jours qu'un report tel quel aurait
   * offerts au tarif PRO.
   */
  it("convertit la valeur restante de l'ancien plan en jours du nouveau plan (upgrade)", () => {
    const jours = calculerJoursCredit({
      ancienMontant: 9,
      ancienCycleJours: 30,
      joursRestants: 10,
      nouveauMontant: 29,
      nouveauCycleJours: 30,
    });

    expect(jours).toBeCloseTo((9 * (10 / 30)) / (29 / 30), 5);
    expect(jours).toBeLessThan(10);
  });

  /**
   * Symétrique : un downgrade doit au contraire donner PLUS de jours sur le
   * nouveau plan, moins cher, pour la même valeur restante.
   */
  it("convertit la valeur restante de l'ancien plan en jours du nouveau plan (downgrade)", () => {
    const jours = calculerJoursCredit({
      ancienMontant: 29,
      ancienCycleJours: 30,
      joursRestants: 10,
      nouveauMontant: 9,
      nouveauCycleJours: 30,
    });

    expect(jours).toBeCloseTo((29 * (10 / 30)) / (9 / 30), 5);
    expect(jours).toBeGreaterThan(10);
  });

  it("ne donne aucun jour de crédit s'il ne reste aucun jour payé", () => {
    const jours = calculerJoursCredit({
      ancienMontant: 9,
      ancienCycleJours: 30,
      joursRestants: 0,
      nouveauMontant: 29,
      nouveauCycleJours: 30,
    });

    expect(jours).toBe(0);
  });
});

describe("ajouterJours", () => {
  it("ajoute un nombre de jours entier à une date", () => {
    expect(ajouterJours(d(2026, 9, 10), 5)).toEqual(d(2026, 9, 15));
  });

  it("arrondit un nombre de jours fractionnaire", () => {
    expect(ajouterJours(d(2026, 9, 10), 3.1)).toEqual(d(2026, 9, 13));
    expect(ajouterJours(d(2026, 9, 10), 3.6)).toEqual(d(2026, 9, 14));
  });
});
