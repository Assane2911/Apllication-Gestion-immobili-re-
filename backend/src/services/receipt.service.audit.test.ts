import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agencySettings, invoicePayments } from "../db/schema";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { sendEmail } from "./email.service";
import { generateReceiptPdfBuffer } from "./pdf.service";
import { sendPartialPaymentReceiptEmail, sendPaymentReceiptEmail } from "./receipt.service";
import { oublierAdressesDeReponse } from "./reponseAgence.service";

vi.mock("./pdf.service", () => ({ generateReceiptPdfBuffer: vi.fn() }));
vi.mock("./email.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./email.service")>()),
  sendEmail: vi.fn(),
}));
// Le stockage est simulé : chaque adresse d'image rend un contenu qui porte cette adresse, pour savoir QUELLE image va OÙ.
vi.mock("./storage.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./storage.service")>()),
  chargerLogoAgence: vi.fn(async (url: string | null | undefined) => (url ? Buffer.from(`image:${url}`) : null)),
}));

/**
 * Audit par sabotage de receipt.service.ts : ce que les tests existants laissaient passer — quel logo va sur quelle ligne de la
 * quittance, et les valeurs de repli quand le bien ou la facture ont un champ vide (titre, surface, devise), pour la quittance
 * comme pour le reçu de paiement partiel.
 */
beforeEach(() => {
  oublierAdressesDeReponse();
  vi.mocked(generateReceiptPdfBuffer).mockResolvedValue(Buffer.from("PDF"));
  vi.mocked(sendEmail).mockResolvedValue({ simulated: false, messageId: "m1" });
});
afterEach(() => {
  vi.mocked(generateReceiptPdfBuffer).mockReset();
  vi.mocked(sendEmail).mockReset();
  vi.restoreAllMocks();
});

async function bail(opts: { bien?: Parameters<typeof createProperty>[1]; agence?: Partial<typeof agencySettings.$inferInsert> } = {}) {
  const manager = await createManager();
  if (opts.agence) await testDb.insert(agencySettings).values({ userId: manager.id, ...opts.agence });
  const property = await createProperty(manager.id, { title: "Villa Ngor", address: "12 Corniche Ouest", surface: 120, ...opts.bien });
  const tenant = await createTenant(manager.id, { firstName: "Aminata", lastName: "Ba", email: "aminata@test.local" });
  const contract = await createContract(property.id, tenant.id);
  return { manager, property, tenant, contract };
}

describe("quittance : logo et tampon", () => {
  it("le logo arrive sur la ligne du logo, le tampon sur celle du tampon — jamais l'un pour l'autre", async () => {
    const { contract } = await bail({
      agence: { agencyName: "Agence Rivage", logoUrl: "https://stockage.test/logo.png", stampOrSignatureUrl: "https://stockage.test/tampon.png" },
    });
    const facture = await createInvoice(contract.id, { status: "PAID", periodMonth: 6, periodYear: 2026, amount: 250000, paidAt: new Date(2026, 5, 3) });

    await sendPaymentReceiptEmail(facture.id);

    const { agency } = vi.mocked(generateReceiptPdfBuffer).mock.calls[0][0];
    expect(agency.logoUrl).toBe("https://stockage.test/logo.png");
    expect(agency.stampUrl).toBe("https://stockage.test/tampon.png");
    expect(agency.logoBuffer?.toString()).toBe("image:https://stockage.test/logo.png");
    expect(agency.stampBuffer?.toString()).toBe("image:https://stockage.test/tampon.png");
  });

  it("un tampon sans logo (ou l'inverse) ne remplit que sa propre ligne", async () => {
    const { contract } = await bail({ agence: { agencyName: "Agence Rivage", stampOrSignatureUrl: "https://stockage.test/tampon.png" } });
    const facture = await createInvoice(contract.id, { status: "PAID", periodMonth: 6, periodYear: 2026, amount: 250000, paidAt: new Date(2026, 5, 3) });

    await sendPaymentReceiptEmail(facture.id);

    const { agency } = vi.mocked(generateReceiptPdfBuffer).mock.calls[0][0];
    expect(agency.logoBuffer).toBeNull();
    expect(agency.stampBuffer?.toString()).toBe("image:https://stockage.test/tampon.png");
  });
});

describe("quittance : valeurs de repli", () => {
  it("un bien sans titre devient « Logement », sans surface devient 0, une facture sans devise devient l'euro", async () => {
    const { contract } = await bail({ bien: { title: "", surface: 0 } });
    const facture = await createInvoice(contract.id, { status: "PAID", periodMonth: 6, periodYear: 2026, amount: 250000, paidAt: new Date(2026, 5, 3), currency: "" });

    await sendPaymentReceiptEmail(facture.id);

    const donnees = vi.mocked(generateReceiptPdfBuffer).mock.calls[0][0];
    expect(donnees.property.title).toBe("Logement");
    expect(donnees.property.surface).toBe(0);
    expect(donnees.invoice.currency).toBe("EUR");
  });

  it("l'e-mail de quittance porte le titre de repli et la devise de repli", async () => {
    const { contract } = await bail({ bien: { title: "" } });
    const facture = await createInvoice(contract.id, { status: "PAID", periodMonth: 6, periodYear: 2026, amount: 1500, paidAt: new Date(2026, 5, 3), currency: "" });

    await sendPaymentReceiptEmail(facture.id);

    const html = vi.mocked(sendEmail).mock.calls[0][2] as string;
    expect(html).toContain("Logement");
    expect(html).toContain("€");
    expect(html).not.toContain("FCFA");
  });
});

describe("reçu de paiement partiel : valeurs de repli et date", () => {
  async function recu(overrides: { bien?: Parameters<typeof createProperty>[1]; currency?: string } = {}) {
    const { contract } = await bail({ bien: overrides.bien });
    const facture = await createInvoice(contract.id, { status: "PENDING", periodMonth: 6, periodYear: 2026, amount: 1000, currency: overrides.currency });
    const [paiement] = await testDb
      .insert(invoicePayments)
      .values({ invoiceId: facture.id, amount: 400, paidAt: new Date(2026, 5, 3), paymentMethod: "CASH" })
      .returning();
    const res = await sendPartialPaymentReceiptEmail(facture.id, paiement.id);
    expect(res.sent).toBe(true);
    return vi.mocked(sendEmail).mock.calls[0][2] as string;
  }

  it("annonce la date du paiement encaissé, et non celle d'un autre jour", async () => {
    const html = await recu();
    expect(html).toContain("03/06/2026");
    expect(html).not.toContain("01/01/1970");
  });

  it("un bien sans titre devient « Logement » dans le reçu", async () => {
    const html = await recu({ bien: { title: "" } });
    expect(html).toContain("<strong>Logement</strong>");
  });

  it("une facture sans devise est annoncée en euros, jamais en francs CFA", async () => {
    const html = await recu({ currency: "" });
    expect(html).toContain("400 €");
    expect(html).not.toContain("FCFA");
  });

  it("la devise de la facture est respectée quand elle existe", async () => {
    const html = await recu({ currency: "XOF" });
    expect(html).toContain("FCFA");
    expect(html).not.toContain("400 €");
  });
});
