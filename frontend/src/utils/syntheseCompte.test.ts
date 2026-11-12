import { describe, expect, it } from "vitest";
import {
  avertissementsBancaires,
  basculerEtape,
  completudeProfil,
  csvHistoriqueAbonnement,
  csvRapportImport,
  economieAnnuelle,
  filtrerLignesImport,
  formuleSuperieure,
  formulaireModifie,
  lienMailParrainage,
  lienWhatsappParrainage,
  lireEtapesFaites,
  messageParrainage,
  placesRestantes,
  prochaineEtape,
  syntheseHistorique,
} from "./syntheseCompte";

const form = { agencyName: "Baobab", siretOrId: "", address: "Dakar", phone: " ", legalNotice: "", iban: "", bic: "" };

describe("completudeProfil", () => {
  it("compte les éléments renseignés et liste ceux qui manquent avec leur rubrique", () => {
    const r = completudeProfil(form, "/logo.png", null);
    expect(r.total).toBe(8);
    expect(r.faits).toBe(3);
    expect(r.complet).toBe(false);
    expect(r.manquants.map((m) => m.cle)).toEqual(["legalId", "phone", "legalNotice", "bank", "stamp"]);
    expect(r.manquants.find((m) => m.cle === "stamp")?.ancre).toBe("agency-stamp");
  });

  it("est complet quand tout est renseigné", () => {
    const r = completudeProfil({ ...form, siretOrId: "123", phone: "+221", legalNotice: "SARL", iban: "SN08" }, "/l", "/s");
    expect(r.complet).toBe(true);
    expect(r.manquants).toEqual([]);
  });
});

describe("avertissementsBancaires", () => {
  it("ne dit rien d'un champ vide, signale un IBAN à clé fausse et un BIC mal formé", () => {
    expect(avertissementsBancaires("", "")).toEqual({ iban: false, bic: false });
    expect(avertissementsBancaires("FR76 3000 6000 0112 3456 7890 189", "AGRIFRPP")).toEqual({ iban: false, bic: false });
    expect(avertissementsBancaires("FR76 3000 6000 0112 3456 7890 188", "XX")).toEqual({ iban: true, bic: true });
  });
});

describe("formulaireModifie", () => {
  it("détecte un champ changé, y compris un booléen", () => {
    const a = { x: "1", y: false };
    expect(formulaireModifie(a, { x: "1", y: false })).toBe(false);
    expect(formulaireModifie(a, { x: "1", y: true })).toBe(true);
    expect(formulaireModifie(a, { x: "2", y: false })).toBe(true);
  });
});

describe("historique d'abonnement", () => {
  const p = (o: Partial<Parameters<typeof syntheseHistorique>[0][number]>) => ({
    plan: "PROFESSIONAL", amount: 100, currency: "EUR", billingCycle: "MONTHLY", status: "PAID", paymentMethod: "STRIPE", createdAt: "2026-01-10T00:00:00.000Z", ...o,
  });

  it("totalise par devise et retient le paiement le plus récent", () => {
    const r = syntheseHistorique([p({}), p({ amount: 50, createdAt: "2026-03-01T00:00:00.000Z" }), p({ amount: 60000, currency: "XOF" })]);
    expect(r.paiements).toBe(3);
    expect(r.totaux).toEqual([{ devise: "EUR", montant: 150 }, { devise: "XOF", montant: 60000 }]);
    expect(r.dernier).toBe("2026-03-01T00:00:00.000Z");
    expect(r.enAttente).toBe(0);
    expect(syntheseHistorique([])).toEqual({ paiements: 0, totaux: [], dernier: null, enAttente: 0 });
  });

  /**
   * Régression : un virement déclaré crée une ligne « PENDING » tant que la plateforme ne l'a pas validé. L'écran additionnait
   * ces lignes : cinq virements en attente affichaient « 5 paiements, 105 000 FCFA réglés, dernier paiement aujourd'hui »
   * alors que rien n'avait été reçu.
   */
  it("ne compte comme réglés que les paiements validés ; les virements en attente sont comptés à part", () => {
    const r = syntheseHistorique([
      p({ amount: 25000, currency: "XOF", status: "PENDING", createdAt: "2026-11-12T00:00:00.000Z" }),
      p({ amount: 25000, currency: "XOF", status: "PENDING", createdAt: "2026-11-12T01:00:00.000Z" }),
      p({ amount: 5000, currency: "XOF", status: "PAID", createdAt: "2026-10-01T00:00:00.000Z" }),
    ]);
    expect(r.paiements).toBe(1);
    expect(r.totaux).toEqual([{ devise: "XOF", montant: 5000 }]);
    expect(r.dernier).toBe("2026-10-01T00:00:00.000Z");
    expect(r.enAttente).toBe(2);
  });

  it("n'affiche aucun paiement réglé quand tout est en attente : total à 0, pas de dernier paiement", () => {
    const r = syntheseHistorique([p({ amount: 25000, currency: "XOF", status: "PENDING" }), p({ amount: 30, currency: "EUR", status: "PENDING" })]);
    expect(r.paiements).toBe(0);
    expect(r.totaux).toEqual([{ devise: "XOF", montant: 0 }, { devise: "EUR", montant: 0 }]);
    expect(r.dernier).toBeNull();
    expect(r.enAttente).toBe(2);
  });

  it("exporte en CSV avec montant à virgule et formule neutralisée", () => {
    const csv = csvHistoriqueAbonnement(
      [p({ amount: 19.5, paymentRef: "=CMD" })],
      { date: "Date", plan: "Formule", cycle: "Cycle", amount: "Montant", currency: "Devise", method: "Moyen", reference: "Référence", status: "Statut" },
      () => "10/01/2026"
    );
    const lignes = csv.replace("﻿", "").split("\n");
    expect(lignes[0]).toBe('"Date";"Formule";"Cycle";"Montant";"Devise";"Moyen";"Référence";"Statut"');
    expect(lignes[1]).toBe('"10/01/2026";"PROFESSIONAL";"MONTHLY";"19,50";"EUR";"STRIPE";"\'=CMD";"PAID"');
  });

  it("calcule l'économie de l'annuel, jamais négative", () => {
    expect(economieAnnuelle({ monthlyPrice: 19, annualPrice: 182 })).toBe(46);
    expect(economieAnnuelle({ monthlyPrice: 10, annualPrice: 130 })).toBe(0);
  });
});

describe("formuleSuperieure", () => {
  const plans = [
    { id: "STARTER", monthlyPrice: 19, maxProperties: 5 },
    { id: "PROFESSIONAL", monthlyPrice: 49, maxProperties: 25 },
    { id: "ENTERPRISE", monthlyPrice: 99, maxProperties: "Illimité" },
  ];

  it("propose la moins chère des formules supérieures qui loge le parc, dès 80 % du plafond", () => {
    expect(formuleSuperieure(plans, "STARTER", { count: 4, max: 5 })?.id).toBe("PROFESSIONAL");
    expect(formuleSuperieure(plans, "STARTER", { count: 6, max: 5 })?.id).toBe("PROFESSIONAL");
    expect(formuleSuperieure(plans, "PROFESSIONAL", { count: 24, max: 25 })?.id).toBe("ENTERPRISE");
  });

  it("ne propose rien loin du plafond, sans plafond ou sans formule plus large", () => {
    expect(formuleSuperieure(plans, "STARTER", { count: 3, max: 5 })).toBeNull();
    expect(formuleSuperieure(plans, "ENTERPRISE", { count: 400, max: null })).toBeNull();
    expect(formuleSuperieure(plans, "STARTER", null)).toBeNull();
    expect(formuleSuperieure([plans[0]], "STARTER", { count: 5, max: 5 })).toBeNull();
  });
});

describe("parrainage", () => {
  it("fabrique le message et les liens de partage encodés", () => {
    const m = messageParrainage("Essayez ImmoPlatform", "https://x.test/r?c=AB&d=1");
    expect(m).toBe("Essayez ImmoPlatform https://x.test/r?c=AB&d=1");
    expect(lienWhatsappParrainage(m)).toBe(`https://wa.me/?text=${encodeURIComponent(m)}`);
    expect(lienMailParrainage("Sujet é", m)).toBe(`mailto:?subject=${encodeURIComponent("Sujet é")}&body=${encodeURIComponent(m)}`);
  });

  it("compte les places restantes sous le plafond", () => {
    expect(placesRestantes({ rewardedReferrals: 3, maxRewardedReferrals: 12, rewardDays: 30 })).toEqual({ places: 9, jours: 270 });
    expect(placesRestantes({ rewardedReferrals: 12, maxRewardedReferrals: 12, rewardDays: 30 })).toEqual({ places: 0, jours: 0 });
  });
});

describe("import", () => {
  const lignes = [
    { ligne: 2, statut: "OK" as const, messages: [], resume: "Villa" },
    { ligne: 3, statut: "ERREUR" as const, messages: ["Loyer manquant", "Adresse manquante"], resume: "Studio" },
    { ligne: 4, statut: "DOUBLON" as const, messages: ["Déjà présent"], resume: "Atelier" },
  ];

  it("filtre par statut", () => {
    expect(filtrerLignesImport(lignes, "all")).toHaveLength(3);
    expect(filtrerLignesImport(lignes, "ERREUR").map((l) => l.ligne)).toEqual([3]);
    expect(filtrerLignesImport(lignes, "DOUBLON").map((l) => l.ligne)).toEqual([4]);
  });

  it("n'exporte que les lignes à corriger, avec tous leurs motifs", () => {
    const csv = csvRapportImport(lignes, { line: "Ligne", status: "Statut", data: "Données", reason: "Motif", statuts: { OK: "Prête", DOUBLON: "Doublon", ERREUR: "Erreur" } });
    expect(csv.replace("﻿", "").split("\n")).toEqual([
      '"Ligne";"Statut";"Données";"Motif"',
      '"3";"Erreur";"Studio";"Loyer manquant | Adresse manquante"',
      '"4";"Doublon";"Atelier";"Déjà présent"',
    ]);
  });
});

describe("guide de démarrage", () => {
  const ordre = ["agency", "import", "records"] as const;

  it("lit les étapes cochées sans jamais échouer", () => {
    expect(lireEtapesFaites('["agency","inconnue",3]', ordre)).toEqual(["agency"]);
    expect(lireEtapesFaites("pas du json", ordre)).toEqual([]);
    expect(lireEtapesFaites('{"a":1}', ordre)).toEqual([]);
    expect(lireEtapesFaites(null, ordre)).toEqual([]);
  });

  it("coche, décoche et désigne la prochaine étape", () => {
    expect(basculerEtape(["agency"], "import")).toEqual(["agency", "import"]);
    expect(basculerEtape(["agency", "import"], "agency")).toEqual(["import"]);
    expect(prochaineEtape(ordre, ["agency"])).toBe("import");
    expect(prochaineEtape(ordre, ["records", "import", "agency"])).toBeNull();
  });
});
