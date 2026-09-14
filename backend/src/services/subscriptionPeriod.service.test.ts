import { describe, expect, it } from "vitest";
import { calculerPeriode } from "./subscriptionPeriod.service";

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
