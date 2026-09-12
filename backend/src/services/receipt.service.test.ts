import { afterEach, describe, expect, it, vi } from "vitest";
import { agencySettings } from "../db/schema";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { sendEmail } from "./email.service";
import { generateReceiptPdfBuffer } from "./pdf.service";
import { sendPaymentReceiptEmail } from "./receipt.service";

vi.mock("./pdf.service", () => ({
  generateReceiptPdfBuffer: vi.fn(),
}));
vi.mock("./email.service", () => ({
  sendEmail: vi.fn(),
}));

// sendPaymentReceiptEmail() est déclenché à chaque paiement de loyer confirmé
// (en ligne ou marqué manuellement) : c'est ce qui génère et envoie la
// quittance PDF au locataire. Il n'avait jusqu'ici aucun test, alors qu'il
// documente explicitement ne jamais devoir faire échouer le paiement lui-même
// en cas d'erreur — un contrat qui n'est jamais vérifié. On isole ici la
// logique métier propre à ce service (assemblage des données de la
// quittance, branches d'erreur, calcul de `sent`) en mockant ses deux
// dépendances (génération PDF, envoi email) : le rendu PDF réel (pdfkit) et
// le contenu détaillé des templates d'email sont couverts ailleurs.
describe("sendPaymentReceiptEmail", () => {
  afterEach(() => {
    vi.mocked(generateReceiptPdfBuffer).mockReset();
    vi.mocked(sendEmail).mockReset();
    vi.restoreAllMocks();
  });

  async function setupPaidInvoice(overrides: { tenantEmail?: string } = {}) {
    const manager = await createManager();
    const property = await createProperty(manager.id, { title: "Villa Ngor", address: "12 Corniche Ouest", surface: 120 });
    const tenant = await createTenant(manager.id, {
      firstName: "Aminata",
      lastName: "Ba",
      email: overrides.tenantEmail ?? "aminata.ba@test.local",
    });
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, {
      status: "PAID",
      periodMonth: 6,
      periodYear: 2026,
      amount: 250000,
      paidAt: new Date(2026, 5, 3),
    });
    return { manager, property, tenant, contract, invoice };
  }

  it("renvoie invoice_not_found si la facture n'existe pas", async () => {
    const result = await sendPaymentReceiptEmail("facture-inexistante");
    expect(result).toEqual({ sent: false, reason: "invoice_not_found" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("renvoie invoice_not_paid si la facture n'est pas au statut PAID", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, { status: "PENDING" });

    const result = await sendPaymentReceiptEmail(invoice.id);

    expect(result).toEqual({ sent: false, reason: "invoice_not_paid" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("renvoie no_tenant_email si le locataire n'a pas d'adresse email renseignée", async () => {
    const { invoice } = await setupPaidInvoice({ tenantEmail: "" });

    const result = await sendPaymentReceiptEmail(invoice.id);

    expect(result).toEqual({ sent: false, reason: "no_tenant_email" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("génère la quittance et envoie l'email au locataire (sent:true si réellement délivré)", async () => {
    const { invoice, tenant } = await setupPaidInvoice();
    vi.mocked(generateReceiptPdfBuffer).mockResolvedValue(Buffer.from("PDF-CONTENT"));
    vi.mocked(sendEmail).mockResolvedValue({ simulated: false, messageId: "msg-42" });

    const result = await sendPaymentReceiptEmail(invoice.id);

    expect(result.sent).toBe(true);
    expect(generateReceiptPdfBuffer).toHaveBeenCalledTimes(1);
    const receiptData = vi.mocked(generateReceiptPdfBuffer).mock.calls[0][0];
    expect(receiptData.tenant.fullName).toBe("Aminata Ba");
    expect(receiptData.invoice.amount).toBe(250000);
    expect(receiptData.receiptNumber).toMatch(/^QUITT-2026-06-[A-Z0-9]{6}$/);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [to, subject, , attachments] = vi.mocked(sendEmail).mock.calls[0];
    expect(to).toBe(tenant.email);
    expect(subject).toContain("juin 2026");
    expect(attachments?.[0].filename).toMatch(/^quittance-QUITT-2026-06-[A-Z0-9]{6}\.pdf$/);
    expect(attachments?.[0].content.toString()).toBe("PDF-CONTENT");
  });

  it("renvoie sent:false quand l'email n'a été que simulé (SMTP non configuré)", async () => {
    const { invoice } = await setupPaidInvoice();
    vi.mocked(generateReceiptPdfBuffer).mockResolvedValue(Buffer.from("PDF-CONTENT"));
    vi.mocked(sendEmail).mockResolvedValue({ simulated: true });

    const result = await sendPaymentReceiptEmail(invoice.id);

    expect(result.sent).toBe(false);
  });

  it("renvoie sent:false quand l'envoi SMTP échoue réellement", async () => {
    const { invoice } = await setupPaidInvoice();
    vi.mocked(generateReceiptPdfBuffer).mockResolvedValue(Buffer.from("PDF-CONTENT"));
    vi.mocked(sendEmail).mockResolvedValue({ simulated: false, error: true });

    const result = await sendPaymentReceiptEmail(invoice.id);

    expect(result.sent).toBe(false);
  });

  it("n'échoue jamais (renvoie sent:false, reason:error) si la génération du PDF lève une exception", async () => {
    const { invoice } = await setupPaidInvoice();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(generateReceiptPdfBuffer).mockRejectedValue(new Error("Rendu PDF impossible"));

    const result = await sendPaymentReceiptEmail(invoice.id);

    expect(result).toEqual({ sent: false, reason: "error" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("utilise les paramètres d'agence du bon gestionnaire et n'utilise pas ceux d'un autre gestionnaire", async () => {
    const managerA = await createManager();
    const managerB = await createManager();

    await testDb.insert(agencySettings).values({
      userId: managerA.id,
      agencyName: "Agence A - Luxe",
      email: "contact@agence-a.com",
    });
    await testDb.insert(agencySettings).values({
      userId: managerB.id,
      agencyName: "Agence B - Rivage",
      email: "contact@agence-b.com",
    });

    const propertyB = await createProperty(managerB.id, { title: "Appart B" });
    const tenantB = await createTenant(managerB.id, { email: "tenant.b@test.local" });
    const contractB = await createContract(propertyB.id, tenantB.id);
    const invoiceB = await createInvoice(contractB.id, {
      status: "PAID",
      amount: 150000,
      paidAt: new Date(),
    });

    vi.mocked(generateReceiptPdfBuffer).mockResolvedValue(Buffer.from("PDF-B"));
    vi.mocked(sendEmail).mockResolvedValue({ simulated: false });

    await sendPaymentReceiptEmail(invoiceB.id);

    expect(generateReceiptPdfBuffer).toHaveBeenCalledTimes(1);
    const receiptData = vi.mocked(generateReceiptPdfBuffer).mock.calls[0][0];
    expect(receiptData.agency.name).toBe("Agence B - Rivage");
    expect(receiptData.agency.email).toBe("contact@agence-b.com");
  });
});
