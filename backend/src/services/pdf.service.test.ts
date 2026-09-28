import { describe, expect, it } from "vitest";
import {
  CrgExportData,
  generateCrgHtml,
  generateInspectionHtml,
  generateLeaseHtml,
  generateReceiptHtml,
  generateReceiptPdfBuffer,
  InspectionExportData,
  ReceiptData,
} from "./pdf.service";
import { formaterMontant } from "../utils/montant";

// fr-FR sépare les milliers par une espace fine insécable (U+202F). Les
// documents contractuels — quittance, bail — écrivaient jusqu'ici le montant
// brut et le code ISO (« 250000 XOF ») alors que le portail, les emails de
// rappel et WhatsApp affichaient « 250 000 FCFA ». Un locataire qui compare sa
// quittance à son espace doutait du montant, pas de la mise en page.
const ESPACE_FINE = "\u202f";


// pdf.service.ts produit les deux documents contractuels de l'application :
// la quittance de loyer (HTML + PDF réel) et le contrat de bail (HTML). Ces
// templates HTML sont servis tels quels en text/html (voir
// document.controller.ts), ce qui rend l'échappement de CHAQUE champ
// contrôlé par un utilisateur (nom du locataire, adresse, mentions légales
// de l'agence...) critique : c'est la protection contre une XSS stockée,
// documentée en tête du fichier mais qu'aucun test ne vérifiait.
// Le rendu PDF (pdfkit) n'avait lui non plus aucune couverture.

const baseReceipt: ReceiptData = {
  receiptNumber: "QUITT-2026-06-A1B2C3",
  agency: {
    name: "Agence Teranga",
    address: "12 Corniche Ouest, Dakar",
    phone: "+221 33 000 00 00",
    email: "contact@teranga.test",
    siretOrId: "NIF-123456",
    legalNotice: "Agence agréée n° 42",
  },
  tenant: {
    fullName: "Aminata Ba",
    email: "aminata.ba@test.local",
    phone: "+221 77 000 00 00",
  },
  property: {
    title: "Villa Ngor",
    address: "3 rue des Almadies",
    surface: 120,
  },
  invoice: {
    periodMonth: 6,
    periodYear: 2026,
    amount: 250000,
    currency: "XOF",
    paidAt: new Date(2026, 5, 3),
    paymentMethod: "PAYDUNYA",
    paymentRef: "PD-987654",
  },
};

describe("generateReceiptHtml", () => {
  it("rend les informations de l'agence, du locataire, du logement et de la période", () => {
    const html = generateReceiptHtml(baseReceipt);

    expect(html).toContain("Agence Teranga");
    expect(html).toContain("QUITT-2026-06-A1B2C3");
    expect(html).toContain("Aminata Ba");
    expect(html).toContain("aminata.ba@test.local");
    expect(html).toContain("Villa Ngor");
    expect(html).toContain("3 rue des Almadies");
    expect(html).toContain("Surface : 120 m²");
    expect(html).toContain("Juin 2026");
    expect(html).toContain(`250${ESPACE_FINE}000 FCFA`);
    expect(html).toContain("PAYDUNYA");
    expect(html).toContain("Agence agréée n° 42");
  });

  it("échappe les champs contrôlés par l'utilisateur (protection XSS stockée)", () => {
    const html = generateReceiptHtml({
      ...baseReceipt,
      tenant: {
        ...baseReceipt.tenant,
        fullName: '<script>alert("xss")</script>',
      },
      property: {
        ...baseReceipt.property,
        address: '"><img src=x onerror=alert(1)>',
      },
      agency: {
        ...baseReceipt.agency,
        legalNotice: "<b>Mention & compagnie</b>",
      },
    });

    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
    expect(html).not.toContain("<img src=x onerror");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;b&gt;Mention &amp; compagnie&lt;/b&gt;");
  });

  it("échappe aussi la devise, seul champ texte qui contournait l'échappement", () => {
    // Régression : `currency` est une colonne texte (modifiable côté
    // gestionnaire) qui était interpolée brute dans la quittance, alors que
    // tous les autres champs texte du template passent par escapeHtml.
    const html = generateReceiptHtml({
      ...baseReceipt,
      invoice: { ...baseReceipt.invoice, currency: '<script>x</script>' },
    });

    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });

  it("omet les lignes d'agence non renseignées et retombe sur la mention légale par défaut", () => {
    const html = generateReceiptHtml({
      ...baseReceipt,
      agency: { name: "Agence Minimale", address: null, phone: null, email: null, siretOrId: null, legalNotice: null },
    });

    expect(html).toContain("Agence Minimale");
    expect(html).not.toContain("Tél :");
    expect(html).not.toContain("N° SIRET / NIF :");
    expect(html).toContain("Document émis et certifié conforme");
  });

  it("traduit le mois de la période en français", () => {
    const janvier = generateReceiptHtml({
      ...baseReceipt,
      invoice: { ...baseReceipt.invoice, periodMonth: 1, periodYear: 2027 },
    });
    const decembre = generateReceiptHtml({
      ...baseReceipt,
      invoice: { ...baseReceipt.invoice, periodMonth: 12, periodYear: 2027 },
    });

    expect(janvier).toContain("Janvier 2027");
    expect(decembre).toContain("Décembre 2027");
  });
});

describe("generateReceiptPdfBuffer", () => {
  it("produit un vrai fichier PDF binaire non vide", async () => {
    const buffer = await generateReceiptPdfBuffer(baseReceipt);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(-1024).toString("latin1")).toContain("%%EOF");
  });

  it("génère le PDF même quand toutes les informations optionnelles de l'agence sont absentes", async () => {
    const buffer = await generateReceiptPdfBuffer({
      ...baseReceipt,
      agency: { name: "Agence Minimale", address: null, phone: null, email: null, siretOrId: null, legalNotice: null },
      invoice: { ...baseReceipt.invoice, paymentRef: null },
    });

    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(1000);
  });
});

describe("generateLeaseHtml", () => {
  const contract = {
    startDate: new Date(2026, 0, 1),
    endDate: new Date(2027, 0, 1),
    rent: 250000,
    deposit: 500000,
    currency: "XOF",
    signedByManagerAt: null,
    signedByTenantAt: null,
    managerSignatureUrl: null,
    tenantSignatureUrl: null,
    property: { title: "Villa Ngor", address: "3 rue des Almadies", surface: 120 },
    tenant: { firstName: "Aminata", lastName: "Ba", email: "aminata.ba@test.local", phone: "+221 77 000 00 00" },
  };
  const agency = { agencyName: "Agence Teranga", address: "12 Corniche Ouest, Dakar" };

  it("rend les parties, le bien et les conditions financières", () => {
    const html = generateLeaseHtml(contract, agency);

    expect(html).toContain("CONTRAT DE BAIL D'HABITATION");
    expect(html).toContain("Agence Teranga");
    expect(html).toContain("Aminata");
    expect(html).toContain("Ba");
    expect(html).toContain("Villa Ngor");
    expect(html).toContain(`250${ESPACE_FINE}000 FCFA`);
    expect(html).toContain(`500${ESPACE_FINE}000 FCFA`);
    expect(html).toContain("01/01/2026");
    expect(html).toContain("01/01/2027");
  });

  it("échappe les champs contrôlés par l'utilisateur, devise comprise", () => {
    const html = generateLeaseHtml(
      {
        ...contract,
        currency: '<script>x</script>',
        tenant: { ...contract.tenant, lastName: '<img src=x onerror=alert(1)>' },
        property: { ...contract.property, title: '"><script>alert(1)</script>' },
      },
      { agencyName: "<b>Agence</b>", address: "Dakar & environs" }
    );

    expect(html).not.toContain("<script>x</script>");
    expect(html).not.toContain("<img src=x onerror");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;b&gt;Agence&lt;/b&gt;");
    expect(html).toContain("Dakar &amp; environs");
  });

  it("retombe sur la devise et le nom d'agence par défaut quand ils sont absents", () => {
    const html = generateLeaseHtml(
      { ...contract, currency: null },
      { agencyName: null, address: null }
    );

    expect(html).toContain(`250${ESPACE_FINE}000 €`);
    expect(html).toContain("L'Agence");
  });

  it("affiche 'En attente de signature' tant que le bail n'est pas signé", () => {
    const html = generateLeaseHtml(contract, agency);

    expect(html).toContain("En attente de signature");
    expect(html).not.toContain("Signé électroniquement");
    expect(html).not.toContain("<img");
  });

  it("affiche la date et l'image de signature une fois le bail signé par les deux parties", () => {
    const html = generateLeaseHtml(
      {
        ...contract,
        signedByManagerAt: new Date(2026, 0, 5),
        signedByTenantAt: new Date(2026, 0, 6),
        managerSignatureUrl: "https://storage.test/sig-manager.png",
        tenantSignatureUrl: "https://storage.test/sig-tenant.png",
      },
      agency
    );

    expect(html).not.toContain("En attente de signature");
    expect(html).toContain("Signé électroniquement le 05/01/2026");
    expect(html).toContain("Signé électroniquement le 06/01/2026");
    expect(html).toContain('src="https://storage.test/sig-manager.png"');
    expect(html).toContain('src="https://storage.test/sig-tenant.png"');
  });

  it("n'insère aucune balise image quand la signature est datée mais sans fichier", () => {
    const html = generateLeaseHtml(
      { ...contract, signedByManagerAt: new Date(2026, 0, 5), managerSignatureUrl: null },
      agency
    );

    expect(html).toContain("Signé électroniquement le 05/01/2026");
    // "sig-img" apparaît dans la feuille de style : on vérifie l'absence de la
    // balise elle-même, pas de la classe CSS.
    expect(html).not.toContain("<img");
  });
});

describe("generateInspectionHtml", () => {
  const baseInspection: InspectionExportData = {
    reference: "EDL-2026-06-A1B2C3",
    type: "ENTRY",
    inspectionDate: new Date(2026, 5, 3),
    agencyName: "Agence Teranga",
    property: { title: "Villa Ngor", address: "3 rue des Almadies" },
    tenant: { fullName: "Aminata Ba" },
    rooms: [{ name: "Salon", condition: "BON", notes: "RAS" }],
    meters: { electricity: "12345", water: "678", gas: "90" },
    keys: [{ label: "Clé principale", quantity: 2 }],
    generalComments: "Aucune remarque.",
    managerSignatureUrl: null,
    signedByManagerAt: null,
    tenantSignatureUrl: null,
    signedByTenantAt: null,
  };

  it("rend le type, les parties, le bien, les compteurs, les pièces et les clés", () => {
    const html = generateInspectionHtml(baseInspection);

    expect(html).toContain("EDL-2026-06-A1B2C3");
    expect(html).toContain("ENTRÉE");
    expect(html).toContain("Agence Teranga");
    expect(html).toContain("Aminata Ba");
    expect(html).toContain("Villa Ngor");
    expect(html).toContain("3 rue des Almadies");
    expect(html).toContain("12345");
    expect(html).toContain("Salon");
    expect(html).toContain("Bon état");
    expect(html).toContain("Clé principale");
    expect(html).toContain("Aucune remarque.");
  });

  // Même principe que generateReceiptHtml/generateLeaseHtml : ce document HTML
  // est servi tel quel (document.controller.ts) et imprimable/exportable
  // depuis le navigateur — un champ non échappé y serait une XSS stockée.
  // room.notes et keys[].label sont en particulier renseignés par le
  // gestionnaire ou le locataire lors de l'état des lieux, donc attaquables.
  it("échappe les champs contrôlés par l'utilisateur (protection XSS stockée)", () => {
    const html = generateInspectionHtml({
      ...baseInspection,
      agencyName: "<b>Agence</b>",
      tenant: { fullName: '<script>alert("xss")</script>' },
      property: { title: '"><img src=x onerror=alert(1)>', address: "Dakar & environs" },
      rooms: [{ name: "<i>Chambre</i>", condition: "MOYEN", notes: '<script>x</script>' }],
      keys: [{ label: '<img src=x onerror=alert(2)>', quantity: 1 }],
      generalComments: "<b>Commentaire & remarque</b>",
    });

    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<script>x</script>");
    expect(html).not.toContain("<img src=x onerror");
    expect(html).toContain("&lt;b&gt;Agence&lt;/b&gt;");
    expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
    expect(html).toContain("&lt;i&gt;Chambre&lt;/i&gt;");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(2)&gt;");
    expect(html).toContain("&lt;b&gt;Commentaire &amp; remarque&lt;/b&gt;");
    expect(html).toContain("Dakar &amp; environs");
  });

  it("affiche des messages de repli quand aucune pièce ni aucune clé n'est renseignée", () => {
    const html = generateInspectionHtml({ ...baseInspection, rooms: [], keys: [] });

    expect(html).toContain("Aucune pièce renseignée");
    expect(html).toContain("Aucune clé renseignée");
  });

  it("omet la section « Observations générales » quand elle est vide", () => {
    const html = generateInspectionHtml({ ...baseInspection, generalComments: null });

    expect(html).not.toContain("Observations Générales");
  });

  it("affiche 'En attente de signature' tant que les deux parties n'ont pas signé, sans tampon ni image", () => {
    const html = generateInspectionHtml(baseInspection);

    expect(html).toContain("En attente de signature");
    expect(html).not.toContain("ÉTAT DES LIEUX SIGNÉ CONTRADICTOIREMENT");
    expect(html).not.toContain("<img");
  });

  it("affiche le tampon « signé contradictoirement » uniquement une fois les deux parties signées", () => {
    const signeParUnSeul = generateInspectionHtml({
      ...baseInspection,
      signedByManagerAt: new Date(2026, 5, 4),
      managerSignatureUrl: "https://storage.test/sig-manager.png",
    });
    expect(signeParUnSeul).toContain("Signé électroniquement le 04/06/2026");
    expect(signeParUnSeul).toContain('src="https://storage.test/sig-manager.png"');
    expect(signeParUnSeul).not.toContain("ÉTAT DES LIEUX SIGNÉ CONTRADICTOIREMENT");

    const signeParLesDeux = generateInspectionHtml({
      ...baseInspection,
      signedByManagerAt: new Date(2026, 5, 4),
      managerSignatureUrl: "https://storage.test/sig-manager.png",
      signedByTenantAt: new Date(2026, 5, 5),
      tenantSignatureUrl: "https://storage.test/sig-tenant.png",
    });
    expect(signeParLesDeux).toContain('src="https://storage.test/sig-tenant.png"');
    expect(signeParLesDeux).toContain("ÉTAT DES LIEUX SIGNÉ CONTRADICTOIREMENT");
  });
});

describe("generateCrgHtml", () => {
  const baseCrg: CrgExportData = {
    agencyName: "Agence Teranga",
    ownerName: "Fatou Diop",
    managementFeeRate: 10,
    month: 6,
    year: 2026,
    properties: [
      {
        propertyId: "prop-1",
        propertyTitle: "Villa Ngor",
        currency: "EUR",
        loyersEncaisses: 250000,
        chargesDeduites: 1234.5,
        commission: 25000,
        netAReverser: 223765.5,
      },
    ],
    totalLoyersByCurrency: { EUR: 250000 },
    totalChargesByCurrency: { EUR: 1234.5 },
    totalCommissionByCurrency: { EUR: 25000 },
    totalNetByCurrency: { EUR: 223765.5 },
  };

  /**
   * Régression : la ligne de TOTAL (une par devise, en bas du tableau)
   * concaténait charges et commission telles quelles (`1234.5 EUR`) alors que
   * les lignes PAR BIEN juste au-dessus, et les colonnes loyers/net de cette
   * même ligne de total, passaient déjà par formaterMontant (séparateur de
   * milliers, symbole de devise) — un document envoyé aux propriétaires
   * affichait donc un format différent selon la colonne.
   */
  it("formate la ligne de total (charges et commission) comme les lignes par bien, pas en chiffres bruts", () => {
    const html = generateCrgHtml(baseCrg);

    expect(html).toContain(formaterMontant(250000, "EUR"));
    expect(html).toContain(formaterMontant(1234.5, "EUR"));
    expect(html).toContain(formaterMontant(25000, "EUR"));
    expect(html).toContain(formaterMontant(223765.5, "EUR"));
    expect(html).not.toContain("1234.5 EUR");
    expect(html).not.toContain("25000 EUR");
  });
});
