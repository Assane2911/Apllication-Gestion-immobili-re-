import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agencySettings, contractCotenants, invoicePayments, invoices, tenants } from "../db/schema";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import * as emailService from "./email.service";
import { runOverdueReminders } from "./relances.service";
import { sendPartialPaymentReceiptEmail, sendPaymentReceiptEmail } from "./receipt.service";
import { runRentDueReminders, runUpcomingRentDueReminders, sendSingleInvoiceReminder } from "./reminder.service";

vi.mock("./pdf.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./pdf.service")>()),
  generateReceiptPdfBuffer: vi.fn().mockResolvedValue(Buffer.from("pdf")),
}));

/**
 * Les e-mails qu'un locataire reçoit sans les avoir demandés (cron, action du gestionnaire) suivent la langue
 * enregistrée sur sa fiche. En colocation, chaque colocataire reçoit SA copie dans SA langue.
 */
let envoi: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const messagesVers = (adresse: string) =>
  envoi.mock.calls.filter((c: unknown[]) => c[0] === adresse).map((c: unknown[]) => ({ sujet: c[1] as string, html: c[2] as string }));

async function locataireEtColocataire(langues: { titulaire: string | null; coloc: string | null }) {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });
  const property = await createProperty(manager.id, { title: "Studio Almadies" });
  const titulaire = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow", email: "awa@test.local" });
  const coloc = await createTenant(manager.id, { firstName: "Moussa", lastName: "Fall", email: "moussa@test.local" });
  await testDb.update(tenants).set({ language: langues.titulaire }).where(eq(tenants.id, titulaire.id));
  await testDb.update(tenants).set({ language: langues.coloc }).where(eq(tenants.id, coloc.id));
  return { manager, property, titulaire, coloc };
}

describe("avis d'échéance du mois (cron)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 1)); // 1er août 2026
  });

  it("chacun reçoit l'avis dans la langue de sa fiche : titulaire en anglais, colocataire en portugais", async () => {
    const { property, titulaire, coloc } = await locataireEtColocataire({ titulaire: "en", coloc: "pt" });
    const contract = await createContract(property.id, titulaire.id, { startDate: new Date(2026, 7, 1), endDate: new Date(2027, 7, 1) });
    await testDb.insert(contractCotenants).values({ contractId: contract.id, tenantId: coloc.id });

    await runRentDueReminders();

    const [pourTitulaire] = messagesVers("awa@test.local");
    const [pourColoc] = messagesVers("moussa@test.local");
    expect(pourTitulaire.sujet).toContain("Rent due August 2026");
    expect(pourTitulaire.html).toContain("Hello <strong>Awa");
    expect(pourColoc.sujet).toContain("Vencimento do aluguel agosto 2026");
    expect(pourColoc.html).toContain("Olá <strong>Moussa");
  });

  it("une fiche sans langue (d'avant) reste en français", async () => {
    const { property, titulaire } = await locataireEtColocataire({ titulaire: null, coloc: null });
    await createContract(property.id, titulaire.id, { startDate: new Date(2026, 7, 1), endDate: new Date(2027, 7, 1) });

    await runRentDueReminders();

    expect(messagesVers("awa@test.local")[0].sujet).toContain("Échéance de loyer août 2026");
  });
});

describe("rappel avant échéance et rappel manuel", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 1));
  });

  it("rappel avant échéance : dans la langue de la fiche", async () => {
    const { property, titulaire } = await locataireEtColocataire({ titulaire: "es", coloc: null });
    const contract = await createContract(property.id, titulaire.id);
    await createInvoice(contract.id, { periodMonth: 8, periodYear: 2026, dueDate: new Date(2026, 7, 4), status: "PENDING" });

    await runUpcomingRentDueReminders();

    expect(messagesVers("awa@test.local")[0].sujet).toContain("Recordatorio: su alquiler de agosto vence en 3 día(s)");
  });

  it("rappel manuel du gestionnaire : dans la langue de la fiche", async () => {
    const { manager, property, titulaire } = await locataireEtColocataire({ titulaire: "pt", coloc: null });
    const contract = await createContract(property.id, titulaire.id);
    const facture = await createInvoice(contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING", dueDate: new Date(2026, 7, 20) });

    const res = await sendSingleInvoiceReminder(facture.id, manager.id);

    expect(res.success).toBe(true);
    expect(messagesVers("awa@test.local")[0].sujet).toContain("Vencimento do aluguel agosto 2026");
  });
});

describe("relances d'impayé", () => {
  it("la relance suit la langue de la fiche, et la copie du colocataire la sienne", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 12, 9));
    const { manager, property, titulaire, coloc } = await locataireEtColocataire({ titulaire: "en", coloc: "es" });
    await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "Agence Teranga", overdueRemindersEnabled: true });
    const contract = await createContract(property.id, titulaire.id, { status: "ACTIVE" });
    await testDb.insert(contractCotenants).values({ contractId: contract.id, tenantId: coloc.id });
    await createInvoice(contract.id, { periodMonth: 10, periodYear: 2026, amount: 500, status: "LATE", dueDate: new Date(2026, 9, 5) });

    await runOverdueReminders();

    expect(messagesVers("awa@test.local")[0].sujet).toBe("Reminder: rent not paid — October 2026");
    expect(messagesVers("moussa@test.local")[0].sujet).toBe("Recordatorio: alquiler sin pagar — octubre 2026");
  });
});

describe("quittance et reçu de paiement partiel", () => {
  async function loyer(langues: { titulaire: string | null; coloc: string | null }, statut: "PAID" | "PENDING") {
    const base = await locataireEtColocataire(langues);
    const contract = await createContract(base.property.id, base.titulaire.id);
    await testDb.insert(contractCotenants).values({ contractId: contract.id, tenantId: base.coloc.id });
    const facture = await createInvoice(contract.id, {
      periodMonth: 6,
      periodYear: 2026,
      amount: 500,
      status: statut,
      paidAt: statut === "PAID" ? new Date(2026, 5, 3) : null,
    });
    return { ...base, contract, facture };
  }

  it("la quittance part dans la langue du titulaire, pour tous les locataires du bail (pièce commune)", async () => {
    const { facture } = await loyer({ titulaire: "en", coloc: "pt" }, "PAID");

    const res = await sendPaymentReceiptEmail(facture.id);

    expect(res.sent).toBe(false); // l'envoi est simulé
    const [pourTitulaire] = messagesVers("awa@test.local");
    expect(pourTitulaire.sujet).toBe("Rent receipt — June 2026");
    expect(pourTitulaire.html).toContain("issued in French");
    // La quittance nomme tous les locataires : chacun reçoit la même, dans la langue du titulaire.
    expect(messagesVers("moussa@test.local")[0].sujet).toBe("Rent receipt — June 2026");
  });

  it("le reçu partiel part à chacun dans sa langue, avec son nom", async () => {
    const { facture } = await loyer({ titulaire: "en", coloc: "es" }, "PENDING");
    await testDb.update(invoices).set({ amountPaid: 200 }).where(eq(invoices.id, facture.id));
    const [paiement] = await testDb
      .insert(invoicePayments)
      .values({ invoiceId: facture.id, amount: 200, paymentMethod: "BANK_TRANSFER", paidAt: new Date(2026, 5, 3) })
      .returning();

    await sendPartialPaymentReceiptEmail(facture.id, paiement.id);

    const [pourTitulaire] = messagesVers("awa@test.local");
    const [pourColoc] = messagesVers("moussa@test.local");
    expect(pourTitulaire.sujet).toBe("Partial payment receipt — June 2026 rent");
    expect(pourTitulaire.html).toContain("Hello Awa");
    expect(pourTitulaire.html).toContain("Bank transfer");
    expect(pourColoc.sujet).toBe("Recibo de pago parcial — alquiler de junio 2026");
    expect(pourColoc.html).toContain("Hola Moussa");
    expect(pourColoc.html).toContain("Transferencia bancaria");
  });
});
