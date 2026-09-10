import { describe, expect, it } from "vitest";
import { generateLeaseHtml, generateReceiptHtml, generateReceiptPdfBuffer, ReceiptData } from "./pdf.service";

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
    expect(html).toContain("250000 XOF");
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
    expect(html).toContain("250000 XOF");
    expect(html).toContain("500000 XOF");
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

    expect(html).toContain("250000 EUR");
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
