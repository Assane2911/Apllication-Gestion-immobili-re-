import PDFDocument from "pdfkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serialiserMentions } from "../utils/mentionsLogement";
import {
  type CrgExportData,
  type FormalNoticeData,
  generateCrgHtml,
  generateFormalNoticeHtml,
  generateFormalNoticePdfBuffer,
  generateInspectionHtml,
  generateLeaseHtml,
  generateReceiptHtml,
  generateReceiptPdfBuffer,
  generateRentRevisionHtml,
  generateSettlementHtml,
  generateSettlementPdfBuffer,
  type InspectionExportData,
  type LeaseExportData,
  type ReceiptData,
  type RentRevisionExportData,
  type SettlementData,
} from "./pdf.service";

/**
 * Audit par sabotage de pdf.service.ts : ce que les tests existants ne verrouillaient pas.
 *
 * Les tests existants cherchent une valeur dans le document (`toContain("Aminata Ba")`) : une valeur écrite à deux endroits
 * (le nom du locataire sur la quittance, la référence de la mise en demeure, le titre du bien) reste « trouvée » quand l'un des deux
 * emplacements est vidé, et un libellé fixe (« Observations », « Reste dû ») n'est cherché nulle part. Ici, chaque document est
 * comparé en entier : le TEXTE VISIBLE du HTML (balises et styles retirés) et la liste exacte des textes écrits dans le PDF, avec
 * des valeurs différentes d'un champ à l'autre pour que la place de chacune soit vérifiée. Un champ optionnel absent ne doit laisser
 * ni ligne vide ni « undefined », un champ présent doit apparaître à sa place.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Texte lu par la personne qui ouvre le document : sans styles, sans balises ; espaces (même insécables) réduits à un. */
function visible(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\s  ]+/g, " ")
    .trim();
}

/** Tous les textes que le document PDF écrit, dans l'ordre (les espaces insécables réduits à des espaces). */
function textesEcrits() {
  const espion = vi.spyOn(PDFDocument.prototype, "text");
  return () => espion.mock.calls.map((appel) => (typeof appel[0] === "string" ? appel[0].replace(/[  ]/g, " ") : appel[0]));
}

const URL_STOCKAGE = "https://placeholder.supabase.co/storage/v1/object/public/public-uploads/agency";

/* ───────────────────────────── Quittance ───────────────────────────── */

const quittanceComplete: ReceiptData = {
  receiptNumber: "QUITT-2026-06-A1B2C3",
  agency: {
    name: "Agence Teranga",
    address: "12 Corniche Ouest, Dakar",
    phone: "+221 33 000 00 00",
    email: "contact@teranga.test",
    siretOrId: "NIF-123456",
    legalNotice: "Agence agréée n° 42",
  },
  tenant: { fullName: "Aminata Ba", email: "aminata.ba@test.local", phone: "+221 77 000 00 00" },
  property: { title: "Villa Ngor", address: "3 rue des Almadies", surface: 120 },
  invoice: { periodMonth: 6, periodYear: 2026, amount: 250000, currency: "XOF", paidAt: new Date(2026, 5, 3), paymentMethod: "PAYDUNYA", paymentRef: "PD-987654" },
};
const quittanceMinimale: ReceiptData = { ...quittanceComplete, agency: { name: "Agence Minimale" }, invoice: { ...quittanceComplete.invoice, paymentMethod: null } };

describe("quittance HTML : chaque champ à sa place", () => {
  it("complète : le titre, l'en-tête de l'agence, le locataire, le logement, l'attestation, le tableau et le pied", () => {
    expect(visible(generateReceiptHtml(quittanceComplete))).toMatchInlineSnapshot(`"Quittance de Loyer - N° QUITT-2026-06-A1B2C3 Agence Teranga 12 Corniche Ouest, Dakar Tél : +221 33 000 00 00 Email : contact@teranga.test Identifiants légaux : NIF-123456 QUITTANCE DE LOYER RÉF : QUITT-2026-06-A1B2C3 Période : Juin 2026 Locataire Aminata Ba aminata.ba@test.local +221 77 000 00 00 Logement Loué Villa Ngor 3 rue des Almadies Surface : 120 m² Je soussigné, gestionnaire pour le compte du bailleur, certifie avoir reçu de Aminata Ba la somme de 250 000 FCFA au titre du paiement du loyer et des charges pour la période du mois de Juin 2026 , et lui en donne quittance sous réserve de tous droits. Désignation Période Moyen de paiement Montant Loyer mensuel & charges locatives Juin 2026 Mobile Money / carte (en ligne) 250 000 FCFA TOTAL REÇU : 250 000 FCFA Fait le 3 juin 2026 Règlement validé et enregistré électroniquement. ✅ QUITTANCE VALIDÉE LE 3 juin 2026 Agence agréée n° 42 Cette quittance annule tous les reçus qui auraient pu être donnés pour acompte versé sur le présent terme."`);
  });

  it("minimale : seul le nom de l'agence, la mention par défaut au pied, « Non précisé » comme moyen de paiement", () => {
    expect(visible(generateReceiptHtml(quittanceMinimale))).toMatchInlineSnapshot(`"Quittance de Loyer - N° QUITT-2026-06-A1B2C3 Agence Minimale QUITTANCE DE LOYER RÉF : QUITT-2026-06-A1B2C3 Période : Juin 2026 Locataire Aminata Ba aminata.ba@test.local +221 77 000 00 00 Logement Loué Villa Ngor 3 rue des Almadies Surface : 120 m² Je soussigné, gestionnaire pour le compte du bailleur, certifie avoir reçu de Aminata Ba la somme de 250 000 FCFA au titre du paiement du loyer et des charges pour la période du mois de Juin 2026 , et lui en donne quittance sous réserve de tous droits. Désignation Période Moyen de paiement Montant Loyer mensuel & charges locatives Juin 2026 Non précisé 250 000 FCFA TOTAL REÇU : 250 000 FCFA Fait le 3 juin 2026 Règlement validé et enregistré électroniquement. ✅ QUITTANCE VALIDÉE LE 3 juin 2026 Document émis par le système de gestion locative immobilière. Cette quittance annule tous les reçus qui auraient pu être donnés pour acompte versé sur le présent terme."`);
  });

  it("une période partielle écrit le mois puis les jours couverts, partout où la période figure", () => {
    const html = visible(generateReceiptHtml({ ...quittanceComplete, invoice: { ...quittanceComplete.invoice, periodStartDay: 5, periodEndDay: 20 } }));

    expect(html).toContain("Période : Juin 2026 (du 5 au 20) Locataire");
    expect(html).toContain("pour la période du mois de Juin 2026 (du 5 au 20) , et lui en donne quittance");
    expect(html).toContain("Loyer mensuel & charges locatives Juin 2026 (du 5 au 20) Mobile Money");
  });

  it("sans adresse, téléphone, email ni identifiants, l'en-tête ne contient aucun paragraphe vide", () => {
    const html = generateReceiptHtml(quittanceMinimale);

    expect(html).toMatch(/<div class="agency-info">\s*<\/div>/);
    expect(html).not.toContain('<p style="margin:2px 0;">');
  });

  it("le nom de l'agence est le titre de l'en-tête, et le logo comme le tampon portent un texte alternatif à son nom", () => {
    const html = generateReceiptHtml({ ...quittanceComplete, agency: { ...quittanceComplete.agency, logoUrl: `${URL_STOCKAGE}/logo.png`, stampUrl: `${URL_STOCKAGE}/tampon.png` } });

    expect(html).toContain('<h1 class="agency-title">Agence Teranga</h1>');
    expect(html).toContain(`<img class="agency-logo" src="${URL_STOCKAGE}/logo.png" alt="Logo Agence Teranga" />`);
    expect(html).toContain(`<img class="agency-stamp" src="${URL_STOCKAGE}/tampon.png" alt="Tampon Agence Teranga" />`);
  });
});

describe("quittance PDF : chaque texte écrit, dans l'ordre", () => {
  it("complète", async () => {
    const ecrits = textesEcrits();

    await generateReceiptPdfBuffer(quittanceComplete);

    expect(ecrits()).toMatchInlineSnapshot(`
      [
        "Agence Teranga",
        "12 Corniche Ouest, Dakar",
        "Tél : +221 33 000 00 00",
        "Email : contact@teranga.test",
        "Identifiants légaux : NIF-123456",
        "QUITTANCE DE LOYER",
        "Réf : QUITT-2026-06-A1B2C3",
        "Période : Juin 2026",
        "LOCATAIRE",
        "Aminata Ba",
        "aminata.ba@test.local",
        "+221 77 000 00 00",
        "LOGEMENT LOUÉ",
        "Villa Ngor",
        "3 rue des Almadies",
        "Surface : 120 m²",
        "Je soussigné, gestionnaire pour le compte du bailleur, certifie avoir reçu de Aminata Ba la somme de 250 000 FCFA au titre du paiement du loyer et des charges pour la période de Juin 2026, et lui en donne quittance sous réserve de tous droits.",
        "Désignation",
        "Période",
        "Moyen de paiement",
        "Montant",
        "Loyer mensuel & charges locatives",
        "Juin 2026",
        "Mobile Money / carte (en ligne)",
        "250 000 FCFA",
        "TOTAL REÇU :",
        "250 000 FCFA",
        "Fait le 3 juin 2026",
        "Règlement validé et enregistré électroniquement.",
        "QUITTANCE VALIDÉE",
        "LE 3 juin 2026",
        "Agence agréée n° 42",
        "Cette quittance annule tous les reçus qui auraient pu être donnés pour acompte versé sur le présent terme.",
      ]
    `);
  });

  it("minimale : aucune ligne vide pour une adresse, un téléphone, un email ou des identifiants absents", async () => {
    const ecrits = textesEcrits();

    await generateReceiptPdfBuffer(quittanceMinimale);

    expect(ecrits()).toMatchInlineSnapshot(`
      [
        "Agence Minimale",
        "QUITTANCE DE LOYER",
        "Réf : QUITT-2026-06-A1B2C3",
        "Période : Juin 2026",
        "LOCATAIRE",
        "Aminata Ba",
        "aminata.ba@test.local",
        "+221 77 000 00 00",
        "LOGEMENT LOUÉ",
        "Villa Ngor",
        "3 rue des Almadies",
        "Surface : 120 m²",
        "Je soussigné, gestionnaire pour le compte du bailleur, certifie avoir reçu de Aminata Ba la somme de 250 000 FCFA au titre du paiement du loyer et des charges pour la période de Juin 2026, et lui en donne quittance sous réserve de tous droits.",
        "Désignation",
        "Période",
        "Moyen de paiement",
        "Montant",
        "Loyer mensuel & charges locatives",
        "Juin 2026",
        "Non précisé",
        "250 000 FCFA",
        "TOTAL REÇU :",
        "250 000 FCFA",
        "Fait le 3 juin 2026",
        "Règlement validé et enregistré électroniquement.",
        "QUITTANCE VALIDÉE",
        "LE 3 juin 2026",
        "Document émis par le système de gestion locative immobilière.",
        "Cette quittance annule tous les reçus qui auraient pu être donnés pour acompte versé sur le présent terme.",
      ]
    `);
  });

  it("une période partielle est écrite avec les jours couverts, dans l'en-tête et dans le tableau", async () => {
    const ecrits = textesEcrits();

    await generateReceiptPdfBuffer({ ...quittanceComplete, invoice: { ...quittanceComplete.invoice, periodStartDay: 5, periodEndDay: 20 } });

    expect(ecrits().filter((t) => typeof t === "string" && t.includes("Juin 2026"))).toEqual([
      "Période : Juin 2026 (du 5 au 20)",
      expect.stringContaining("pour la période de Juin 2026 (du 5 au 20), et lui en donne quittance"),
      "Juin 2026 (du 5 au 20)",
    ]);
  });

  it("sans logo ni tampon, aucune image n'est tentée (le journal d'erreurs reste vide)", async () => {
    const erreurs = vi.spyOn(console, "error").mockImplementation(() => {});

    await generateReceiptPdfBuffer(quittanceMinimale);
    await generateReceiptPdfBuffer(quittanceComplete);

    expect(erreurs).not.toHaveBeenCalled();
  });
});

/* ───────────────────────────── Bail ───────────────────────────── */

const agenceBail = { agencyName: "Agence Teranga", address: "12 Corniche Ouest, Dakar", siretOrId: " NINEA 0001234 " };

const bailMinimal: LeaseExportData = {
  startDate: "2026-03-01T12:00:00.000Z",
  endDate: "2028-02-28T12:00:00.000Z",
  rent: 250000,
  currency: "XOF",
  deposit: 500000,
  signedByManagerAt: null,
  managerSignatureUrl: null,
  signedByTenantAt: null,
  tenantSignatureUrl: null,
  property: { title: "Villa Ngor", address: "3 rue des Almadies", surface: 120 },
  tenant: { firstName: "Aminata", lastName: "Ba", email: "aminata.ba@test.local", phone: "+221 77 000 00 00" },
};

const bailComplet: LeaseExportData = {
  ...bailMinimal,
  rent: 320000,
  leaseType: "COMMERCIAL",
  paymentDay: 5,
  agencyFee: 150000,
  applicableLaw: " Droit sénégalais (COCC) ",
  terms: "Pas d'animaux.\nSous-location interdite <sans accord>.",
  housingMentions: serialiserMentions({ dpe: "C", identifiantFiscal: "IF-77", periodeConstruction: "Avant 1949", chauffage: "Gaz collectif", loyerReference: 20, loyerReferenceMajore: 24, dernierLoyer: 280000 }),
  cotenants: [{ civility: "MME", firstName: "Fatou", lastName: "Sow", email: "fatou.sow@test.local", phone: "+221 70 000 00 01" }],
  guarantors: [
    { civility: "M", firstName: "Omar", lastName: "Ndiaye", phone: "+221 70 000 00 02", email: "omar@test.local", address: "5 rue Blanchot", maxAmount: 1000000 },
    { civility: null, firstName: "Awa", lastName: "Fall", phone: "+221 70 000 00 03", email: null, address: null, maxAmount: null },
  ],
  revisions: [
    { effectiveDate: "2027-03-01T00:00:00.000Z", previousRent: 250000, newRent: 300000 },
    { effectiveDate: "2028-01-01T00:00:00.000Z", previousRent: 300000, newRent: 320000 },
  ],
  signedByManagerAt: "2026-03-02T12:00:00.000Z",
  managerSignatureUrl: "https://sig.test/gestionnaire.png",
  signedByTenantAt: "2026-03-03T12:00:00.000Z",
  tenantSignatureUrl: "https://sig.test/locataire.png",
};

describe("bail HTML : chaque champ à sa place", () => {
  it("minimal : parties, bien, durée et loyer, deux cadres « En attente de signature », ni clauses ni droit applicable", () => {
    expect(visible(generateLeaseHtml(bailMinimal, { agencyName: null }))).toMatchInlineSnapshot(`"Contrat de Bail - Villa Ngor CONTRAT DE BAIL D'HABITATION 1. Les Parties Le Bailleur / Mandataire : L'Agence Le Locataire : Aminata Ba (Email : aminata.ba@test.local, Tél : +221 77 000 00 00) 2. Objet du Contrat & Désignation des Lieux Bien loué : Villa Ngor Adresse : 3 rue des Almadies Surface habitable : 120 m² 3. Durée & Conditions Financières Date de prise d'effet : 01/03/2026 | Date de fin : 28/02/2028 Loyer mensuel : 250 000 FCFA (payable mensuellement au plus tard le 1er de chaque mois) Dépôt de garantie : 500 000 FCFA Pour le Bailleur / Gestionnaire : En attente de signature Le Locataire : En attente de signature"`);
  });

  it("complet : droit, parties, colocataire et garants, mentions du logement, loyer révisé, frais, clauses, signatures", () => {
    expect(visible(generateLeaseHtml(bailComplet, agenceBail))).toMatchInlineSnapshot(`"Contrat de Bail - Villa Ngor CONTRAT DE BAIL COMMERCIAL Droit applicable : Droit sénégalais (COCC) 1. Les Parties Le Bailleur / Mandataire : Agence Teranga (12 Corniche Ouest, Dakar) Identifiants légaux : NINEA 0001234 Le Locataire : Aminata Ba (Email : aminata.ba@test.local, Tél : +221 77 000 00 00) Colocataire : Madame Fatou Sow (Email : fatou.sow@test.local, Tél : +221 70 000 00 01) Garant : Monsieur Omar Ndiaye (5 rue Blanchot) — +221 70 000 00 02, omar@test.local — Montant maximal garanti : 1 000 000 FCFA Garant : Awa Fall — +221 70 000 00 03 — Montant maximal garanti : non précisé 2. Objet du Contrat & Désignation des Lieux Bien loué : Villa Ngor Adresse : 3 rue des Almadies Surface : 120 m² Classe du diagnostic de performance énergétique (DPE) : C Identifiant fiscal du logement : IF-77 Période de construction : Avant 1949 Chauffage et eau chaude : Gaz collectif Loyer de référence (par m²) : 20 FCFA Loyer de référence majoré (par m²) : 24 FCFA Montant du dernier loyer acquitté par le précédent locataire : 280 000 FCFA 3. Durée & Conditions Financières Date de prise d'effet : 01/03/2026 | Date de fin : 28/02/2028 Loyer mensuel à la signature : 250 000 FCFA (payable mensuellement au plus tard le 5 de chaque mois) Révision à compter du 01/03/2027 : 300 000 FCFA (au lieu de 250 000 FCFA) Révision à compter du 01/01/2028 : 320 000 FCFA (au lieu de 300 000 FCFA) Loyer mensuel en vigueur : 320 000 FCFA Dépôt de garantie : 500 000 FCFA Frais d'agence à la charge du locataire : 150 000 FCFA 4. Clauses particulières Pas d&#39;animaux. Sous-location interdite &lt;sans accord&gt;. Pour le Bailleur / Gestionnaire : Signé électroniquement le 02/03/2026 Le Locataire : Signé électroniquement le 03/03/2026 Le Colocataire : Madame Fatou Sow Signature précédée de « lu et approuvé » Le Garant : Monsieur Omar Ndiaye Signature précédée de « lu et approuvé » Le Garant : Awa Fall Signature précédée de « lu et approuvé »"`);
  });

  it("les signatures électroniques sont des images dont le texte alternatif nomme le signataire", () => {
    const html = generateLeaseHtml(bailComplet, agenceBail);

    expect(html).toContain('<img src="https://sig.test/gestionnaire.png" class="sig-img" alt="Signature Gestionnaire" />');
    expect(html).toContain('<img src="https://sig.test/locataire.png" class="sig-img" alt="Signature Locataire" />');
  });

  it("le titre de la page est celui du bien", () => {
    expect(generateLeaseHtml(bailMinimal, agenceBail)).toContain("<title>Contrat de Bail - Villa Ngor</title>");
  });
});

/* ───────────────────────────── État des lieux ───────────────────────────── */

const etatMinimal: InspectionExportData = {
  reference: "EDL-2026-0001",
  type: "ENTRY",
  inspectionDate: "2026-03-01T12:00:00.000Z",
  agencyName: "Agence Teranga",
  property: { title: "Villa Ngor", address: "3 rue des Almadies" },
  tenant: { fullName: "Aminata Ba" },
  rooms: [],
  meters: { electricity: "", water: "", gas: "" },
  keys: [],
  generalComments: null,
  managerSignatureUrl: null,
  signedByManagerAt: null,
  tenantSignatureUrl: null,
  signedByTenantAt: null,
};

const etatComplet: InspectionExportData = {
  ...etatMinimal,
  type: "EXIT",
  rooms: [
    { name: "Salon", condition: "BON", notes: "Propre" },
    { name: "Cuisine", condition: "MOYEN", notes: "Évier taché\nrobinet qui goutte" },
    { name: "Chambre", condition: "MAUVAIS", notes: "" },
  ],
  meters: { electricity: "12345", water: "678", gas: "90" },
  keys: [
    { label: "Clé d'entrée", quantity: 2 },
    { label: "Badge", quantity: 1 },
  ],
  generalComments: "RAS.\nÀ revoir <dans un mois>.",
  managerSignatureUrl: "https://sig.test/gestionnaire.png",
  signedByManagerAt: "2026-03-02T12:00:00.000Z",
  tenantSignatureUrl: "https://sig.test/locataire.png",
  signedByTenantAt: "2026-03-03T12:00:00.000Z",
};

describe("état des lieux HTML : chaque champ à sa place", () => {
  it("minimal : sans pièce, sans clé, sans compteur ni observation, en attente de signatures", () => {
    expect(visible(generateInspectionHtml(etatMinimal))).toMatchInlineSnapshot(`"État des Lieux ENTRÉE - Villa Ngor ÉTAT DES LIEUX Constat contradictoire établi entre le bailleur (ou son mandataire) et le locataire ENTRÉE 1. Les Parties & le Bien Agence / Mandataire : Agence Teranga Locataire : Aminata Ba Bien : Villa Ngor — 3 rue des Almadies Date du constat : 1 mars 2026 Référence : EDL-2026-0001 2. Relevé des Compteurs Électricité — Eau — Gaz — 3. Constat Pièce par Pièce Pièce État Observations Aucune pièce renseignée 4. Clés & Accès Remis Aucune clé renseignée Pour le Bailleur / Gestionnaire : En attente de signature Le Locataire : En attente de signature"`);
  });

  it("complet de sortie : pièces, compteurs, clés, observations et les deux signatures", () => {
    expect(visible(generateInspectionHtml(etatComplet))).toMatchInlineSnapshot(`"État des Lieux SORTIE - Villa Ngor ÉTAT DES LIEUX Constat contradictoire établi entre le bailleur (ou son mandataire) et le locataire SORTIE 1. Les Parties & le Bien Agence / Mandataire : Agence Teranga Locataire : Aminata Ba Bien : Villa Ngor — 3 rue des Almadies Date du constat : 1 mars 2026 Référence : EDL-2026-0001 2. Relevé des Compteurs Électricité 12345 Eau 678 Gaz 90 3. Constat Pièce par Pièce Pièce État Observations Salon Bon état Propre Cuisine État moyen Évier taché robinet qui goutte Chambre Mauvais état — 4. Clés & Accès Remis Clé d&#39;entrée — 2 Badge — 1 5. Observations Générales RAS. À revoir &lt;dans un mois&gt;. Pour le Bailleur / Gestionnaire : Signé électroniquement le 02/03/2026 Le Locataire : Signé électroniquement le 03/03/2026 ✅ ÉTAT DES LIEUX SIGNÉ CONTRADICTOIREMENT"`);
  });

  it("le titre de la page et les signatures portent le bien et le signataire", () => {
    const html = generateInspectionHtml(etatComplet);

    expect(html).toContain("<title>État des Lieux SORTIE - Villa Ngor</title>");
    expect(html).toContain('<img src="https://sig.test/gestionnaire.png" class="sig-img" alt="Signature Gestionnaire" />');
    expect(html).toContain('<img src="https://sig.test/locataire.png" class="sig-img" alt="Signature Locataire" />');
  });
});

/* ───────────────────────────── Compte-rendu de gestion ───────────────────────────── */

const crgMinimal: CrgExportData = {
  agencyName: "Agence Teranga",
  ownerName: "Mamadou Diallo",
  managementFeeRate: 8,
  month: 3,
  year: 2026,
  properties: [],
  totalLoyersByCurrency: {},
  totalChargesByCurrency: {},
  totalCommissionByCurrency: {},
  totalNetByCurrency: {},
};

const crgComplet: CrgExportData = {
  ...crgMinimal,
  ownerCompanyName: "Diallo Immo SARL",
  iban: "SN08 SN01 0152 0000 0000 0000 0001",
  bic: "CBAOSNDA",
  managementFeeRate: 10,
  properties: [
    { propertyId: "p1", propertyTitle: "Villa Ngor", currency: "XOF", loyersEncaisses: 250000, chargesDeduites: 30000, commission: 25000, netAReverser: 195000 },
    { propertyId: "p2", propertyTitle: "Studio Plateau", currency: "EUR", loyersEncaisses: 900, chargesDeduites: 100, commission: 90, netAReverser: 710 },
  ],
  totalLoyersByCurrency: { XOF: 250000, EUR: 900 },
  totalChargesByCurrency: { XOF: 30000, EUR: 100 },
  totalCommissionByCurrency: { XOF: 25000, EUR: 90 },
  totalNetByCurrency: { XOF: 195000, EUR: 710 },
  reversements: [
    { currency: "XOF", amount: 100000, paidAt: new Date(2026, 3, 5, 12), method: "BANK_TRANSFER", reference: "VIR-001" },
    { currency: "XOF", amount: 50000, paidAt: new Date(2026, 3, 9, 12), method: "CASH", reference: null },
    { currency: "EUR", amount: 300, paidAt: new Date(2026, 3, 10, 12), method: "INCONNU", reference: "REF-9" },
  ],
  resteAReverserByCurrency: { XOF: 45000, EUR: 0 },
};

describe("compte-rendu de gestion HTML : chaque champ à sa place", () => {
  it("minimal : aucun bien, aucun total, aucune section de reversements, aucune coordonnée bancaire", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 15, 12));

    expect(visible(generateCrgHtml(crgMinimal))).toMatchInlineSnapshot(`"Compte-Rendu de Gestion - Mars 2026 - Mamadou Diallo COMPTE-RENDU DE GESTION Période : Mars 2026 Propriétaire Agence / Mandataire : Agence Teranga Propriétaire : Mamadou Diallo Taux de commission : 8 % Détail par bien Bien Loyers encaissés Charges déduites Commission Net à reverser Aucun bien rattaché à ce propriétaire Coordonnées bancaires du propriétaire Aucune coordonnée bancaire renseignée pour ce propriétaire. Document généré le 15 juillet 2026 — Compte-rendu de gestion à valeur informative, établi pour le compte du propriétaire."`);
  });

  it("complet en français : propriétaire et société, biens, totaux par devise, reversements, reste à reverser, banque", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 15, 12));

    expect(visible(generateCrgHtml(crgComplet))).toMatchInlineSnapshot(`"Compte-Rendu de Gestion - Mars 2026 - Mamadou Diallo COMPTE-RENDU DE GESTION Période : Mars 2026 Propriétaire Agence / Mandataire : Agence Teranga Propriétaire : Mamadou Diallo (Diallo Immo SARL) Taux de commission : 10 % Détail par bien Bien Loyers encaissés Charges déduites Commission Net à reverser Villa Ngor 250 000 FCFA 30 000 FCFA 25 000 FCFA 195 000 FCFA Studio Plateau 900 € 100 € 90 € 710 € Total € 900 € 100 € 90 € 710 € Total FCFA 250 000 FCFA 30 000 FCFA 25 000 FCFA 195 000 FCFA Reversements au propriétaire Date Moyen Montant 05/04/2026 Virement — VIR-001 100 000 FCFA 09/04/2026 Espèces 50 000 FCFA 10/04/2026 INCONNU — REF-9 300 € Reste à reverser (XOF) 45 000 FCFA Coordonnées bancaires du propriétaire IBAN : SN08 SN01 0152 0000 0000 0000 0001 BIC : CBAOSNDA Document généré le 15 juillet 2026 — Compte-rendu de gestion à valeur informative, établi pour le compte du propriétaire."`);
  });

  it("complet en anglais : tous les libellés fixes sont traduits, la langue du document est déclarée", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 15, 12));
    const html = generateCrgHtml({ ...crgComplet, langue: "en" });

    expect(html).toContain('<html lang="en">');
    expect(visible(html)).toMatchInlineSnapshot(`"Management Report - March 2026 - Mamadou Diallo MANAGEMENT REPORT Period: March 2026 Owner Agency / Agent: Agence Teranga Owner: Mamadou Diallo (Diallo Immo SARL) Commission rate: 10% Breakdown by property Property Rent collected Charges deducted Commission Net to be paid Villa Ngor 250,000 FCFA 30,000 FCFA 25,000 FCFA 195,000 FCFA Studio Plateau 900 € 100 € 90 € 710 € Total € 900 € 100 € 90 € 710 € Total FCFA 250,000 FCFA 30,000 FCFA 25,000 FCFA 195,000 FCFA Payments to the owner Date Method Amount 4/5/2026 Bank transfer — VIR-001 100,000 FCFA 4/9/2026 Cash 50,000 FCFA 4/10/2026 INCONNU — REF-9 300 € Remaining to be paid (XOF) 45,000 FCFA Owner's bank details IBAN: SN08 SN01 0152 0000 0000 0000 0001 BIC: CBAOSNDA Document generated on July 15, 2026 — Management report for information purposes, prepared on behalf of the owner."`);
  });

  it("la langue par défaut est le français, et la balise de langue la déclare", () => {
    expect(generateCrgHtml(crgMinimal)).toContain('<html lang="fr">');
  });

  it("des reversements sans reste à reverser : la section existe, avec son tableau des reversements", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 15, 12));

    const sansReste = visible(generateCrgHtml({ ...crgMinimal, reversements: [{ currency: "XOF", amount: 1000, paidAt: new Date(2026, 3, 5, 12), method: "CHEQUE", reference: null }] }));
    const resteSeul = visible(generateCrgHtml({ ...crgMinimal, resteAReverserByCurrency: { XOF: -500 } }));

    expect(sansReste).toMatchInlineSnapshot(`"Compte-Rendu de Gestion - Mars 2026 - Mamadou Diallo COMPTE-RENDU DE GESTION Période : Mars 2026 Propriétaire Agence / Mandataire : Agence Teranga Propriétaire : Mamadou Diallo Taux de commission : 8 % Détail par bien Bien Loyers encaissés Charges déduites Commission Net à reverser Aucun bien rattaché à ce propriétaire Reversements au propriétaire Date Moyen Montant 05/04/2026 Chèque 1 000 FCFA Coordonnées bancaires du propriétaire Aucune coordonnée bancaire renseignée pour ce propriétaire. Document généré le 15 juillet 2026 — Compte-rendu de gestion à valeur informative, établi pour le compte du propriétaire."`);
    expect(resteSeul).toMatchInlineSnapshot(`"Compte-Rendu de Gestion - Mars 2026 - Mamadou Diallo COMPTE-RENDU DE GESTION Période : Mars 2026 Propriétaire Agence / Mandataire : Agence Teranga Propriétaire : Mamadou Diallo Taux de commission : 8 % Détail par bien Bien Loyers encaissés Charges déduites Commission Net à reverser Aucun bien rattaché à ce propriétaire Reversements au propriétaire Date Moyen Montant Aucun reversement enregistré pour ce mois Versé en trop (XOF) 500 FCFA Coordonnées bancaires du propriétaire Aucune coordonnée bancaire renseignée pour ce propriétaire. Document généré le 15 juillet 2026 — Compte-rendu de gestion à valeur informative, établi pour le compte du propriétaire."`);
  });
});

/* ───────────────────────────── Avenant de révision ───────────────────────────── */

const avenantMinimal: RentRevisionExportData = {
  numero: 1,
  status: "APPLIED",
  previousRent: 250000,
  newRent: 275000,
  currency: "XOF",
  effectiveDate: "2027-03-01T00:00:00.000Z",
  motif: null,
  note: null,
  createdAt: "2027-01-15T00:00:00.000Z",
  contract: { startDate: "2026-03-01T00:00:00.000Z", endDate: "2028-02-28T00:00:00.000Z" },
  property: { title: "Villa Ngor", address: "3 rue des Almadies" },
  tenant: { firstName: "Aminata", lastName: "Ba" },
};

const avenantComplet: RentRevisionExportData = {
  ...avenantMinimal,
  numero: 3,
  status: "PENDING",
  motif: "IRL : 142,06 → 144",
  note: "Accord oral du 12 janvier.\nÀ signer <avant le 1er mars>.",
  contract: { ...avenantMinimal.contract, leaseType: "MEUBLE", applicableLaw: " Droit sénégalais " },
  cotenants: bailComplet.cotenants,
  guarantors: bailComplet.guarantors,
};

describe("avenant de révision HTML : chaque champ à sa place", () => {
  it("minimal : parties, bail, anciens et nouveaux loyers, deux exemplaires, deux cadres de signature", () => {
    expect(visible(generateRentRevisionHtml(avenantMinimal, { agencyName: null }))).toMatchInlineSnapshot(`"Avenant n°1 - Villa Ngor AVENANT N°1 AU BAIL D'HABITATION Révision du loyer 1. Les Parties Le Bailleur / Mandataire : L'Agence Le Locataire : Aminata Ba 2. Bail concerné Bien loué : Villa Ngor Adresse : 3 rue des Almadies Bail du 01/03/2026 au 28/02/2028 3. Révision du loyer Loyer mensuel avant révision : 250 000 FCFA Nouveau loyer mensuel : 275 000 FCFA Date d'effet : 01/03/2027 4. Autres clauses Le présent avenant modifie uniquement le montant du loyer à compter de la date d'effet ci-dessus. Toutes les autres clauses du bail demeurent inchangées. Établi le 15/01/2027, en deux exemplaires. Pour le Bailleur / Gestionnaire : Le Locataire (« lu et approuvé ») :"`);
  });

  it("complet : droit, parties avec colocataire et garants, révision programmée, base de calcul, observations, engagement des garants", () => {
    expect(visible(generateRentRevisionHtml(avenantComplet, agenceBail))).toMatchInlineSnapshot(`"Avenant n°3 - Villa Ngor AVENANT N°3 AU BAIL D'HABITATION MEUBLÉE Révision du loyer Droit applicable : Droit sénégalais 1. Les Parties Le Bailleur / Mandataire : Agence Teranga (12 Corniche Ouest, Dakar) Identifiants légaux : NINEA 0001234 Le Locataire : Aminata Ba Colocataire : Madame Fatou Sow (Email : fatou.sow@test.local, Tél : +221 70 000 00 01) Garant : Monsieur Omar Ndiaye (5 rue Blanchot) — +221 70 000 00 02, omar@test.local — Montant maximal garanti : 1 000 000 FCFA Garant : Awa Fall — +221 70 000 00 03 — Montant maximal garanti : non précisé 2. Bail concerné Bien loué : Villa Ngor Adresse : 3 rue des Almadies Bail du 01/03/2026 au 28/02/2028 3. Révision du loyer Loyer mensuel avant révision : 250 000 FCFA Nouveau loyer mensuel : 275 000 FCFA Date d'effet : 01/03/2027 (révision programmée) Base de calcul : IRL : 142,06 → 144 Observations : Accord oral du 12 janvier. À signer &lt;avant le 1er mars&gt;. 4. Autres clauses Le présent avenant modifie uniquement le montant du loyer à compter de la date d'effet ci-dessus. Toutes les autres clauses du bail demeurent inchangées. 5. Engagement des garants La signature du garant atteste qu'il a pris connaissance de la révision du loyer ci-dessus. Elle ne remplace pas un acte de cautionnement : lorsque la révision aggrave l'engagement du garant (hausse au-delà de ce que prévoit son acte de caution, prolongation de sa durée), un nouvel acte de cautionnement, avec les mentions exigées par le droit applicable, est nécessaire. Établi le 15/01/2027, en autant d'exemplaires que de signataires. Pour le Bailleur / Gestionnaire : Le Locataire (« lu et approuvé ») : Le Colocataire : Madame Fatou Sow Signature précédée de « lu et approuvé » Le Garant : Monsieur Omar Ndiaye Signature précédée de « lu et approuvé » Le Garant : Awa Fall Signature précédée de « lu et approuvé »"`);
  });

  it("le titre de la page porte le numéro et le bien", () => {
    expect(generateRentRevisionHtml(avenantComplet, agenceBail)).toContain("<title>Avenant n°3 - Villa Ngor</title>");
  });
});

/* ───────────────────────────── Mise en demeure ───────────────────────────── */

const miseEnDemeureMinimale: FormalNoticeData = {
  reference: "MED-2026-ABC123",
  createdAt: new Date(2026, 9, 12, 12),
  deadlineDays: 1,
  currency: "XOF",
  totalDue: 250000,
  factures: [{ periodMonth: 9, periodYear: 2026, dueDate: "2026-09-05T12:00:00.000Z", amount: 250000, resteDu: 250000 }],
  destinataires: "Madame Awa DIOP",
  adresse: "",
  propertyTitle: "Appartement Plateau",
  contractStartDate: new Date(2025, 0, 1, 12),
  applicableLaw: null,
  garants: [],
  agency: { name: "Agence Téranga", address: null, phone: null, email: null, siretOrId: null },
};

const miseEnDemeureComplete: FormalNoticeData = {
  ...miseEnDemeureMinimale,
  deadlineDays: 30,
  totalDue: 520000,
  factures: [
    { periodMonth: 8, periodYear: 2026, dueDate: "2026-08-05T12:00:00.000Z", amount: 250000, resteDu: 250000 },
    { periodMonth: 9, periodYear: 2026, dueDate: "2026-09-05T12:00:00.000Z", amount: 270000, resteDu: 270000 },
  ],
  adresse: "12 rue Carnot, Dakar",
  applicableLaw: " Droit sénégalais ",
  garants: ["Monsieur Omar NDIAYE", "Awa FALL"],
  pays: "SN",
  agency: { name: "Agence Téranga", address: "12 Corniche Ouest, Dakar", phone: "+221 33 000 00 00", email: "contact@teranga.test", siretOrId: "NINEA 0001234" },
};

describe("mise en demeure : chaque champ à sa place", () => {
  it("HTML minimale : un seul loyer, un jour, ni garant ni droit applicable ni mention de pays", () => {
    expect(visible(generateFormalNoticeHtml(miseEnDemeureMinimale))).toMatchInlineSnapshot(`"Mise en demeure MED-2026-ABC123 - Appartement Plateau Agence Téranga Réf : MED-2026-ABC123 Le 12 octobre 2026 Madame Awa DIOP MISE EN DEMEURE DE PAYER Par lettre recommandée avec avis de réception, ou remise en main propre contre décharge Objet : mise en demeure de payer — loyer impayé — Appartement Plateau Madame, Monsieur, Sauf erreur ou omission de notre part, la somme suivante, due au titre du bail du 1er janvier 2025 portant sur le logement « Appartement Plateau », reste impayée à ce jour, malgré l&#39;échéance dépassée : Loyer Échéance Montant Reste dû septembre 2026 5 septembre 2026 250 000 FCFA 250 000 FCFA Total restant dû 250 000 FCFA Par la présente, nous vous mettons en demeure de régler la somme totale de 250 000 FCFA dans un délai de 1 jour à compter de la réception de ce courrier. À défaut de règlement dans ce délai, nous nous réservons le droit d&#39;engager toute procédure utile au recouvrement de ces sommes et de faire valoir les clauses du bail. Si vous rencontrez des difficultés, nous vous invitons à prendre contact avec nous sans attendre afin d&#39;examiner une solution. Si vous avez réglé ces sommes entre-temps, nous vous prions de ne pas tenir compte de ce courrier. Veuillez agréer, Madame, Monsieur, l&#39;expression de nos salutations distinguées. Pour Agence Téranga"`);
  });

  it("HTML complète : deux loyers, délai au pluriel, garants, droit applicable, mention du pays, coordonnées de l'agence", () => {
    expect(visible(generateFormalNoticeHtml(miseEnDemeureComplete))).toMatchInlineSnapshot(`"Mise en demeure MED-2026-ABC123 - Appartement Plateau Agence Téranga 12 Corniche Ouest, Dakar Tél : +221 33 000 00 00 contact@teranga.test Identifiants légaux : NINEA 0001234 Réf : MED-2026-ABC123 Le 12 octobre 2026 Madame Awa DIOP 12 rue Carnot, Dakar MISE EN DEMEURE DE PAYER Par lettre recommandée avec avis de réception, ou remise en main propre contre décharge Objet : mise en demeure de payer — loyers impayés — Appartement Plateau Madame, Monsieur, Sauf erreur ou omission de notre part, les sommes suivantes, dues au titre du bail du 1er janvier 2025 portant sur le logement « Appartement Plateau » situé 12 rue Carnot, Dakar, restent impayées à ce jour, malgré l&#39;échéance dépassée : Loyer Échéance Montant Reste dû août 2026 5 août 2026 250 000 FCFA 250 000 FCFA septembre 2026 5 septembre 2026 270 000 FCFA 270 000 FCFA Total restant dû 520 000 FCFA Par la présente, nous vous mettons en demeure de régler la somme totale de 520 000 FCFA dans un délai de 30 jours à compter de la réception de ce courrier. À défaut de règlement dans ce délai, nous nous réservons le droit d&#39;engager toute procédure utile au recouvrement de ces sommes et de faire valoir les clauses du bail, ainsi que l&#39;engagement des garants (Monsieur Omar NDIAYE, Awa FALL). Si vous rencontrez des difficultés, nous vous invitons à prendre contact avec nous sans attendre afin d&#39;examiner une solution. Si vous avez réglé ces sommes entre-temps, nous vous prions de ne pas tenir compte de ce courrier. Droit applicable au bail : Droit sénégalais Au Sénégal, la résiliation d&#39;un bail d&#39;habitation pour défaut de paiement suppose une mise en demeure de trente jours faite par acte extrajudiciaire (Code des obligations civiles et commerciales, article 571). Le présent courrier ne remplace pas cet acte. Veuillez agréer, Madame, Monsieur, l&#39;expression de nos salutations distinguées. Pour Agence Téranga"`);
  });

  it("HTML minimale : l'en-tête ne contient que le nom de l'agence, et aucun paragraphe de droit vide", () => {
    const html = generateFormalNoticeHtml(miseEnDemeureMinimale);

    expect(html).toMatch(/<div class="agence">\s*<strong>Agence Téranga<\/strong><br>\s*<\/div>/);
    expect(html).not.toContain('<p style="font-size:12px; color:#64748b;">');
  });

  it("PDF minimale : seul le nom de l'agence en en-tête, aucune ligne vide", async () => {
    const ecrits = textesEcrits();

    await generateFormalNoticePdfBuffer(miseEnDemeureMinimale);

    expect(ecrits()).toMatchInlineSnapshot(`
      [
        "Agence Téranga",
        "Réf : MED-2026-ABC123",
        "Le 12 octobre 2026",
        "Madame Awa DIOP",
        "",
        "MISE EN DEMEURE DE PAYER",
        "Par lettre recommandée avec avis de réception, ou remise en main propre contre décharge",
        "Objet : mise en demeure de payer — loyer impayé — Appartement Plateau",
        "Madame, Monsieur,",
        "Sauf erreur ou omission de notre part, la somme suivante, due au titre du bail du 1er janvier 2025 portant sur le logement « Appartement Plateau », reste impayée à ce jour, malgré l'échéance dépassée :",
        "Loyer",
        "Échéance",
        "Montant",
        "Reste dû",
        "septembre 2026",
        "5 septembre 2026",
        "250 000 FCFA",
        "250 000 FCFA",
        "Total restant dû",
        "",
        "",
        "250 000 FCFA",
        "Par la présente, nous vous mettons en demeure de régler la somme totale de 250 000 FCFA dans un délai de 1 jour à compter de la réception de ce courrier.",
        "À défaut de règlement dans ce délai, nous nous réservons le droit d'engager toute procédure utile au recouvrement de ces sommes et de faire valoir les clauses du bail.",
        "Si vous rencontrez des difficultés, nous vous invitons à prendre contact avec nous sans attendre afin d'examiner une solution. Si vous avez réglé ces sommes entre-temps, nous vous prions de ne pas tenir compte de ce courrier.",
        "Veuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.",
        "Pour Agence Téranga",
      ]
    `);
  });

  it("PDF complète : coordonnées de l'agence, tableau des loyers, droit applicable et mention du pays", async () => {
    const ecrits = textesEcrits();

    await generateFormalNoticePdfBuffer(miseEnDemeureComplete);

    expect(ecrits()).toMatchInlineSnapshot(`
      [
        "Agence Téranga",
        "12 Corniche Ouest, Dakar",
        "Tél : +221 33 000 00 00",
        "contact@teranga.test",
        "Identifiants légaux : NINEA 0001234",
        "Réf : MED-2026-ABC123",
        "Le 12 octobre 2026",
        "Madame Awa DIOP",
        "12 rue Carnot, Dakar",
        "MISE EN DEMEURE DE PAYER",
        "Par lettre recommandée avec avis de réception, ou remise en main propre contre décharge",
        "Objet : mise en demeure de payer — loyers impayés — Appartement Plateau",
        "Madame, Monsieur,",
        "Sauf erreur ou omission de notre part, les sommes suivantes, dues au titre du bail du 1er janvier 2025 portant sur le logement « Appartement Plateau » situé 12 rue Carnot, Dakar, restent impayées à ce jour, malgré l'échéance dépassée :",
        "Loyer",
        "Échéance",
        "Montant",
        "Reste dû",
        "août 2026",
        "5 août 2026",
        "250 000 FCFA",
        "250 000 FCFA",
        "septembre 2026",
        "5 septembre 2026",
        "270 000 FCFA",
        "270 000 FCFA",
        "Total restant dû",
        "",
        "",
        "520 000 FCFA",
        "Par la présente, nous vous mettons en demeure de régler la somme totale de 520 000 FCFA dans un délai de 30 jours à compter de la réception de ce courrier.",
        "À défaut de règlement dans ce délai, nous nous réservons le droit d'engager toute procédure utile au recouvrement de ces sommes et de faire valoir les clauses du bail, ainsi que l'engagement des garants (Monsieur Omar NDIAYE, Awa FALL).",
        "Si vous rencontrez des difficultés, nous vous invitons à prendre contact avec nous sans attendre afin d'examiner une solution. Si vous avez réglé ces sommes entre-temps, nous vous prions de ne pas tenir compte de ce courrier.",
        "Droit applicable au bail : Droit sénégalais",
        "Au Sénégal, la résiliation d'un bail d'habitation pour défaut de paiement suppose une mise en demeure de trente jours faite par acte extrajudiciaire (Code des obligations civiles et commerciales, article 571). Le présent courrier ne remplace pas cet acte.",
        "Veuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.",
        "Pour Agence Téranga",
      ]
    `);
  });
});

/* ───────────────────────────── Solde de tout compte ───────────────────────────── */

const soldeMinimal: SettlementData = {
  reference: "SOL-2026-0001",
  createdAt: new Date("2026-10-12T12:00:00.000Z"),
  exitDate: new Date("2026-09-30T12:00:00.000Z"),
  lastMonthMode: "FULL",
  currency: "XOF",
  depositAmount: 500000,
  deductions: [],
  deductionsTotal: 0,
  depositRefunded: 0,
  lignes: [],
  unpaidTotal: 0,
  creditTotal: 0,
  balance: 0,
  destinataires: "Madame Awa DIOP",
  adresse: "",
  propertyTitle: "Appartement Plateau",
  contractStartDate: new Date("2025-01-01T12:00:00.000Z"),
  agency: { name: "Agence Téranga", address: null, phone: null, email: null, siretOrId: null },
};

const soldeComplet: SettlementData = {
  ...soldeMinimal,
  lastMonthMode: "PRORATA",
  deductions: [
    { label: "Peinture du salon", amount: 80000 },
    { label: "Vitre brisée", amount: 20000 },
  ],
  deductionsTotal: 100000,
  depositRefunded: 50000,
  lignes: [
    { periodMonth: 8, periodYear: 2026, amount: 250000, retenu: 250000, paid: 200000, due: 50000, credit: 0 },
    { periodMonth: 9, periodYear: 2026, amount: 250000, retenu: 125000, paid: 250000, due: 0, credit: 125000 },
  ],
  unpaidTotal: 50000,
  creditTotal: 125000,
  balance: 425000,
  adresse: "12 rue Carnot, Dakar",
  agency: { name: "Agence Téranga", address: "12 Corniche Ouest, Dakar", phone: "+221 33 000 00 00", email: "contact@teranga.test", siretOrId: "NINEA 0001234" },
};

const soldeDu: SettlementData = { ...soldeComplet, balance: -75000 };

describe("solde de tout compte : chaque champ à sa place", () => {
  it("HTML minimal : aucun loyer facturé, aucune retenue, compte soldé", () => {
    expect(visible(generateSettlementHtml(soldeMinimal))).toMatchInlineSnapshot(`"Solde de tout compte SOL-2026-0001 - Appartement Plateau Agence Téranga Réf : SOL-2026-0001 Le 12 octobre 2026 Madame Awa DIOP SOLDE DE TOUT COMPTE Objet : solde de tout compte — logement « Appartement Plateau » — bail du 1er janvier 2025, sortie du 30 septembre 2026 Madame, Monsieur, Nous avons arrêté le compte de votre bail à la date de votre sortie, le 30 septembre 2026. Il récapitule les sommes enregistrées par l&#39;agence au 12 octobre 2026. Loyers Aucun loyer n'a été facturé jusqu'à la sortie. Le loyer du mois de la sortie est dû en entier. Dépôt de garantie Dépôt de garantie versé : 500 000 FCFA Aucune retenue enregistrée sur le dépôt. Récapitulatif Dépôt de garantie + 500 000 FCFA Compte soldé 0 FCFA Aucune somme n&#39;est due de part ni d&#39;autre. Pour toute question sur ce décompte, contactez l&#39;agence aux coordonnées ci-dessus. Veuillez agréer, Madame, Monsieur, l&#39;expression de nos salutations distinguées. Pour Agence Téranga"`);
  });

  it("HTML complet : loyers, retenues, trop-perçu, dépôt déjà restitué, somme à restituer, coordonnées de l'agence", () => {
    expect(visible(generateSettlementHtml(soldeComplet))).toMatchInlineSnapshot(`"Solde de tout compte SOL-2026-0001 - Appartement Plateau Agence Téranga 12 Corniche Ouest, Dakar Tél : +221 33 000 00 00 contact@teranga.test Identifiants légaux : NINEA 0001234 Réf : SOL-2026-0001 Le 12 octobre 2026 Madame Awa DIOP 12 rue Carnot, Dakar SOLDE DE TOUT COMPTE Objet : solde de tout compte — logement « Appartement Plateau », 12 rue Carnot, Dakar — bail du 1er janvier 2025, sortie du 30 septembre 2026 Madame, Monsieur, Nous avons arrêté le compte de votre bail à la date de votre sortie, le 30 septembre 2026. Il récapitule les sommes enregistrées par l&#39;agence au 12 octobre 2026. Loyers Période Montant retenu Réglé Reste dû août 2026 250 000 FCFA 200 000 FCFA 50 000 FCFA septembre 2026 125 000 FCFA 250 000 FCFA 0 FCFA Total restant dû 50 000 FCFA Le loyer du mois de la sortie est calculé au prorata des jours occupés. Dépôt de garantie Dépôt de garantie versé : 500 000 FCFA Peinture du salon - 80 000 FCFA Vitre brisée - 20 000 FCFA Dépôt déjà restitué : 50 000 FCFA Récapitulatif Dépôt de garantie + 500 000 FCFA Retenues sur le dépôt − 100 000 FCFA Loyers restant dus − 50 000 FCFA Trop-perçu de loyer + 125 000 FCFA Dépôt déjà restitué − 50 000 FCFA Somme à restituer au locataire 425 000 FCFA Cette somme vous est restituée par l&#39;agence. Pour toute question sur ce décompte, contactez l&#39;agence aux coordonnées ci-dessus. Veuillez agréer, Madame, Monsieur, l&#39;expression de nos salutations distinguées. Pour Agence Téranga"`);
  });

  it("HTML avec un reste dû par le locataire", () => {
    expect(visible(generateSettlementHtml(soldeDu))).toMatchInlineSnapshot(`"Solde de tout compte SOL-2026-0001 - Appartement Plateau Agence Téranga 12 Corniche Ouest, Dakar Tél : +221 33 000 00 00 contact@teranga.test Identifiants légaux : NINEA 0001234 Réf : SOL-2026-0001 Le 12 octobre 2026 Madame Awa DIOP 12 rue Carnot, Dakar SOLDE DE TOUT COMPTE Objet : solde de tout compte — logement « Appartement Plateau », 12 rue Carnot, Dakar — bail du 1er janvier 2025, sortie du 30 septembre 2026 Madame, Monsieur, Nous avons arrêté le compte de votre bail à la date de votre sortie, le 30 septembre 2026. Il récapitule les sommes enregistrées par l&#39;agence au 12 octobre 2026. Loyers Période Montant retenu Réglé Reste dû août 2026 250 000 FCFA 200 000 FCFA 50 000 FCFA septembre 2026 125 000 FCFA 250 000 FCFA 0 FCFA Total restant dû 50 000 FCFA Le loyer du mois de la sortie est calculé au prorata des jours occupés. Dépôt de garantie Dépôt de garantie versé : 500 000 FCFA Peinture du salon - 80 000 FCFA Vitre brisée - 20 000 FCFA Dépôt déjà restitué : 50 000 FCFA Récapitulatif Dépôt de garantie + 500 000 FCFA Retenues sur le dépôt − 100 000 FCFA Loyers restant dus − 50 000 FCFA Trop-perçu de loyer + 125 000 FCFA Dépôt déjà restitué − 50 000 FCFA Reste dû par le locataire 75 000 FCFA Cette somme reste à régler à l&#39;agence : merci de la verser dans les meilleurs délais. Pour toute question sur ce décompte, contactez l&#39;agence aux coordonnées ci-dessus. Veuillez agréer, Madame, Monsieur, l&#39;expression de nos salutations distinguées. Pour Agence Téranga"`);
  });

  it("HTML minimal : l'en-tête ne contient que le nom de l'agence", () => {
    expect(generateSettlementHtml(soldeMinimal)).toMatch(/<div class="agence">\s*<strong>Agence Téranga<\/strong><br>\s*<\/div>/);
  });

  it("PDF minimal : seul le nom de l'agence en en-tête", async () => {
    const ecrits = textesEcrits();

    await generateSettlementPdfBuffer(soldeMinimal);

    expect(ecrits()).toMatchInlineSnapshot(`
      [
        "Agence Téranga",
        "Réf : SOL-2026-0001",
        "Le 12 octobre 2026",
        "Madame Awa DIOP",
        "",
        "SOLDE DE TOUT COMPTE",
        "Objet : solde de tout compte — logement « Appartement Plateau » — bail du 1er janvier 2025, sortie du 30 septembre 2026",
        "Madame, Monsieur,",
        "Nous avons arrêté le compte de votre bail à la date de votre sortie, le 30 septembre 2026. Il récapitule les sommes enregistrées par l'agence au 12 octobre 2026.",
        "LOYERS",
        "Aucun loyer n'a été facturé jusqu'à la sortie.",
        "Le loyer du mois de la sortie est dû en entier.",
        "DÉPÔT DE GARANTIE",
        "Dépôt de garantie versé",
        "500 000 FCFA",
        "Aucune retenue enregistrée sur le dépôt.",
        "RÉCAPITULATIF",
        "Dépôt de garantie",
        "+ 500 000 FCFA",
        "Compte soldé",
        "0 FCFA",
        "Aucune somme n'est due de part ni d'autre.",
        "Pour toute question sur ce décompte, contactez l'agence aux coordonnées ci-dessus.",
        "Veuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.",
        "Pour Agence Téranga",
      ]
    `);
  });

  it("PDF complet : lignes de loyer, retenues, récapitulatif signé et résultat", async () => {
    const ecrits = textesEcrits();

    await generateSettlementPdfBuffer(soldeComplet);

    expect(ecrits()).toMatchInlineSnapshot(`
      [
        "Agence Téranga",
        "12 Corniche Ouest, Dakar",
        "Tél : +221 33 000 00 00",
        "contact@teranga.test",
        "Identifiants légaux : NINEA 0001234",
        "Réf : SOL-2026-0001",
        "Le 12 octobre 2026",
        "Madame Awa DIOP",
        "12 rue Carnot, Dakar",
        "SOLDE DE TOUT COMPTE",
        "Objet : solde de tout compte — logement « Appartement Plateau », 12 rue Carnot, Dakar — bail du 1er janvier 2025, sortie du 30 septembre 2026",
        "Madame, Monsieur,",
        "Nous avons arrêté le compte de votre bail à la date de votre sortie, le 30 septembre 2026. Il récapitule les sommes enregistrées par l'agence au 12 octobre 2026.",
        "LOYERS",
        "août 2026 — retenu 250 000 FCFA, réglé 200 000 FCFA",
        "50 000 FCFA",
        "septembre 2026 — retenu 125 000 FCFA, réglé 250 000 FCFA",
        "0 FCFA",
        "Total restant dû",
        "50 000 FCFA",
        "Le loyer du mois de la sortie est calculé au prorata des jours occupés.",
        "DÉPÔT DE GARANTIE",
        "Dépôt de garantie versé",
        "500 000 FCFA",
        "Retenue : Peinture du salon",
        "- 80 000 FCFA",
        "Retenue : Vitre brisée",
        "- 20 000 FCFA",
        "Dépôt déjà restitué : 50 000 FCFA",
        "RÉCAPITULATIF",
        "Dépôt de garantie",
        "+ 500 000 FCFA",
        "Retenues sur le dépôt",
        "− 100 000 FCFA",
        "Loyers restant dus",
        "− 50 000 FCFA",
        "Trop-perçu de loyer",
        "+ 125 000 FCFA",
        "Dépôt déjà restitué",
        "− 50 000 FCFA",
        "Somme à restituer au locataire",
        "425 000 FCFA",
        "Cette somme vous est restituée par l'agence.",
        "Pour toute question sur ce décompte, contactez l'agence aux coordonnées ci-dessus.",
        "Veuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.",
        "Pour Agence Téranga",
      ]
    `);
  });

  it("PDF avec un reste dû par le locataire", async () => {
    const ecrits = textesEcrits();

    await generateSettlementPdfBuffer(soldeDu);

    expect(ecrits()).toMatchInlineSnapshot(`
      [
        "Agence Téranga",
        "12 Corniche Ouest, Dakar",
        "Tél : +221 33 000 00 00",
        "contact@teranga.test",
        "Identifiants légaux : NINEA 0001234",
        "Réf : SOL-2026-0001",
        "Le 12 octobre 2026",
        "Madame Awa DIOP",
        "12 rue Carnot, Dakar",
        "SOLDE DE TOUT COMPTE",
        "Objet : solde de tout compte — logement « Appartement Plateau », 12 rue Carnot, Dakar — bail du 1er janvier 2025, sortie du 30 septembre 2026",
        "Madame, Monsieur,",
        "Nous avons arrêté le compte de votre bail à la date de votre sortie, le 30 septembre 2026. Il récapitule les sommes enregistrées par l'agence au 12 octobre 2026.",
        "LOYERS",
        "août 2026 — retenu 250 000 FCFA, réglé 200 000 FCFA",
        "50 000 FCFA",
        "septembre 2026 — retenu 125 000 FCFA, réglé 250 000 FCFA",
        "0 FCFA",
        "Total restant dû",
        "50 000 FCFA",
        "Le loyer du mois de la sortie est calculé au prorata des jours occupés.",
        "DÉPÔT DE GARANTIE",
        "Dépôt de garantie versé",
        "500 000 FCFA",
        "Retenue : Peinture du salon",
        "- 80 000 FCFA",
        "Retenue : Vitre brisée",
        "- 20 000 FCFA",
        "Dépôt déjà restitué : 50 000 FCFA",
        "RÉCAPITULATIF",
        "Dépôt de garantie",
        "+ 500 000 FCFA",
        "Retenues sur le dépôt",
        "− 100 000 FCFA",
        "Loyers restant dus",
        "− 50 000 FCFA",
        "Trop-perçu de loyer",
        "+ 125 000 FCFA",
        "Dépôt déjà restitué",
        "− 50 000 FCFA",
        "Reste dû par le locataire",
        "75 000 FCFA",
        "Cette somme reste à régler à l'agence : merci de la verser dans les meilleurs délais.",
        "Pour toute question sur ce décompte, contactez l'agence aux coordonnées ci-dessus.",
        "Veuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.",
        "Pour Agence Téranga",
      ]
    `);
  });
});
