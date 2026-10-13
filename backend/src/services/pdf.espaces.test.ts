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
