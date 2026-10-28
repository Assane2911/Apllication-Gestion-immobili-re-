import { describe, expect, it } from "vitest";
import { CODES_PAYS } from "./pays";
import { avertissementsDuBail, dateDeFinParDefaut, dureeRenouvellementMois, reglesDuPays } from "./reglesPays";

/**
 * Les règles de location propres à chaque pays, côté affichage. Seul le Sénégal en porte, tirées de textes lus : le COCC
 * (loi n° 66-70 du 13 juillet 1966), art. 571, et le décret n° 2023-382 du 24 février 2023 (JO n° 7605). Le COCC est un code
 * sénégalais, pas un texte de l'UEMOA : les autres pays, dont ceux de l'UEMOA, gardent le comportement neutre d'avant tant
 * que leurs règles n'ont pas été lues et validées. Rien n'est jamais bloquant : le gestionnaire reste libre.
 */
const bail = (surcharge: Partial<Parameters<typeof avertissementsDuBail>[1]> = {}) => ({
  leaseType: "HABITATION",
  rent: 200000,
  deposit: 400000,
  currency: "XOF",
  paymentDay: "31",
  startDate: "2026-01-01",
  endDate: "2029-01-01",
  ...surcharge,
});

describe("règles par pays — valeurs proposées", () => {
  it("Sénégal : droit applicable prérempli, échéance en fin de mois, bail de 36 mois, mise en demeure à 30 jours", () => {
    const r = reglesDuPays("SN");

    expect(r.droitApplicable).toContain("Code des obligations civiles et commerciales");
    expect(r.droitApplicable).toContain("2023-382");
    expect(r.jourEcheance).toBe("31");
    expect(r.dureeBailMois).toBe(36);
    expect(r.delaiMiseEnDemeureJours).toBe(30);
  });

  it("France : droit applicable, durée de 36 mois ; échéance et mise en demeure inchangées", () => {
    const r = reglesDuPays("FR");
    expect(r.droitApplicable).toBe("Loi n° 89-462 du 6 juillet 1989 tendant à améliorer les rapports locatifs");
    expect(r.dureeBailMois).toBe(36);
    expect(r.jourEcheance).toBe("5");
    expect(r.delaiMiseEnDemeureJours).toBe(8);
  });

  it("Côte d'Ivoire : droit applicable prérempli ; aucune durée ni échéance imposée, mise en demeure inchangée", () => {
    const r = reglesDuPays("CI");
    expect(r.droitApplicable).toBe("Loi n° 2019-576 du 26 juin 2019 instituant Code de la construction et de l'habitat (art. 414 et suivants)");
    expect(r.jourEcheance).toBe("5");
    expect(r.dureeBailMois).toBeNull();
    expect(r.delaiMiseEnDemeureJours).toBe(8);
  });

  it("Mali : droit applicable prérempli seulement ; aucune durée ni échéance imposée, mise en demeure inchangée", () => {
    const r = reglesDuPays("ML");
    expect(r.droitApplicable).toBe("Décret n° 2016-0482/P-RM du 7 juillet 2016, Titre VI (Du bail), pris pour l'application de la loi n° 2015-036 du 16 juillet 2015");
    expect(r.jourEcheance).toBe("5");
    expect(r.dureeBailMois).toBeNull();
    expect(r.delaiMiseEnDemeureJours).toBe(8);
  });

  it("Burkina Faso : droit applicable prérempli, mise en demeure à 15 jours ; aucune durée ni échéance imposée", () => {
    const r = reglesDuPays("BF");
    expect(r.droitApplicable).toBe("Loi n° 103-2015/CNT du 22 décembre 2015 portant bail d'habitation privée au Burkina Faso");
    expect(r.jourEcheance).toBe("5");
    expect(r.dureeBailMois).toBeNull();
    expect(r.delaiMiseEnDemeureJours).toBe(15);
  });

  it("Bénin : droit applicable prérempli, mise en demeure à 30 jours (un mois pour payer) ; aucune durée ni échéance imposée", () => {
    const r = reglesDuPays("BJ");
    expect(r.droitApplicable).toBe("Loi n° 2022-30 du 20 décembre 2022 fixant le régime juridique du bail à usage d'habitation en République du Bénin");
    expect(r.jourEcheance).toBe("5");
    expect(r.dureeBailMois).toBeNull();
    expect(r.delaiMiseEnDemeureJours).toBe(30);
  });

  it("Togo : droit applicable prérempli ; aucune durée ni échéance imposée, mise en demeure inchangée", () => {
    const r = reglesDuPays("TG");
    expect(r.droitApplicable).toBe("Décret n° 2022-001/PR du 5 janvier 2022 portant réglementation de la caution, de la garantie de loyer et du bail d'habitation");
    expect(r.jourEcheance).toBe("5");
    expect(r.dureeBailMois).toBeNull();
    expect(r.delaiMiseEnDemeureJours).toBe(8);
  });

  it("Guinée-Bissau : droit applicable prérempli seulement (Lei do Inquilinato) ; aucune durée ni échéance imposée, mise en demeure inchangée", () => {
    const r = reglesDuPays("GW");
    expect(r.droitApplicable).toBe("Decreto n.º 13-A/89, de 9 de Junho (Lei do Inquilinato), e Código Civil");
    expect(r.jourEcheance).toBe("5");
    expect(r.dureeBailMois).toBeNull();
    expect(r.delaiMiseEnDemeureJours).toBe(8);
  });

  it("autre pays, et un compte sans pays : le comportement neutre d'avant", () => {
    for (const code of [...CODES_PAYS.filter((c) => !["SN", "FR", "CI", "ML", "BF", "BJ", "TG", "GW"].includes(c)), null, undefined, "XX"]) {
      const r = reglesDuPays(code);
      expect(r, String(code)).toEqual({ droitApplicable: "", jourEcheance: "5", dureeBailMois: null, delaiMiseEnDemeureJours: 8 });
    }
  });

  it("n'attribue pas le COCC aux autres pays de l'UEMOA", () => {
    for (const code of ["CI", "ML", "BF", "BJ", "TG", "NE", "GW"]) expect(reglesDuPays(code).droitApplicable, code).not.toContain("Code des obligations civiles et commerciales");
    for (const code of ["NE"]) expect(reglesDuPays(code).droitApplicable, code).toBe("");
  });

  it("renouvellement : 36 mois pour un bail d'habitation au Sénégal et en France, 12 mois ailleurs (Côte d'Ivoire comprise) et pour un bail commercial", () => {
    expect(dureeRenouvellementMois("CI", "HABITATION")).toBe(12);
    expect(dureeRenouvellementMois("ML", "HABITATION")).toBe(12);
    expect(dureeRenouvellementMois("BF", "HABITATION")).toBe(12);
    expect(dureeRenouvellementMois("BJ", "HABITATION")).toBe(12);
    expect(dureeRenouvellementMois("TG", "HABITATION")).toBe(12);
    expect(dureeRenouvellementMois("GW", "HABITATION")).toBe(12);
    expect(dureeRenouvellementMois("SN", "HABITATION")).toBe(36);
    expect(dureeRenouvellementMois("FR", "HABITATION")).toBe(36);
    expect(dureeRenouvellementMois("SN", "COMMERCIAL")).toBe(12);
    expect(dureeRenouvellementMois("FR", "COMMERCIAL")).toBe(12);
    expect(dureeRenouvellementMois(null, "HABITATION")).toBe(12);
  });

  it("date de fin proposée : début + 36 mois au Sénégal (même convention que le renouvellement), rien ailleurs", () => {
    expect(dateDeFinParDefaut("SN", "HABITATION", "2026-03-15")).toBe("2029-03-15");
    expect(dateDeFinParDefaut("SN", "HABITATION", "2028-02-29")).toBe("2031-02-28");
    expect(dateDeFinParDefaut("SN", "COMMERCIAL", "2026-03-15")).toBe("");
    expect(dateDeFinParDefaut("FR", "HABITATION", "2026-03-15")).toBe("2029-03-15");
    expect(dateDeFinParDefaut("SN", "HABITATION", "")).toBe("");
  });
});

describe("règles par pays — avertissements du bail (Sénégal)", () => {
  it("aucun avertissement pour un bail conforme : 3 ans, échéance en fin de mois, caution de 2 mois", () => {
    expect(avertissementsDuBail("SN", bail())).toEqual([]);
  });

  it("caution : plus de 2 mois de loyer pour un loyer d'au plus 500 000 FCFA (décret 2023-382)", () => {
    expect(avertissementsDuBail("SN", bail({ deposit: 400001 })).map((a) => a.cle)).toEqual(["deposit"]);
    expect(avertissementsDuBail("SN", bail({ rent: 500000, deposit: 1000001 })).map((a) => a.cle)).toEqual(["deposit"]);
  });

  it("caution : le décret ne plafonne rien au-dessus de 500 000 FCFA, ni dans une autre devise", () => {
    expect(avertissementsDuBail("SN", bail({ rent: 500001, deposit: 3000000 }))).toEqual([]);
    expect(avertissementsDuBail("SN", bail({ currency: "EUR", rent: 300, deposit: 3000 }))).toEqual([]);
  });

  it("caution : ne dit rien tant que le loyer ou la caution ne sont pas saisis", () => {
    expect(avertissementsDuBail("SN", bail({ rent: 0, deposit: 500000 }))).toEqual([]);
    expect(avertissementsDuBail("SN", bail({ rent: Number.NaN, deposit: Number.NaN }))).toEqual([]);
  });

  it("échéance : le loyer est payable à la fin du mois de jouissance, pas à un autre jour ni au jour de début", () => {
    expect(avertissementsDuBail("SN", bail({ paymentDay: "5" })).map((a) => a.cle)).toEqual(["paymentDay"]);
    expect(avertissementsDuBail("SN", bail({ paymentDay: "" })).map((a) => a.cle)).toEqual(["paymentDay"]);
    expect(avertissementsDuBail("SN", bail({ paymentDay: "31" }))).toEqual([]);
  });

  it("durée : un bail d'habitation est de trois ans renouvelables ou à durée indéterminée (COCC, art. 571)", () => {
    expect(avertissementsDuBail("SN", bail({ endDate: "2027-01-01" })).map((a) => a.cle)).toEqual(["duration"]);
    expect(avertissementsDuBail("SN", bail({ endDate: "2029-06-01" })).map((a) => a.cle)).toEqual(["duration"]);
  });

  it("durée : trois ans exactement, en comptant la fin au dernier jour ou au lendemain", () => {
    expect(avertissementsDuBail("SN", bail({ endDate: "2029-01-01" }))).toEqual([]);
    expect(avertissementsDuBail("SN", bail({ endDate: "2028-12-31" }))).toEqual([]);
  });

  it("durée : ne dit rien tant que les dates ne sont pas saisies", () => {
    expect(avertissementsDuBail("SN", bail({ startDate: "", endDate: "" }))).toEqual([]);
    expect(avertissementsDuBail("SN", bail({ endDate: "" }))).toEqual([]);
  });

  it("un bail commercial n'est pas concerné (il relève d'un autre régime)", () => {
    expect(avertissementsDuBail("SN", bail({ leaseType: "COMMERCIAL", deposit: 9000000, paymentDay: "5", endDate: "2027-01-01" }))).toEqual([]);
  });

  it("Guinée-Bissau : aucun rappel, le texte lu ne plafonne ni le dépôt de garantie ni la durée", () => {
    expect(avertissementsDuBail("GW", bail({ deposit: 9000000, paymentDay: "", endDate: "2027-01-01" }))).toEqual([]);
  });

  it("aucun avertissement hors de la France, de la Côte d'Ivoire et du Sénégal : le Mali n'a aucun plafond lu, les autres pays n'ont pas été lus", () => {
    for (const code of ["NE", "ML", null, undefined]) {
      expect(avertissementsDuBail(code, bail({ deposit: 9000000, paymentDay: "5", endDate: "2027-01-01" })), String(code)).toEqual([]);
    }
  });
});

describe("règles par pays — avertissements du bail (France, loi du 6 juillet 1989)", () => {
  it("aucun avertissement pour un bail conforme : dépôt d'un mois, durée de trois ans", () => {
    expect(avertissementsDuBail("FR", bail({ currency: "EUR", rent: 800, deposit: 800, paymentDay: "5", endDate: "2029-01-01" }))).toEqual([]);
  });

  it("dépôt de garantie : plus d'un mois de loyer (article 22)", () => {
    expect(avertissementsDuBail("FR", bail({ currency: "EUR", rent: 800, deposit: 1600, endDate: "2029-01-01" })).map((a) => a.cle)).toEqual(["deposit"]);
  });

  it("durée : moins de trois ans (article 10)", () => {
    expect(avertissementsDuBail("FR", bail({ currency: "EUR", rent: 800, deposit: 800, endDate: "2028-06-01" })).map((a) => a.cle)).toEqual(["duration"]);
  });

  it("pas de rappel d'échéance en France : le jour de paiement n'est pas encadré par le texte lu", () => {
    expect(avertissementsDuBail("FR", bail({ currency: "EUR", rent: 800, deposit: 800, paymentDay: "5", endDate: "2029-01-01" }))).toEqual([]);
  });

  it("un bail commercial n'est pas concerné en France non plus", () => {
    expect(avertissementsDuBail("FR", bail({ leaseType: "COMMERCIAL", rent: 800, deposit: 9000, endDate: "2027-01-01" }))).toEqual([]);
  });
});

describe("règles par pays — avertissements du bail (Côte d'Ivoire, loi n° 2019-576 ; Burkina Faso, loi n° 103-2015/CNT)", () => {
  it("Burkina Faso : même rappel, dépôt de garantie de plus de deux mois de loyer (article 26), rien d'autre", () => {
    const b = bail({ rent: 200000, deposit: 400000, paymentDay: "5", endDate: "2027-01-01" });
    expect(avertissementsDuBail("BF", b)).toEqual([]);
    expect(avertissementsDuBail("BF", { ...b, deposit: 400001 }).map((a) => a.cle)).toEqual(["deposit"]);
    expect(avertissementsDuBail("BF", { ...b, deposit: 9000000, leaseType: "COMMERCIAL" })).toEqual([]);
  });

  it("Bénin : le plafond est de trois mois de loyer (articles 57 et 69), pas deux ; rien d'autre", () => {
    const b = bail({ rent: 200000, deposit: 600000, paymentDay: "5", endDate: "2027-01-01" });
    expect(avertissementsDuBail("BJ", b)).toEqual([]);
    expect(avertissementsDuBail("BJ", { ...b, deposit: 600001 }).map((a) => a.cle)).toEqual(["deposit"]);
    expect(avertissementsDuBail("BF", { ...b, deposit: 600000 }).map((a) => a.cle)).toEqual(["deposit"]);
    expect(avertissementsDuBail("BJ", { ...b, deposit: 9000000, leaseType: "COMMERCIAL" })).toEqual([]);
  });

  it("Togo : caution et garantie de loyer sont plafonnées à trois mois chacune, le cumul de six mois est comparé (articles 4 et 8)", () => {
    const b = bail({ rent: 200000, deposit: 1200000, paymentDay: "5", endDate: "2027-01-01" });
    expect(avertissementsDuBail("TG", b)).toEqual([]);
    expect(avertissementsDuBail("TG", { ...b, deposit: 1200001 }).map((a) => a.cle)).toEqual(["deposit"]);
    expect(avertissementsDuBail("BJ", { ...b, deposit: 1200000 }).map((a) => a.cle)).toEqual(["deposit"]);
    expect(avertissementsDuBail("TG", { ...b, deposit: 9000000, leaseType: "COMMERCIAL" })).toEqual([]);
  });

  const ci = (surcharge: Partial<Parameters<typeof avertissementsDuBail>[1]> = {}) => bail({ rent: 200000, deposit: 400000, paymentDay: "5", endDate: "2027-01-01", ...surcharge });

  it("dépôt de garantie : deux mois de loyer au plus, quelle que soit la durée ou l'échéance (article 416)", () => {
    expect(avertissementsDuBail("CI", ci())).toEqual([]);
    expect(avertissementsDuBail("CI", ci({ deposit: 400001 })).map((a) => a.cle)).toEqual(["deposit"]);
    expect(avertissementsDuBail("CI", ci({ currency: "EUR", rent: 300, deposit: 900 })).map((a) => a.cle)).toEqual(["deposit"]);
  });

  it("ne dit rien tant que le loyer n'est pas saisi, ni pour un bail commercial", () => {
    expect(avertissementsDuBail("CI", ci({ rent: 0, deposit: 500000 }))).toEqual([]);
    expect(avertissementsDuBail("CI", ci({ leaseType: "COMMERCIAL", deposit: 9000000 }))).toEqual([]);
  });

  it("pas de rappel de durée ni d'échéance : le texte lu n'impose ni durée minimale ni jour de paiement", () => {
    expect(avertissementsDuBail("CI", ci({ paymentDay: "", endDate: "2026-06-01" }))).toEqual([]);
  });
});
