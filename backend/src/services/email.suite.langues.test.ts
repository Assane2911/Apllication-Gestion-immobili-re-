import { describe, expect, it } from "vitest";
import { formaterDateHeure } from "../utils/langue";
import type { Langue } from "../utils/langue";
import {
  contractEndingReminderEmail,
  guarantorUnpaidNoticeEmail,
  insurancePolicyExpiryReminderEmail,
  issueStatusUpdateEmail,
  newMessageFromManagerEmail,
  ownerPayoutEmail,
  referralRewardEmail,
  rentRevisionEmail,
} from "./email.service";
import { motifRevision } from "./rentRevision.service";

/**
 * Lot 2B de l'internationalisation des e-mails : statut d'un signalement, nouveau message, révision de loyer (au
 * locataire), avis d'impayé au garant, reversement (au propriétaire), fin de contrat, échéance d'assurance et
 * récompense de parrainage (au gestionnaire). Le français reste le texte par défaut, inchangé.
 */
const LANGUES: Langue[] = ["fr", "en", "es", "pt"];
const AUTRES: Array<"en" | "es" | "pt"> = ["en", "es", "pt"];

/** Mots qui trahissent un reste de français dans une autre langue (la marque exceptée). */
const MOTS_FRANCAIS =
  /\b(Bonjour|vous|votre|Votre|vos|loyer|loyers|locataire|logement|[ée]ch[ée]ance|impayé|retard|agence|Rappel|Merci|Pensez|contacter|Continuez|parrainage|filleul|assureur|assurance|reversement|Reversement|garant|Ouvert|Résolu|Rejeté|propriétaire|bail|Répondre|Voir)\b/;
const texteDe = (m: { subject: string; html: string }) => (m.subject + " " + m.html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");

const D = new Date(Date.UTC(2026, 10, 5, 9, 30));
const modeles: Array<{ nom: string; fabrique: (l?: Langue) => { subject: string; html: string } }> = [
  {
    nom: "statut d'un signalement",
    fabrique: (langue) =>
      issueStatusUpdateEmail({ tenantName: "Awa <b>Sow</b>", issueTitle: "Fuite <i>cuisine</i>", propertyTitle: "Studio <u>A</u>", status: "IN_PROGRESS", managerNote: "On passe demain <b>!</b>", scheduledAt: D, frontendUrl: "https://app.test", langue }),
  },
  { nom: "nouveau message", fabrique: (langue) => newMessageFromManagerEmail({ tenantName: "Awa <b>Sow</b>", propertyTitle: "Studio <u>A</u>", content: "Bonsoir <b>!</b>", frontendUrl: "https://app.test", langue }) },
  {
    nom: "révision de loyer",
    fabrique: (langue) =>
      rentRevisionEmail({ tenantName: "Awa <b>Sow</b>", propertyTitle: "Studio <u>A</u>", previousRent: 500, newRent: 515, currency: "EUR", effectiveDate: D, motif: "+3 %", note: "Indexation <b>annuelle</b>", langue }),
  },
  {
    nom: "avis d'impayé au garant",
    fabrique: (langue) =>
      guarantorUnpaidNoticeEmail({ guarantorName: "Moussa <b>Fall</b>", maxAmount: 1500, tenantName: "Awa <b>Sow</b>", propertyTitle: "Studio <u>A</u>", amount: 500, currency: "EUR", periodMonth: 10, periodYear: 2026, agencyName: "Agence <i>T</i>", langue }),
  },
  {
    nom: "reversement",
    fabrique: (langue) =>
      ownerPayoutEmail({ ownerName: "Marta <b>Neto</b>", agencyName: "Agence <i>T</i>", amount: 450, currency: "EUR", periodMonth: 10, periodYear: 2026, paidAt: D, methodLabel: "virement", reference: "REF-<b>1</b>", langue }),
  },
  { nom: "fin de contrat", fabrique: (langue) => contractEndingReminderEmail({ tenantName: "Awa <b>Sow</b>", propertyTitle: "Studio <u>A</u>", endDate: D, daysLeft: 14, langue }) },
  { nom: "échéance d'assurance", fabrique: (langue) => insurancePolicyExpiryReminderEmail({ propertyTitle: "Studio <u>A</u>", insurerName: "AXA <b>X</b>", policyNumber: "POL-<b>1</b>", expiryDate: D, daysLeft: 30, langue }) },
  { nom: "récompense de parrainage", fabrique: (langue) => referralRewardEmail({ days: 30, newEndDate: D, frontendUrl: "https://app.test", langue }) },
];

describe.each(modeles)("e-mail « $nom »", ({ fabrique }) => {
  it("sans langue, reste en français et identique à fr", () => {
    expect(texteDe(fabrique())).toMatch(/Bonjour|Rappel|Reversement|Merci|Révision|Mise à jour|Nouveau message/);
    expect(fabrique("fr")).toEqual(fabrique());
  });

  it.each(AUTRES)("en %s : texte traduit, sans reste de français", (langue) => {
    expect(texteDe(fabrique(langue))).not.toMatch(MOTS_FRANCAIS);
  });

  it("chaque langue donne un sujet et un corps différents des autres", () => {
    expect(new Set(LANGUES.map((l) => fabrique(l).subject)).size).toBe(4);
    expect(new Set(LANGUES.map((l) => fabrique(l).html)).size).toBe(4);
  });

  it("les valeurs saisies sont échappées dans toutes les langues", () => {
    for (const l of LANGUES) {
      const { html } = fabrique(l);
      for (const brut of ["<b>Sow</b>", "<i>cuisine</i>", "<u>A</u>", "<b>Fall</b>", "<b>Neto</b>", "<i>T</i>", "<b>X</b>", "<b>1</b>", "<b>!</b>", "<b>annuelle</b>"]) {
        expect(html).not.toContain(brut);
      }
    }
  });

  it("un sujet ne contient jamais de retour à la ligne", () => {
    for (const l of LANGUES) expect(fabrique(l).subject).not.toMatch(/[\r\n]/);
  });
});

describe("statut d'un signalement", () => {
  const statut = (langue: Langue, status: string) => texteDe(issueStatusUpdateEmail({ tenantName: "A", issueTitle: "T", propertyTitle: "P", status, frontendUrl: "https://x", langue }));

  it("chaque statut est traduit, un statut inconnu s'affiche tel quel", () => {
    expect(statut("fr", "OPEN")).toContain("Ouvert");
    expect(statut("en", "OPEN")).toContain("Open");
    expect(statut("es", "RESOLVED")).toContain("Resuelto");
    expect(statut("pt", "REJECTED")).toContain("Rejeitado");
    expect(statut("en", "EN_ATTENTE_X")).toContain("EN_ATTENTE_X");
  });

  it("l'intervention prévue s'écrit date et heure dans la langue", () => {
    const rdv = (l: Langue) => texteDe(issueStatusUpdateEmail({ tenantName: "A", issueTitle: "T", propertyTitle: "P", status: "OPEN", scheduledAt: D, frontendUrl: "https://x", langue: l }));
    expect(rdv("fr")).toContain("5 novembre 2026");
    expect(rdv("en")).toContain("November 5, 2026");
    expect(rdv("es")).toContain("5 de noviembre de 2026");
    expect(rdv("pt")).toContain("5 de novembro de 2026");
  });

  it("formaterDateHeure : le français est celui d'avant (toLocaleString fr-FR, UTC)", () => {
    expect(formaterDateHeure(D, "fr")).toBe(D.toLocaleString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }));
  });

  it("sans note ni rendez-vous, rien n'est affiché en plus", () => {
    const html = issueStatusUpdateEmail({ tenantName: "A", issueTitle: "T", propertyTitle: "P", status: "OPEN", frontendUrl: "https://x", langue: "en" }).html;
    expect(html).not.toContain("Message from your agency");
    expect(html).not.toContain("Intervention scheduled");
  });
});

describe("nouveau message — guillemets de l'extrait", () => {
  const extrait = (l: Langue) => newMessageFromManagerEmail({ tenantName: "A", propertyTitle: "P", content: "Bonsoir", frontendUrl: "https://x", langue: l }).html;

  it("chaque langue a les siens", () => {
    expect(extrait("fr")).toContain("« Bonsoir »");
    expect(extrait("en")).toContain("“Bonsoir”");
    expect(extrait("es")).toContain("«Bonsoir»");
  });

  it("un message long est tronqué à 220 caractères", () => {
    const html = newMessageFromManagerEmail({ tenantName: "A", propertyTitle: "P", content: "x".repeat(300), frontendUrl: "https://x", langue: "en" }).html;
    expect(html).toContain("x".repeat(220) + "…");
    expect(html).not.toContain("x".repeat(221));
  });
});

describe("motif d'une révision de loyer", () => {
  const pourcent = { method: "PERCENT", percent: 3.5, indexName: null, indexOld: null, indexNew: null } as const;
  const indice = { method: "INDEX", percent: null, indexName: "IRL", indexOld: 142.06, indexNew: 145.47 } as const;
  const indiceSansNom = { ...indice, indexName: null } as const;

  it("le français est celui d'avant", () => {
    expect(motifRevision(pourcent)).toBe("+3,5 %");
    expect(motifRevision(indice)).toBe("IRL : 142,06 → 145,47");
    expect(motifRevision(indiceSansNom)).toBe("indice : 142,06 → 145,47");
    expect(motifRevision({ ...pourcent, percent: -2 })).toBe("-2 %");
    expect(motifRevision({ method: "AMOUNT", percent: null, indexName: null, indexOld: null, indexNew: null })).toBeNull();
  });

  it("les autres langues écrivent le séparateur décimal et le mot « indice » à leur façon", () => {
    expect(motifRevision(pourcent, "en")).toBe("+3.5%");
    expect(motifRevision(indice, "en")).toBe("IRL: 142.06 → 145.47");
    expect(motifRevision(indiceSansNom, "en")).toBe("index: 142.06 → 145.47");
    expect(motifRevision(pourcent, "es")).toBe("+3,5 %");
    expect(motifRevision(indiceSansNom, "es")).toBe("índice: 142,06 → 145,47");
    expect(motifRevision(pourcent, "pt")).toBe("+3,5%");
    expect(motifRevision(indiceSansNom, "pt")).toBe("índice: 142,06 → 145,47");
  });
});

describe("garant — avis d'impayé", () => {
  const avis = (l: Langue, maxAmount: number | null) =>
    guarantorUnpaidNoticeEmail({ guarantorName: "G", maxAmount, tenantName: "Awa Sow", propertyTitle: "P", amount: 35000, currency: "XOF", periodMonth: 11, periodYear: 2026, agencyName: "Agence T", langue: l });

  it("le montant et la période sont écrits dans la langue", () => {
    expect(texteDe(avis("fr", null))).toContain("novembre 2026");
    expect(texteDe(avis("en", null))).toContain("November 2026");
    expect(texteDe(avis("en", null))).toContain("35,000 FCFA");
    expect(texteDe(avis("es", null))).toContain("noviembre 2026");
  });

  it("le plafond de l'engagement n'apparaît que s'il existe, dans la langue", () => {
    expect(avis("fr", null).html).not.toContain("montant maximal");
    expect(texteDe(avis("fr", 1500))).toContain("montant maximal que vous avez garanti");
    expect(texteDe(avis("en", 1500))).toContain("maximum amount you have guaranteed");
    expect(texteDe(avis("es", 1500))).toContain("importe máximo que usted ha avalado");
    expect(texteDe(avis("pt", 1500))).toContain("valor máximo que você garantiu");
  });
});

describe("reversement", () => {
  it("la date, la période et le montant sont écrits dans la langue du propriétaire", () => {
    const m = (l: Langue) => texteDe(ownerPayoutEmail({ ownerName: "M", agencyName: "A", amount: 1450, currency: "EUR", periodMonth: 10, periodYear: 2026, paidAt: D, methodLabel: "x", langue: l }));
    expect(m("fr")).toContain("octobre 2026");
    expect(m("en")).toContain("October 2026");
    expect(m("en")).toContain("November 5, 2026");
    expect(m("en")).toContain("1,450 €");
    expect(m("es")).toContain("octubre 2026");
    expect(m("pt")).toContain("outubro 2026");
  });

  it("sans référence, la ligne n'apparaît pas", () => {
    expect(ownerPayoutEmail({ ownerName: "M", agencyName: "A", amount: 1, currency: "EUR", periodMonth: 1, periodYear: 2026, paidAt: D, methodLabel: "x", langue: "en" }).html).not.toContain("Reference:");
  });
});
