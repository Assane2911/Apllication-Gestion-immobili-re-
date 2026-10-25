import { describe, expect, it } from "vitest";
import { libelleMoyenPaiement } from "../utils/moyenPaiement";
import type { Langue } from "../utils/langue";
import { overdueReminderEmail, partialPaymentReceiptEmail, paymentReceiptEmail, rentDueReminderEmail, rentDueSoonReminderEmail } from "./email.service";

/**
 * Lot 2A de l'internationalisation des e-mails : ceux qu'un locataire reçoit sans avoir rien demandé — avis
 * d'échéance, rappel avant échéance, relances d'impayé, quittance et reçu de paiement partiel. Ils suivent la langue
 * enregistrée sur sa fiche. Le français reste le texte par défaut, inchangé.
 */
const LANGUES: Langue[] = ["fr", "en", "es", "pt"];
const AUTRES: Array<"en" | "es" | "pt"> = ["en", "es", "pt"];

/** Mots qui trahissent un reste de français dans une autre langue (la marque et les noms de moyens de paiement exceptés). */
const MOTS_FRANCAIS =
  /\b(Bonjour|vous|votre|Votre|loyer|locataire|logement|[ée]ch[ée]ance|Régler|règlement|paiement|quittance|automatiquement|impayé|retard|Reste|agence de gestion|Conformément|bail)\b/;
const texteDe = (m: { subject: string; html: string }) => (m.subject + " " + m.html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");

const ECHEANCE = new Date(Date.UTC(2026, 10, 5, 12));
const base = {
  tenantName: "Awa <b>Sow</b>",
  propertyTitle: "Studio <i>Almadies</i>",
  amount: 35000,
  currency: "XOF",
  periodMonth: 11,
  periodYear: 2026,
  dueDate: ECHEANCE,
  frontendUrl: "https://app.exemple.test",
};

const modeles: Array<{ nom: string; fabrique: (l?: Langue) => { subject: string; html: string } }> = [
  { nom: "avis d'échéance", fabrique: (langue) => rentDueReminderEmail({ ...base, langue }) },
  { nom: "rappel avant échéance", fabrique: (langue) => rentDueSoonReminderEmail({ ...base, daysLeft: 3, langue }) },
  { nom: "relance niveau 1", fabrique: (langue) => overdueReminderEmail({ ...base, daysLate: 7, niveau: 1, agencyName: "Agence Teranga", langue }) },
  { nom: "relance niveau 2", fabrique: (langue) => overdueReminderEmail({ ...base, daysLate: 17, niveau: 2, agencyName: "Agence Teranga", langue }) },
  { nom: "relance niveau 3", fabrique: (langue) => overdueReminderEmail({ ...base, daysLate: 27, niveau: 3, agencyName: "Agence Teranga", langue }) },
  { nom: "quittance", fabrique: (langue) => paymentReceiptEmail({ ...base, langue }) },
  {
    nom: "reçu de paiement partiel",
    fabrique: (langue) =>
      partialPaymentReceiptEmail({ ...base, paymentAmount: 10000, paymentDate: ECHEANCE, paymentMethod: "BANK_TRANSFER", rent: 35000, alreadyPaid: 10000, remaining: 25000, agencyName: "Agence Teranga", langue }),
  },
];

describe.each(modeles)("e-mail « $nom »", ({ fabrique }) => {
  it("sans langue, reste en français", () => {
    expect(texteDe(fabrique())).toMatch(/Bonjour/);
    expect(fabrique("fr")).toEqual(fabrique());
  });

  it.each(AUTRES)("en %s : texte traduit, sans reste de français", (langue) => {
    expect(texteDe(fabrique(langue))).not.toMatch(MOTS_FRANCAIS);
  });

  it("chaque langue donne un sujet et un corps différents des autres", () => {
    expect(new Set(LANGUES.map((l) => fabrique(l).subject)).size).toBe(4);
    expect(new Set(LANGUES.map((l) => fabrique(l).html)).size).toBe(4);
  });

  it("les noms saisis sont échappés dans toutes les langues", () => {
    for (const l of LANGUES) {
      const { html } = fabrique(l);
      expect(html).not.toContain("<b>Sow</b>");
      expect(html).not.toContain("<i>Almadies</i>");
    }
  });

  it("un sujet ne contient jamais de retour à la ligne", () => {
    for (const l of LANGUES) expect(fabrique(l).subject).not.toMatch(/[\r\n]/);
  });
});

describe("montants et dates dans la langue du destinataire", () => {
  it("le montant et la date limite s'écrivent comme sur le portail", () => {
    expect(texteDe(rentDueReminderEmail({ ...base, langue: "en" }))).toContain("35,000 FCFA");
    expect(texteDe(rentDueReminderEmail({ ...base, langue: "en" }))).toContain("November 5, 2026");
    expect(texteDe(rentDueReminderEmail({ ...base, langue: "es" }))).toContain("35.000 FCFA");
    expect(texteDe(rentDueReminderEmail({ ...base, langue: "es" }))).toContain("5 de noviembre de 2026");
    expect(texteDe(rentDueReminderEmail({ ...base, langue: "pt" }))).toContain("5 de novembro de 2026");
    expect(texteDe(rentDueReminderEmail({ ...base, langue: "fr" }))).toContain("5 novembre 2026");
  });

  it("le mois de la période est traduit", () => {
    expect(rentDueReminderEmail({ ...base, langue: "fr" }).subject).toContain("novembre 2026");
    expect(rentDueReminderEmail({ ...base, langue: "en" }).subject).toContain("November 2026");
    expect(rentDueReminderEmail({ ...base, langue: "es" }).subject).toContain("noviembre 2026");
    expect(rentDueReminderEmail({ ...base, langue: "pt" }).subject).toContain("novembro 2026");
  });

  it("le lien de paiement est conservé", () => {
    for (const l of LANGUES) expect(rentDueReminderEmail({ ...base, langue: l }).html).toContain("https://app.exemple.test/portail/paiements");
  });
});

describe("rappel avant échéance — pluriel", () => {
  const corps = (langue: Langue, daysLeft: number) => texteDe(rentDueSoonReminderEmail({ ...base, daysLeft, langue }));

  it("un jour au singulier, plusieurs au pluriel", () => {
    expect(corps("fr", 1)).toContain("dans 1 jour)");
    expect(corps("fr", 3)).toContain("dans 3 jours)");
    expect(corps("en", 1)).toContain("in 1 day)");
    expect(corps("en", 3)).toContain("in 3 days)");
    expect(corps("es", 1)).toContain("dentro de 1 día)");
    expect(corps("es", 3)).toContain("dentro de 3 días)");
    expect(corps("pt", 1)).toContain("em 1 dia)");
    expect(corps("pt", 3)).toContain("em 3 dias)");
  });
});

describe("relances d'impayé", () => {
  it("la dernière relance garde son bandeau rouge, et le niveau change le ton", () => {
    for (const l of LANGUES) {
      const n1 = overdueReminderEmail({ ...base, daysLate: 7, niveau: 1, agencyName: "A", langue: l });
      const n3 = overdueReminderEmail({ ...base, daysLate: 27, niveau: 3, agencyName: "A", langue: l });
      expect(n3.html).toContain("#7f1d1d");
      expect(n1.html).not.toContain("#7f1d1d");
      expect(n1.subject).not.toBe(n3.subject);
    }
  });

  it("le retard et la période figurent dans le message", () => {
    for (const l of LANGUES) {
      const { subject, html } = overdueReminderEmail({ ...base, daysLate: 17, niveau: 2, agencyName: "A", langue: l });
      expect(html).toContain("17");
      expect(subject).toContain("2026");
    }
  });
});

describe("quittance et reçu — le PDF reste en français", () => {
  it("le message le dit dans les langues autres que le français", () => {
    expect(texteDe(paymentReceiptEmail({ ...base, langue: "en" }))).toContain("issued in French");
    expect(texteDe(paymentReceiptEmail({ ...base, langue: "es" }))).toContain("en francés");
    expect(texteDe(paymentReceiptEmail({ ...base, langue: "pt" }))).toContain("em francês");
    expect(texteDe(paymentReceiptEmail({ ...base, langue: "fr" }))).not.toMatch(/émis en français/);
  });

  it("le reçu partiel nomme le moyen de paiement dans la langue", () => {
    const recu = (l: Langue) =>
      texteDe(partialPaymentReceiptEmail({ ...base, paymentAmount: 10000, paymentDate: ECHEANCE, paymentMethod: "BANK_TRANSFER", rent: 35000, alreadyPaid: 10000, remaining: 25000, agencyName: null, langue: l }));
    expect(recu("fr")).toContain("Virement bancaire");
    expect(recu("en")).toContain("Bank transfer");
    expect(recu("es")).toContain("Transferencia bancaria");
    expect(recu("pt")).toContain("Transferência bancária");
  });

  it("le reçu partiel affiche le reste à payer avec le montant de la langue", () => {
    const html = partialPaymentReceiptEmail({ ...base, paymentAmount: 10000, paymentDate: ECHEANCE, paymentMethod: null, rent: 35000, alreadyPaid: 10000, remaining: 25000, agencyName: null, langue: "en" }).html;
    expect(html).toContain("25,000 FCFA");
  });
});

describe("libelleMoyenPaiement", () => {
  it("français par défaut, comme avant", () => {
    expect(libelleMoyenPaiement("CASH")).toBe("Espèces");
    expect(libelleMoyenPaiement(null)).toBe("Non précisé");
    expect(libelleMoyenPaiement("CASH", "fr")).toBe("Espèces");
  });

  it("traduit chaque moyen connu dans chaque langue", () => {
    const moyens = ["BANK_TRANSFER", "STRIPE", "PAYDUNYA", "DEMO", "CASH", "CHEQUE", "MOBILE_MONEY"];
    for (const l of AUTRES) {
      const libelles = moyens.map((m) => libelleMoyenPaiement(m, l));
      expect(libelles.every((x) => x.length > 2 && !/_/.test(x))).toBe(true);
      // « Mobile Money » est un nom propre : il s'écrit pareil partout. Tous les autres changent.
      for (const [i, m] of moyens.entries()) {
        if (m !== "MOBILE_MONEY" && m !== "CHEQUE") expect(libelles[i]).not.toBe(libelleMoyenPaiement(m, "fr"));
      }
    }
    expect(libelleMoyenPaiement("CASH", "en")).toBe("Cash");
    expect(libelleMoyenPaiement("CASH", "es")).toBe("Efectivo");
    expect(libelleMoyenPaiement("CASH", "pt")).toBe("Dinheiro");
    expect(libelleMoyenPaiement(null, "en")).toBe("Not specified");
  });

  it("une valeur inconnue s'affiche telle quelle, dans toutes les langues", () => {
    for (const l of LANGUES) expect(libelleMoyenPaiement("CRYPTO", l)).toBe("CRYPTO");
  });
});
