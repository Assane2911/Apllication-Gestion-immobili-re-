import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agencySettings, contractCotenants, invoicePayments, invoices } from "../db/schema";
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

/**
 * Quittance et reçu de paiement partiel : ce que le locataire (et ses colocataires) reçoit vraiment. Le fichier principal vérifie
 * les cas d'arrêt et l'échappement ; ici, le contenu : montants, langue, adresse de réponse de l'agence, copies aux colocataires,
 * quittance au prorata, valeurs de repli, et la règle « un échec n'est jamais bruyant ».
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

async function bail(
  opts: {
    tenant?: Parameters<typeof createTenant>[1];
    contract?: Parameters<typeof createContract>[2];
    agence?: Partial<typeof agencySettings.$inferInsert>;
  } = {}
) {
  const manager = await createManager();
  if (opts.agence) await testDb.insert(agencySettings).values({ userId: manager.id, ...opts.agence });
  const property = await createProperty(manager.id, { title: "Villa Ngor", address: "12 Corniche Ouest", surface: 120 });
  const tenant = await createTenant(manager.id, { firstName: "Aminata", lastName: "Ba", email: "aminata@test.local", ...opts.tenant });
  const contract = await createContract(property.id, tenant.id, opts.contract);
  return { manager, property, tenant, contract };
}

async function coloc(contractId: string, managerId: string, overrides: Parameters<typeof createTenant>[1] = {}) {
  const colocataire = await createTenant(managerId, { email: `coloc-${Math.random().toString(36).slice(2)}@test.local`, ...overrides });
  await testDb.insert(contractCotenants).values({ contractId, tenantId: colocataire.id });
  return colocataire;
}

async function factureSoldee(contractId: string, overrides: Partial<typeof invoices.$inferInsert> = {}) {
  return createInvoice(contractId, { status: "PAID", periodMonth: 6, periodYear: 2026, amount: 250000, paidAt: new Date(2026, 5, 3), ...overrides });
}

async function factureEnCours(contractId: string, overrides: Partial<typeof invoices.$inferInsert> = {}) {
  return createInvoice(contractId, { status: "PENDING", periodMonth: 6, periodYear: 2026, amount: 250000, ...overrides });
}

async function paiement(invoiceId: string, amount: number, extra: Partial<typeof invoicePayments.$inferInsert> = {}) {
  const [p] = await testDb
    .insert(invoicePayments)
    .values({ invoiceId, amount, paidAt: new Date(2026, 5, 3), paymentMethod: "CASH", ...extra })
    .returning();
  return p;
}

describe("quittance : ce qui part au locataire", () => {
  it("l'agence répond-à : l'e-mail porte l'adresse de contact de l'agence, jamais celle de connexion du gestionnaire", async () => {
    const { manager, contract } = await bail({ agence: { agencyName: "Agence Rivage", email: "contact@rivage.sn" } });
    const facture = await factureSoldee(contract.id);

    await sendPaymentReceiptEmail(facture.id);

    const options = vi.mocked(sendEmail).mock.calls[0][4];
    expect(options?.replyTo).toBe("contact@rivage.sn");
    expect(JSON.stringify(vi.mocked(sendEmail).mock.calls[0])).not.toContain(manager.email);
  });

  it("sans adresse de contact valide, aucune adresse de réponse n'est imposée", async () => {
    const { contract } = await bail({ agence: { agencyName: "Agence Rivage", email: "pas une adresse" } });
    const facture = await factureSoldee(contract.id);

    await sendPaymentReceiptEmail(facture.id);

    expect(vi.mocked(sendEmail).mock.calls[0][4]?.replyTo).toBeUndefined();
  });

  it("sans réglages d'agence, la quittance porte le nom de repli « Agence Immobilière » et le logo est absent", async () => {
    const { contract } = await bail();
    const facture = await factureSoldee(contract.id);

    await sendPaymentReceiptEmail(facture.id);

    const donnees = vi.mocked(generateReceiptPdfBuffer).mock.calls[0][0];
    expect(donnees.agency.name).toBe("Agence Immobilière");
    expect(donnees.agency.logoBuffer).toBeNull();
    expect(donnees.agency.stampBuffer).toBeNull();
  });

  it("les coordonnées de l'agence, du bien et du locataire arrivent sur la quittance", async () => {
    const { contract } = await bail({
      tenant: { phone: "+221770000000" },
      agence: { agencyName: "Agence Rivage", address: "5 rue du Port", phone: "+221338000000", siretOrId: "NINEA 123", legalNotice: "Mentions" },
    });
    const facture = await factureSoldee(contract.id, { paymentMethod: "MOBILE_MONEY", paymentRef: "REF-9" });

    await sendPaymentReceiptEmail(facture.id);

    const d = vi.mocked(generateReceiptPdfBuffer).mock.calls[0][0];
    expect(d.agency).toMatchObject({ name: "Agence Rivage", address: "5 rue du Port", phone: "+221338000000", siretOrId: "NINEA 123", legalNotice: "Mentions" });
    expect(d.property).toEqual({ title: "Villa Ngor", address: "12 Corniche Ouest", surface: 120 });
    expect(d.tenant).toMatchObject({ email: "aminata@test.local", phone: "+221770000000" });
    expect(d.invoice).toMatchObject({ periodMonth: 6, periodYear: 2026, amount: 250000, paymentMethod: "MOBILE_MONEY", paymentRef: "REF-9" });
  });

  it("la devise de la facture est celle de la quittance, et son e-mail", async () => {
    const { contract } = await bail();
    const facture = await factureSoldee(contract.id, { currency: "XOF" });

    await sendPaymentReceiptEmail(facture.id);

    expect(vi.mocked(generateReceiptPdfBuffer).mock.calls[0][0].invoice.currency).toBe("XOF");
    expect(vi.mocked(sendEmail).mock.calls[0][2] as string).toMatch(/250\D?000/);
  });

  it("facture payée sans date de paiement : la quittance porte la date du jour plutôt que rien", async () => {
    const { contract } = await bail();
    const facture = await factureSoldee(contract.id, { paidAt: null });
    const avant = Date.now();

    await sendPaymentReceiptEmail(facture.id);

    const paidAt = vi.mocked(generateReceiptPdfBuffer).mock.calls[0][0].invoice.paidAt;
    expect(paidAt.getTime()).toBeGreaterThanOrEqual(avant - 1000);
    expect(paidAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("un mois d'entrée en cours de mois : la quittance annonce la période réellement couverte, pas le mois entier", async () => {
    const { contract } = await bail({ contract: { startDate: new Date(2026, 5, 11), endDate: new Date(2027, 5, 30) } });
    const facture = await factureSoldee(contract.id);

    await sendPaymentReceiptEmail(facture.id);

    const { invoice } = vi.mocked(generateReceiptPdfBuffer).mock.calls[0][0];
    expect(invoice.periodStartDay).toBe(11);
    expect(invoice.periodEndDay).toBe(30);
  });

  it("un mois complet : pas de bornes de période sur la quittance", async () => {
    const { contract } = await bail({ contract: { startDate: new Date(2026, 0, 1), endDate: new Date(2027, 11, 31) } });
    const facture = await factureSoldee(contract.id);

    await sendPaymentReceiptEmail(facture.id);

    const { invoice } = vi.mocked(generateReceiptPdfBuffer).mock.calls[0][0];
    expect(invoice.periodStartDay).toBe(1);
    expect(invoice.periodEndDay).toBe(30);
  });

  it("le numéro de quittance garde le mois sur deux chiffres et les 6 derniers caractères de la facture, en majuscules", async () => {
    const { contract } = await bail();
    const facture = await factureSoldee(contract.id, { periodMonth: 3 });

    await sendPaymentReceiptEmail(facture.id);

    const numero = vi.mocked(generateReceiptPdfBuffer).mock.calls[0][0].receiptNumber;
    expect(numero).toBe(`QUITT-2026-03-${facture.id.slice(-6).toUpperCase()}`);
    expect(vi.mocked(sendEmail).mock.calls[0][3]?.[0]).toMatchObject({ filename: `quittance-${numero}.pdf`, contentType: "application/pdf" });
  });

  it("l'e-mail de quittance est dans la langue du locataire", async () => {
    const { contract } = await bail({ tenant: { language: "en" } });
    const facture = await factureSoldee(contract.id);

    await sendPaymentReceiptEmail(facture.id);

    const sujet = vi.mocked(sendEmail).mock.calls[0][1];
    expect(sujet).not.toMatch(/quittance/i);
    expect(sujet).toMatch(/June 2026/);
  });

  it("une quittance en cas d'échec d'envoi à un destinataire : l'erreur n'est jamais levée et la raison est « error »", async () => {
    const { contract } = await bail();
    const facture = await factureSoldee(contract.id);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("SMTP coupé"));

    await expect(sendPaymentReceiptEmail(facture.id)).resolves.toEqual({ sent: false, reason: "error" });
  });
});

describe("quittance en colocation", () => {
  it("la quittance nomme tous les locataires du bail, et chacun reçoit la même pièce jointe", async () => {
    const { manager, contract, tenant } = await bail({ tenant: { civility: "MME", firstName: "Awa", lastName: "Sow" } });
    const c1 = await coloc(contract.id, manager.id, { civility: "M", firstName: "Moussa", lastName: "Diop" });
    const facture = await factureSoldee(contract.id);

    await sendPaymentReceiptEmail(facture.id);

    const donnees = vi.mocked(generateReceiptPdfBuffer).mock.calls[0][0];
    expect(donnees.tenant.fullName).toContain("Awa Sow");
    expect(donnees.tenant.fullName).toContain("Moussa Diop");
    expect(donnees.tenant.fullName).toContain(" et ");

    const envois = vi.mocked(sendEmail).mock.calls;
    expect(envois.map((c) => c[0]).sort()).toEqual([tenant.email, c1.email].sort());
    for (const [, sujet, , pieces] of envois) {
      expect(sujet).toBe(envois[0][1]);
      expect(pieces?.[0].filename).toBe(envois[0][3]?.[0].filename);
    }
  });

  it("un colocataire sans e-mail est sauté, un anonymisé n'est plus nommé ni écrit", async () => {
    const { manager, contract, tenant } = await bail();
    await coloc(contract.id, manager.id, { email: "" });
    await coloc(contract.id, manager.id, { firstName: "Efface", lastName: "Moi", email: "efface@test.local", anonymizedAt: new Date() });
    const facture = await factureSoldee(contract.id);

    await sendPaymentReceiptEmail(facture.id);

    expect(vi.mocked(sendEmail).mock.calls.map((c) => c[0])).toEqual([tenant.email]);
    expect(vi.mocked(generateReceiptPdfBuffer).mock.calls[0][0].tenant.fullName).not.toContain("Efface");
  });

  it("l'échec d'une copie à un colocataire n'empêche pas l'envoi au titulaire ni aux autres", async () => {
    const { manager, contract, tenant } = await bail();
    const fautif = await coloc(contract.id, manager.id);
    const autre = await coloc(contract.id, manager.id);
    const facture = await factureSoldee(contract.id);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(sendEmail).mockImplementation(async (to: string) => {
      if (to === fautif.email) throw new Error("boîte pleine");
      return { simulated: false };
    });

    const resultat = await sendPaymentReceiptEmail(facture.id);

    expect(resultat.sent).toBe(true);
    const destinataires = vi.mocked(sendEmail).mock.calls.map((c) => c[0]);
    expect(destinataires).toContain(tenant.email);
    expect(destinataires).toContain(autre.email);
  });
});

describe("reçu de paiement partiel", () => {
  it("une facture inconnue, déjà soldée ou annulée ne donne pas de reçu partiel (ce serait une quittance)", async () => {
    const { contract } = await bail();
    const soldee = await factureSoldee(contract.id, { periodMonth: 1 });
    const annulee = await factureEnCours(contract.id, { periodMonth: 2, status: "CANCELLED" });
    const p1 = await paiement(soldee.id, 100);
    const p2 = await paiement(annulee.id, 100);

    expect(await sendPartialPaymentReceiptEmail("inconnue", "x")).toEqual({ sent: false, reason: "invoice_not_found" });
    expect(await sendPartialPaymentReceiptEmail(soldee.id, p1.id)).toEqual({ sent: false, reason: "invoice_not_partial" });
    expect(await sendPartialPaymentReceiptEmail(annulee.id, p2.id)).toEqual({ sent: false, reason: "invoice_not_partial" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("un paiement inconnu, ou celui d'une AUTRE facture, ne donne pas de reçu", async () => {
    const { contract } = await bail();
    const facture = await factureEnCours(contract.id, { periodMonth: 4 });
    const autreFacture = await factureEnCours(contract.id, { periodMonth: 5 });
    const paiementAutre = await paiement(autreFacture.id, 50000);

    expect(await sendPartialPaymentReceiptEmail(facture.id, "paiement-inconnu")).toEqual({ sent: false, reason: "payment_not_found" });
    expect(await sendPartialPaymentReceiptEmail(facture.id, paiementAutre.id)).toEqual({ sent: false, reason: "payment_not_found" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("un locataire sans e-mail n'en reçoit pas", async () => {
    const { contract } = await bail({ tenant: { email: "" } });
    const facture = await factureEnCours(contract.id);
    const p = await paiement(facture.id, 100000);

    expect(await sendPartialPaymentReceiptEmail(facture.id, p.id)).toEqual({ sent: false, reason: "no_tenant_email" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("le reçu annonce le montant encaissé, le déjà réglé et le reste dû, sans pièce jointe, à l'adresse de réponse de l'agence", async () => {
    const { contract, tenant } = await bail({ agence: { agencyName: "Agence Rivage", email: "contact@rivage.sn" }, tenant: { civility: "MME", firstName: "Awa", lastName: "Sow" } });
    const facture = await factureEnCours(contract.id, { amount: 250000, amountPaid: 100000, currency: "XOF" });
    const p = await paiement(facture.id, 100000, { paymentMethod: "MOBILE_MONEY" });

    const resultat = await sendPartialPaymentReceiptEmail(facture.id, p.id);

    expect(resultat.sent).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [to, sujet, html, pieces, options] = vi.mocked(sendEmail).mock.calls[0];
    expect(to).toBe(tenant.email);
    expect(sujet).toContain("Reçu de paiement partiel");
    expect(sujet).toContain("juin 2026");
    expect(pieces).toBeUndefined();
    expect(options?.replyTo).toBe("contact@rivage.sn");
    const texte = (html as string).replace(/\s| | /g, "");
    expect(texte).toContain("100000"); // encaissé, et déjà réglé
    expect(texte).toContain("250000"); // loyer
    expect(texte).toContain("150000"); // reste dû
    expect(html).toContain("Awa Sow");
    expect(html).toContain("Villa Ngor");
    expect(html).toContain("Agence Rivage");
    expect(html).toContain("et non une quittance");
  });

  it("après un second paiement, le reçu reprend le cumul réglé et le reste, pas seulement le dernier versement", async () => {
    const { contract } = await bail();
    const facture = await factureEnCours(contract.id, { amount: 300, amountPaid: 200, currency: "EUR" });
    await paiement(facture.id, 120);
    const dernier = await paiement(facture.id, 80);

    await sendPartialPaymentReceiptEmail(facture.id, dernier.id);

    const html = vi.mocked(sendEmail).mock.calls[0][2] as string;
    const sansEspaces = html.replace(/\s| | /g, "");
    // La phrase « paiement de X » annonce CE versement (80), pas le cumul (200) ni le loyer (300).
    const encaisse = /paiementde<strong>([^<]*)<\/strong>/.exec(sansEspaces)?.[1] ?? "";
    expect(encaisse).toContain("80");
    expect(encaisse).not.toContain("200");
    expect(encaisse).not.toContain("300");
    expect(sansEspaces).toContain("200"); // déjà réglé : 120 + 80
    expect(sansEspaces).toContain("100"); // reste : 300 - 200
  });

  it("le reçu est écrit dans la langue du locataire", async () => {
    const { contract } = await bail({ tenant: { language: "en" } });
    const facture = await factureEnCours(contract.id, { amountPaid: 1000 });
    const p = await paiement(facture.id, 1000);

    await sendPartialPaymentReceiptEmail(facture.id, p.id);

    const [, sujet, html] = vi.mocked(sendEmail).mock.calls[0];
    expect(sujet).not.toContain("Reçu");
    expect(html).not.toContain("Reste à payer");
  });

  it("chaque colocataire reçoit le reçu à SON nom et dans SA langue", async () => {
    const { manager, contract, tenant } = await bail({ tenant: { civility: "MME", firstName: "Awa", lastName: "Sow" } });
    const c = await coloc(contract.id, manager.id, { civility: "M", firstName: "Moussa", lastName: "Diop", language: "en" });
    const facture = await factureEnCours(contract.id, { amountPaid: 1000 });
    const p = await paiement(facture.id, 1000);

    await sendPartialPaymentReceiptEmail(facture.id, p.id);

    const envois = new Map(vi.mocked(sendEmail).mock.calls.map((a) => [a[0], a]));
    expect(envois.size).toBe(2);
    const titulaire = envois.get(tenant.email!)!;
    const colocataire = envois.get(c.email!)!;
    expect(titulaire[2]).toContain("Awa Sow");
    expect(titulaire[2]).not.toContain("Moussa");
    expect(colocataire[2]).toContain("Moussa Diop");
    expect(colocataire[2]).not.toContain("Awa");
    expect(titulaire[1]).toContain("Reçu");
    expect(colocataire[1]).not.toContain("Reçu");
  });

  it("un échec d'envoi n'est jamais bruyant : la raison est « error » et l'erreur est journalisée", async () => {
    const { contract } = await bail();
    const facture = await factureEnCours(contract.id, { amountPaid: 1000 });
    const p = await paiement(facture.id, 1000);
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("SMTP coupé"));

    await expect(sendPartialPaymentReceiptEmail(facture.id, p.id)).resolves.toEqual({ sent: false, reason: "error" });
    expect(erreur).toHaveBeenCalledTimes(1);
  });

  it("envoi seulement simulé (SMTP non configuré) ou refusé : sent vaut false", async () => {
    const { contract } = await bail();
    const facture = await factureEnCours(contract.id, { amountPaid: 1000 });
    const p = await paiement(facture.id, 1000);

    vi.mocked(sendEmail).mockResolvedValueOnce({ simulated: true });
    expect((await sendPartialPaymentReceiptEmail(facture.id, p.id)).sent).toBe(false);

    vi.mocked(sendEmail).mockResolvedValueOnce({ simulated: false, error: true });
    expect((await sendPartialPaymentReceiptEmail(facture.id, p.id)).sent).toBe(false);
  });
});
