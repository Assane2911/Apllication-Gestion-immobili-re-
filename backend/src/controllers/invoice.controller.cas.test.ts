import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { invoicePayments, invoices } from "../db/schema";
import * as emailService from "../services/email.service";
import * as paymentService from "../services/payment.service";
import * as whatsappService from "../services/whatsapp.service";
import { authHeader, createContract, createInvoice, createManager, createProperty, createTenant, tokenFor, tokenLocataire } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Factures : filtre de la liste, refus des montants, doubles clics, paiement d'un loyer annulé ou réglé pendant l'appel
 * au prestataire, et messages renvoyés au gestionnaire par les deux rappels. Ce sont les cas où un oubli coûte de l'argent
 * (paiement compté deux fois, loyer annulé avec de l'argent perçu) ou fait croire à tort qu'un message est parti.
 */

beforeEach(() => {
  vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false } as never);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function agence(plan: "ENTERPRISE" | "STARTER" = "ENTERPRISE") {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: plan });
  const property = await createProperty(manager.id, { title: "Villa Ngor" });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow", email: "awa@example.com", phone: "+221770000001" });
  const contract = await createContract(property.id, tenant.id, { startDate: new Date(2026, 7, 1), endDate: new Date(2027, 7, 1) });
  return { manager, property, tenant, contract, h: authHeader(tokenFor(manager)) };
}
const facture = async (id: string) => (await testDb.select().from(invoices).where(eq(invoices.id, id)))[0];

describe("GET /api/invoices : filtre par statut", () => {
  it("ne renvoie que les factures du statut demandé, et ignore un statut inconnu", async () => {
    const { contract, h } = await agence();
    const payee = await createInvoice(contract.id, { periodMonth: 1, periodYear: 2026, status: "PAID", paidAt: new Date() });
    const attente = await createInvoice(contract.id, { periodMonth: 2, periodYear: 2026, status: "PENDING" });
    const retard = await createInvoice(contract.id, { periodMonth: 3, periodYear: 2026, status: "LATE" });
    const ids = (res: request.Response) => (res.body.items as Array<{ id: string }>).map((f) => f.id).sort();

    expect(ids(await request(app).get("/api/invoices?status=PAID").set(h))).toEqual([payee.id]);
    expect(ids(await request(app).get("/api/invoices?status=PENDING").set(h))).toEqual([attente.id]);
    expect(ids(await request(app).get("/api/invoices?status=LATE").set(h))).toEqual([retard.id]);
    expect(ids(await request(app).get("/api/invoices?status=N-IMPORTE-QUOI").set(h))).toEqual([payee.id, attente.id, retard.id].sort());
    expect(ids(await request(app).get("/api/invoices").set(h))).toEqual([payee.id, attente.id, retard.id].sort());
  });

  it("le filtre se combine avec le bail demandé", async () => {
    const { manager, property, tenant, contract, h } = await agence();
    const autreBail = await createContract(property.id, tenant.id, { status: "ENDED", startDate: new Date(2024, 0, 1), endDate: new Date(2025, 0, 1) });
    const voulue = await createInvoice(contract.id, { periodMonth: 1, periodYear: 2026, status: "PAID", paidAt: new Date() });
    await createInvoice(contract.id, { periodMonth: 2, periodYear: 2026, status: "PENDING" });
    await createInvoice(autreBail.id, { periodMonth: 1, periodYear: 2024, status: "PAID", paidAt: new Date() });
    void manager;

    const res = await request(app).get(`/api/invoices?status=PAID&contractId=${contract.id}`).set(h);

    expect((res.body.items as Array<{ id: string }>).map((f) => f.id)).toEqual([voulue.id]);
  });
});

describe("POST /api/invoices/:id/mark-paid : montants", () => {
  it("un montant qui s'arrondit à zéro est refusé (PAYMENT_AMOUNT_POSITIVE), rien n'est enregistré", async () => {
    const { contract, h } = await agence();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 500 });

    const res = await request(app).post(`/api/invoices/${inv.id}/mark-paid`).set(h).send({ amount: 0.001 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PAYMENT_AMOUNT_POSITIVE");
    expect((await facture(inv.id)).amountPaid).toBe(0);
    expect(await testDb.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, inv.id))).toEqual([]);
  });

  it("un montant négatif ou nul est refusé avant d'atteindre la facture", async () => {
    const { contract, h } = await agence();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 500 });

    for (const amount of [0, -50]) {
      expect((await request(app).post(`/api/invoices/${inv.id}/mark-paid`).set(h).send({ amount })).status).toBe(400);
    }
    expect((await facture(inv.id)).status).toBe("PENDING");
  });

  it("un montant supérieur au reste dû est refusé (PAYMENT_EXCEEDS_BALANCE) et dit le reste", async () => {
    const { contract, h } = await agence();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 500, amountPaid: 200 });

    const res = await request(app).post(`/api/invoices/${inv.id}/mark-paid`).set(h).send({ amount: 300.01 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PAYMENT_EXCEEDS_BALANCE");
    expect(res.body.error ?? res.body.message).toContain("300");
    expect((await facture(inv.id)).amountPaid).toBe(200);
  });

  it("un paiement exactement égal au reste dû solde la facture ; un paiement partiel la laisse en attente avec le cumul", async () => {
    const { contract, h } = await agence();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 500 });

    const partiel = await request(app).post(`/api/invoices/${inv.id}/mark-paid`).set(h).send({ amount: 200 });
    expect(partiel.status).toBe(200);
    expect(partiel.body).toMatchObject({ solde: false, resteDu: 300, montantEnregistre: 200 });
    expect(await facture(inv.id)).toMatchObject({ status: "PENDING", amountPaid: 200 });

    const reste = await request(app).post(`/api/invoices/${inv.id}/mark-paid`).set(h).send({ amount: 300 });
    expect(reste.status).toBe(200);
    expect(reste.body).toMatchObject({ solde: true, resteDu: 0, montantEnregistre: 300 });
    expect(await facture(inv.id)).toMatchObject({ status: "PAID", amountPaid: 500 });
  });
});

describe("doubles clics et requêtes simultanées", () => {
  it("deux règlements simultanés du même loyer : un seul est enregistré, l'autre est refusé", async () => {
    const { contract, h } = await agence();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 500 });

    const [a, b] = await Promise.all([request(app).post(`/api/invoices/${inv.id}/mark-paid`).set(h).send({}), request(app).post(`/api/invoices/${inv.id}/mark-paid`).set(h).send({})]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(["INVOICE_ALREADY_PAID", "INVOICE_STATE_CHANGED"]).toContain([a, b].find((r) => r.status === 409)!.body.code);
    expect(await testDb.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, inv.id))).toHaveLength(1);
    expect(await facture(inv.id)).toMatchObject({ status: "PAID", amountPaid: 500 });
  });

  it("annuler pendant qu'un paiement partiel s'enregistre : jamais les deux (l'argent perçu ne disparaît pas des encaissements)", async () => {
    const { contract, h } = await agence();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 500 });

    const [annulation, paiement] = await Promise.all([request(app).post(`/api/invoices/${inv.id}/cancel`).set(h).send({}), request(app).post(`/api/invoices/${inv.id}/mark-paid`).set(h).send({ amount: 100 })]);

    const apres = await facture(inv.id);
    const paiements = await testDb.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, inv.id));
    if (annulation.status === 200) {
      expect(apres.status).toBe("CANCELLED");
      expect(paiement.status).toBe(409);
      expect(paiements).toHaveLength(0);
    } else {
      expect(annulation.status).toBe(409);
      expect(paiement.status).toBe(200);
      expect(apres.status).toBe("PENDING");
      expect(apres.amountPaid).toBe(100);
    }
  });

  it("annuler une facture déjà partiellement réglée : refusé (INVOICE_HAS_PAYMENTS)", async () => {
    const { contract, h } = await agence();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 500, amountPaid: 100 });

    const res = await request(app).post(`/api/invoices/${inv.id}/cancel`).set(h).send({});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INVOICE_HAS_PAYMENTS");
    expect((await facture(inv.id)).status).toBe("PENDING");
  });
});

describe("POST /api/invoices/:id/pay (portail locataire) : cas limites", () => {
  it("une facture annulée ne se paie pas (INVOICE_CANCELLED), le prestataire n'est pas appelé", async () => {
    const { tenant, contract } = await agence();
    const inv = await createInvoice(contract.id, { status: "CANCELLED" });
    const initier = vi.spyOn(paymentService, "initiatePayment");

    const res = await request(app).post(`/api/invoices/${inv.id}/pay`).set(authHeader(await tokenLocataire(tenant.id))).send({ method: "DEMO" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVOICE_CANCELLED");
    expect(initier).not.toHaveBeenCalled();
    expect((await facture(inv.id)).status).toBe("CANCELLED");
  });

  it("facture réglée par un autre moyen PENDANT l'appel au prestataire : INVOICE_JUST_PAID, la référence réellement encaissée est conservée", async () => {
    const { tenant, contract } = await agence();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 500 });
    vi.spyOn(paymentService, "initiatePayment").mockImplementation(async () => {
      await testDb.update(invoices).set({ status: "PAID", paidAt: new Date(), paymentMethod: "STRIPE", paymentRef: "cs_reellement_encaisse" }).where(eq(invoices.id, inv.id));
      return { method: "BANK_TRANSFER", status: "PENDING_VALIDATION", reference: "virement-declare", message: "ok" };
    });

    const res = await request(app).post(`/api/invoices/${inv.id}/pay`).set(authHeader(await tokenLocataire(tenant.id))).send({ method: "BANK_TRANSFER", bankReference: "virement-declare" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INVOICE_JUST_PAID");
    expect(await facture(inv.id)).toMatchObject({ status: "PAID", paymentMethod: "STRIPE", paymentRef: "cs_reellement_encaisse" });
  });

  it("la réclamation de paiement est levée même quand le prestataire échoue", async () => {
    const { tenant, contract } = await agence();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 500 });
    vi.spyOn(paymentService, "initiatePayment").mockRejectedValue(new Error("prestataire indisponible"));

    const res = await request(app).post(`/api/invoices/${inv.id}/pay`).set(authHeader(await tokenLocataire(tenant.id))).send({ method: "BANK_TRANSFER", bankReference: "x" });

    expect(res.status).toBe(500);
    expect((await facture(inv.id)).paymentAttemptStartedAt).toBeNull();
  });

  it("une tentative encore en cours est refusée (PAYMENT_IN_PROGRESS), une réclamation périmée ne bloque plus", async () => {
    const { tenant, contract } = await agence();
    const enCours = await createInvoice(contract.id, { status: "PENDING", periodMonth: 1, periodYear: 2026, paymentAttemptStartedAt: new Date() });
    const perimee = await createInvoice(contract.id, { status: "PENDING", periodMonth: 2, periodYear: 2026, paymentAttemptStartedAt: new Date(Date.now() - 5 * 60_000) });
    const h = authHeader(await tokenLocataire(tenant.id));

    const bloquee = await request(app).post(`/api/invoices/${enCours.id}/pay`).set(h).send({ method: "DEMO" });
    const libre = await request(app).post(`/api/invoices/${perimee.id}/pay`).set(h).send({ method: "DEMO" });

    expect(bloquee.status).toBe(409);
    expect(bloquee.body.code).toBe("PAYMENT_IN_PROGRESS");
    expect(libre.status).toBe(200);
    expect(libre.body.invoice.status).toBe("PAID");
  });
});

describe("messages renvoyés par les rappels", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 1));
  });
  afterEach(() => vi.useRealTimers());

  const whatsappEnPanne = () => vi.spyOn(whatsappService, "envoyerMessageWhatsapp").mockResolvedValue({ simulated: false, error: true, raison: "numero_invalide" } as never);

  async function deuxLocataires(manager: { id: string }) {
    for (const [i, nom] of ["Sow", "Kane"].entries()) {
      const property = await createProperty(manager.id, { title: `Bien ${i}` });
      const tenant = await createTenant(manager.id, { firstName: "Loc", lastName: nom, email: `loc${i}@example.com`, phone: `+22177000000${i}` });
      await createContract(property.id, tenant.id, { startDate: new Date(2026, 7, 1), endDate: new Date(2027, 7, 1) });
    }
  }

  it("avis d'échéance : sans panne, le message annonce les envois réussis, sans mention WhatsApp", async () => {
    const { manager, h } = await agence();
    await deuxLocataires(manager);

    const res = await request(app).post("/api/invoices/send-monthly-reminders").set(h).send({});

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(3);
    expect(res.body.message).toBe("3 avis d'échéance envoyé(s) avec succès aux locataires.");
    expect(res.body.whatsappEchecs).toBe(0);
  });

  it("avis d'échéance : un échec WhatsApp au singulier, puis au pluriel, est dit au gestionnaire", async () => {
    const un = await agence();
    whatsappEnPanne();
    const singulier = await request(app).post("/api/invoices/send-monthly-reminders").set(un.h).send({});
    expect(singulier.body.whatsappEchecs).toBe(1);
    expect(singulier.body.message).toBe("1 avis d'échéance envoyé(s) avec succès aux locataires. (1 message WhatsApp non délivré — voir le journal d'activité)");

    const deux = await agence();
    await deuxLocataires(deux.manager);
    const pluriel = await request(app).post("/api/invoices/send-monthly-reminders").set(deux.h).send({});
    expect(pluriel.body.whatsappEchecs).toBe(3);
    expect(pluriel.body.message).toContain("(3 messages WhatsApp non délivrés — voir le journal d'activité)");
  });

  it("avis d'échéance : un envoi par e-mail en échec est annoncé comme tel, avec la promesse d'une nouvelle tentative", async () => {
    const { h } = await agence();
    vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false, error: true } as never);

    const res = await request(app).post("/api/invoices/send-monthly-reminders").set(h).send({});

    expect(res.body.echecs).toBe(1);
    expect(res.body.message).toBe("0 avis d'échéance envoyé(s), 1 en échec — ils seront retentés automatiquement.");
  });

  it("rappel manuel : message nominal, puis WhatsApp non délivré, puis e-mail en échec", async () => {
    const { contract, h } = await agence();
    const a = await createInvoice(contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING", dueDate: new Date(2026, 7, 20) });

    const nominal = await request(app).post(`/api/invoices/${a.id}/send-reminder`).set(h).send({});
    expect(nominal.body.message).toBe("Rappel d'échéance envoyé à Awa Sow (awa@example.com).");

    await testDb.update(invoices).set({ reminderSentAt: null }).where(eq(invoices.id, a.id));
    whatsappEnPanne();
    const whatsapp = await request(app).post(`/api/invoices/${a.id}/send-reminder`).set(h).send({});
    expect(whatsapp.body.message).toBe("Rappel envoyé par email à Awa Sow (awa@example.com), mais le message WhatsApp n'a pas pu être délivré.");

    await testDb.update(invoices).set({ reminderSentAt: null }).where(eq(invoices.id, a.id));
    vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false, error: true } as never);
    const email = await request(app).post(`/api/invoices/${a.id}/send-reminder`).set(h).send({});
    expect(email.body.message).toBe("L'envoi vers awa@example.com a échoué. Vérifiez l'adresse du locataire, puis réessayez.");
    expect(email.body.success).toBe(false);
  });
});
