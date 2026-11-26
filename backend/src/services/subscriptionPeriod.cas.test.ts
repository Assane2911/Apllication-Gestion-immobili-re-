import { describe, expect, it } from "vitest";
import { ajouterJours, calculerJoursCredit, calculerPeriode, calculerPeriodeActivation } from "./subscriptionPeriod.service";

/**
 * Audit par sabotage de subscriptionPeriod.service.ts : les cas que subscriptionPeriod.service.test.ts ne tenait pas.
 *
 * Les résultats attendus sont CALCULÉS À LA MAIN (voir chaque cas), et non recalculés avec les fonctions testées : un attendu
 * obtenu par la même formule que le code ne peut pas le contredire. Les jours restants et les montants sont choisis pour
 * qu'un écart de calcul ne disparaisse pas dans l'arrondi à l'entier le plus proche.
 *
 * Dates locales (comme le service), 2026 n'étant pas bissextile : février compte 28 jours.
 */
function d(annee: number, mois: number, jour: number): Date {
  return new Date(annee, mois - 1, jour);
}

/** Des tarifs aux rapports volontairement DIFFÉRENTS d'un cycle à l'autre (mensuel 600, annuel 500) pour qu'on les distingue. */
const tarifs = (plan: string, devise: string) => {
  const table: Record<string, Record<string, { monthly: number; annual: number }>> = {
    STARTER: {
      EUR: { monthly: 10, annual: 100 },
      XOF: { monthly: 6000, annual: 50000 },
      ZERO: { monthly: 0, annual: 0 }, // un catalogue sans prix pour ce cycle
    },
  };
  return table[plan]?.[devise] ?? null;
};

const AUCUN_TARIF = () => null;

describe("calculerPeriode : des dates indépendantes de celles qu'on passe", () => {
  it("la date de départ reportée de la fin des droits est une COPIE : la modifier ne change pas la fin d'origine", () => {
    const fin = d(2026, 9, 30);

    const { startDate, endDate } = calculerPeriode({ maintenant: d(2026, 9, 10), cycle: "MONTHLY", finActuelle: fin });

    expect(startDate).not.toBe(fin);
    startDate.setDate(1);
    endDate.setDate(1);
    expect(fin).toEqual(d(2026, 9, 30));
  });

  it("la date de départ « maintenant » est une COPIE : la modifier ne change pas la date passée", () => {
    const maintenant = d(2026, 9, 10);

    for (const finActuelle of [null, d(2026, 8, 1)]) {
      const { startDate } = calculerPeriode({ maintenant, cycle: "MONTHLY", finActuelle });
      expect(startDate).not.toBe(maintenant);
      startDate.setDate(1);
    }
    expect(maintenant).toEqual(d(2026, 9, 10));
  });
});

describe("ajouterJours : la date passée n'est pas modifiée", () => {
  it("renvoie une nouvelle date et laisse l'originale intacte", () => {
    const depuis = d(2026, 9, 10);

    const resultat = ajouterJours(depuis, 5);

    expect(resultat).toEqual(d(2026, 9, 15));
    expect(depuis).toEqual(d(2026, 9, 10));
  });
});

describe("calculerJoursCredit : une donnée invalide ne crédite jamais rien (jamais d'infini ni de négatif)", () => {
  const valide = { ancienMontant: 9, ancienCycleJours: 30, joursRestants: 10, nouveauMontant: 29, nouveauCycleJours: 30 };

  it("référence : les valeurs valides donnent un crédit positif", () => {
    expect(calculerJoursCredit(valide)).toBeCloseTo((9 * (10 / 30)) / (29 / 30), 6); // ≈ 3,10 jours
  });

  it.each([
    ["des jours restants négatifs", { joursRestants: -5 }],
    ["un ancien cycle de 0 jour", { ancienCycleJours: 0 }],
    ["un ancien cycle négatif", { ancienCycleJours: -30 }],
    ["un nouveau cycle négatif", { nouveauCycleJours: -30 }],
    ["un nouveau tarif nul", { nouveauMontant: 0 }],
    ["un nouveau tarif négatif", { nouveauMontant: -29 }],
  ])("%s → 0 jour de crédit", (_nom, surcharge) => {
    expect(calculerJoursCredit({ ...valide, ...surcharge })).toBe(0);
  });
});

describe("calculerPeriodeActivation : changement de plan, valeurs calculées à la main", () => {
  it("sans fin des droits connue, un changement de plan donne une période neuve, sans crédit", () => {
    // Un compte à 29 €/mois qui passe à 9 € : s'il restait 1 jour, il serait crédité 3,2 jours ; sans fin connue, rien.
    const resultat = calculerPeriodeActivation({
      maintenant: d(2026, 9, 10),
      cycle: "MONTHLY",
      changeDePlan: true,
      finActuelle: null,
      nouveauMontant: 9,
      nouvelleDevise: "EUR",
      dernierPaiement: { amount: 29, startDate: d(2026, 8, 10), billingCycle: "MONTHLY", currency: "EUR", plan: "PRO" },
      tarifPourDevise: AUCUN_TARIF,
    });

    expect(resultat).toEqual({ startDate: d(2026, 9, 10), endDate: d(2026, 10, 10) });
  });

  it("la période proratisée COMMENCE MAINTENANT ; la durée de l'ancien cycle part de la date de début de son paiement, pas de maintenant", () => {
    // Ancien paiement : 9 € le 10 janvier (cycle nominal du 10 janvier au 10 février = 31 jours).
    // Nouvelle période : le 10 février → le 10 mars (28 jours). Restent 18 jours (jusqu'au 28 février). 29 €/mois.
    //   valeur non consommée = 9 × 18/31 = 5,226 €     tarif du jour = 29/28 = 1,0357 €
    //   crédit = 5,226 / 1,0357 = 5,05 jours → 5 jours → fin le 15 mars.
    // (Ancien cycle compté depuis « maintenant » — 28 jours — ou durées permutées : 5,59 → 6 jours, donc le 16 mars.)
    const resultat = calculerPeriodeActivation({
      maintenant: d(2026, 2, 10),
      cycle: "MONTHLY",
      changeDePlan: true,
      finActuelle: d(2026, 2, 28),
      nouveauMontant: 29,
      nouvelleDevise: "EUR",
      dernierPaiement: { amount: 9, startDate: d(2026, 1, 10), billingCycle: "MONTHLY", currency: "EUR", plan: "STARTER" },
      tarifPourDevise: AUCUN_TARIF,
    });

    expect(resultat.startDate).toEqual(d(2026, 2, 10));
    expect(resultat.endDate).toEqual(d(2026, 3, 15));
  });

  it("l'ancien cycle est celui de son dernier paiement (ici ANNUEL), pas celui du nouveau plan (mensuel)", () => {
    // Ancien : 86 € pour un an (10 janvier 2026 → 10 janvier 2027 = 365 jours). Il en reste 10 (jusqu'au 20 février).
    // Nouveau : 29 €/mois, du 10 février au 10 mars (28 jours).
    //   valeur = 86 × 10/365 = 2,356 €     tarif du jour = 29/28 = 1,0357 €     crédit = 2,275 jours → 2 → fin le 12 mars.
    // (Ancien cycle pris pour mensuel — 31 jours — : 26,8 jours de crédit.)
    const resultat = calculerPeriodeActivation({
      maintenant: d(2026, 2, 10),
      cycle: "MONTHLY",
      changeDePlan: true,
      finActuelle: d(2026, 2, 20),
      nouveauMontant: 29,
      nouvelleDevise: "EUR",
      dernierPaiement: { amount: 86, startDate: d(2026, 1, 10), billingCycle: "ANNUAL", currency: "EUR", plan: "STARTER" },
      tarifPourDevise: AUCUN_TARIF,
    });

    expect(resultat.endDate).toEqual(d(2026, 3, 12));
  });
});

describe("calculerPeriodeActivation : conversion de devise, valeurs calculées à la main", () => {
  /** Une période commencée le 10 février : l'ancien paiement date du 10 janvier ; 10 jours restants (jusqu'au 20 février). */
  const commun = {
    maintenant: d(2026, 2, 10),
    cycle: "MONTHLY" as const,
    changeDePlan: true,
    finActuelle: d(2026, 2, 20),
    nouvelleDevise: "XOF",
    tarifPourDevise: tarifs,
  };

  it("un paiement ANNUEL converti avec le rapport ANNUEL des tarifs (500), pas le mensuel (600)", () => {
    // 100 € payés pour un an → 100 × (50 000/100) = 50 000 FCFA. Cycle de l'ancien paiement : 365 jours.
    // Nouveau : 3 000 FCFA/mois sur 28 jours (10 février → 10 mars) = 107,14 FCFA/jour.
    //   valeur = 50 000 × 10/365 = 1 369,9      crédit = 12,79 jours → 13 → fin le 23 mars.
    // (Rapport mensuel : 60 000 FCFA → 15,34 jours → 15 → le 25 mars.)
    const resultat = calculerPeriodeActivation({
      ...commun,
      nouveauMontant: 3000,
      dernierPaiement: { amount: 100, startDate: d(2026, 1, 10), billingCycle: "ANNUAL", currency: "EUR", plan: "STARTER" },
    });

    expect(resultat.endDate).toEqual(d(2026, 3, 23));
  });

  it("un paiement MENSUEL converti avec le rapport MENSUEL des tarifs (600), pas l'annuel (500)", () => {
    // 10 € payés pour un mois → 10 × (6 000/10) = 6 000 FCFA. Cycle de l'ancien paiement : 31 jours (10 janvier → 10 février).
    //   valeur = 6 000 × 10/31 = 1 935,5      tarif du jour = 107,14      crédit = 18,06 jours → 18 → fin le 28 mars.
    // (Rapport annuel : 5 000 FCFA → 15,05 jours → 15 → le 25 mars.)
    const resultat = calculerPeriodeActivation({
      ...commun,
      nouveauMontant: 3000,
      dernierPaiement: { amount: 10, startDate: d(2026, 1, 10), billingCycle: "MONTHLY", currency: "EUR", plan: "STARTER" },
    });

    expect(resultat.endDate).toEqual(d(2026, 3, 28));
  });

  it("sans tarif dans la devise CIBLE : période neuve, sans crédit (et sans erreur)", () => {
    const resultat = calculerPeriodeActivation({
      ...commun,
      nouvelleDevise: "ZZZ", // devise inconnue du catalogue
      nouveauMontant: 3000,
      dernierPaiement: { amount: 10, startDate: d(2026, 1, 10), billingCycle: "MONTHLY", currency: "EUR", plan: "STARTER" },
    });

    expect(resultat).toEqual({ startDate: d(2026, 2, 10), endDate: d(2026, 3, 10) });
  });

  it("un tarif SOURCE nul pour ce cycle : période neuve, jamais un crédit infini ni calculé sur le montant brut", () => {
    // Le catalogue n'a pas de prix mensuel pour cette devise (0) : la conversion est impossible.
    // Montant brut (10) pris pour des FCFA face à 3 FCFA/mois : 30 jours de crédit ; infini sans garde.
    const resultat = calculerPeriodeActivation({
      ...commun,
      nouvelleDevise: "XOF",
      nouveauMontant: 3,
      dernierPaiement: { amount: 10, startDate: d(2026, 1, 10), billingCycle: "MONTHLY", currency: "ZERO", plan: "STARTER" },
    });

    expect(resultat).toEqual({ startDate: d(2026, 2, 10), endDate: d(2026, 3, 10) });
  });
});
