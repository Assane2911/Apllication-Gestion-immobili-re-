import PDFDocument from "pdfkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateFormalNoticePdfBuffer, generateReceiptPdfBuffer } from "./pdf.service";

/**
 * Intl sépare les milliers par une espace fine insécable (U+202F), que les polices standard du PDF
 * ne connaissent pas : « 250 000 FCFA » sortait « 250 /000 FCFA » sur la quittance envoyée au
 * locataire. Aucun texte écrit dans un PDF ne doit plus contenir ce caractère ; l'espace insécable
 * classique (U+00A0) le remplace, pour ne jamais couper un montant en fin de ligne.
 */
function textesEcrits() {
  const espion = vi.spyOn(PDFDocument.prototype, "text");
  return () => espion.mock.calls.map((appel) => appel[0]).filter((t): t is string => typeof t === "string");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PDF : séparateur des milliers lisible", () => {
  it("quittance : « 250 000 FCFA », sans espace fine insécable", async () => {
    const textes = textesEcrits();

    await generateReceiptPdfBuffer({
      receiptNumber: "QUITT-2026-09-ABC123",
      agency: { name: "Agence Téranga" },
      tenant: { fullName: "Awa Diop", email: "awa@test.local", phone: "+221770000000" },
      property: { title: "Appartement Plateau", address: "12 rue Carnot", surface: 70 },
      invoice: { periodMonth: 9, periodYear: 2026, amount: 250000, currency: "XOF", paidAt: new Date(2026, 8, 5), paymentMethod: "CASH" },
    });

    expect(textes().some((t) => t.includes("250\u00a0000 FCFA"))).toBe(true);
    expect(textes().filter((t) => /\u202f/.test(t))).toEqual([]);
  });

  it("mise en demeure : montants et total sans espace fine insécable", async () => {
    const textes = textesEcrits();

    await generateFormalNoticePdfBuffer({
      reference: "MED-2026-ABC123",
      createdAt: new Date(2026, 9, 12),
      deadlineDays: 8,
      currency: "XOF",
      totalDue: 450000,
      factures: [{ periodMonth: 9, periodYear: 2026, dueDate: "2026-09-05T00:00:00.000Z", amount: 450000, resteDu: 450000 }],
      destinataires: "Madame Awa DIOP",
      adresse: "12 rue Carnot, Dakar",
      propertyTitle: "Appartement Plateau",
      contractStartDate: new Date(2025, 0, 1),
      applicableLaw: null,
      garants: [],
      agency: { name: "Agence Téranga", address: null, phone: null, email: null, siretOrId: null },
    });

    expect(textes().filter((t) => t.includes("450\u00a0000 FCFA")).length).toBeGreaterThanOrEqual(2);
    expect(textes().filter((t) => /\u202f/.test(t))).toEqual([]);
    expect(textes().some((t) => t.includes("bail du 1er janvier 2025"))).toBe(true);
  });
});

describe("PDF : mise en demeure avec beaucoup de loyers impayés", () => {
  const nombreDePages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
  const courrier = (loyers: number) => ({
    reference: "MED-2026-LONG01",
    createdAt: new Date(2026, 9, 12),
    deadlineDays: 8,
    currency: "XOF",
    totalDue: loyers * 250000,
    factures: Array.from({ length: loyers }, (_, i) => ({
      periodMonth: (i % 12) + 1,
      periodYear: 2024 + Math.floor(i / 12),
      dueDate: new Date(2024 + Math.floor(i / 12), i % 12, 5).toISOString(),
      amount: 250000,
      resteDu: 250000,
    })),
    destinataires: "Madame Awa DIOP",
    adresse: "12 rue Carnot, Dakar",
    propertyTitle: "Appartement Plateau",
    contractStartDate: new Date(2024, 0, 1),
    applicableLaw: null,
    garants: [],
    agency: { name: "Agence Téranga", address: null, phone: null, email: null, siretOrId: null },
  });

  it("40 loyers impayés : le tableau passe à la page suivante au lieu d'ouvrir une page par cellule (42 pages avant)", async () => {
    const pdf = await generateFormalNoticePdfBuffer(courrier(40));

    expect(nombreDePages(pdf)).toBe(2);
  });

  it("un loyer unique tient sur une page", async () => {
    expect(nombreDePages(await generateFormalNoticePdfBuffer(courrier(1)))).toBe(1);
  });

  it("l'en-tête du tableau est repris sur la page suivante, avec le total", async () => {
    const textes = textesEcrits();

    await generateFormalNoticePdfBuffer(courrier(40));

    expect(textes().filter((t) => t === "Loyer")).toHaveLength(2);
    expect(textes().some((t) => t.includes("10 000 000 FCFA"))).toBe(true);
  });
});
