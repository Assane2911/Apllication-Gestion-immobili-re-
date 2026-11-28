import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { activityLogs, contractCotenants, invoicePayments, invoices } from "../db/schema";
import * as compteService from "../services/comptePaiementAgence.service";
import * as emailService from "../services/email.service";
import * as paymentService from "../services/payment.service";
import * as receiptService from "../services/receipt.service";
import * as whatsappService from "../services/whatsapp.service";
import { authHeader, createContract, createInvoice, createManager, createProperty, createTenant, tokenFor, tokenLocataire } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Audit par sabotage de invoice.controller.ts : ce que les tests de chaque route ne vérifiaient pas. La liste (ordre, pages, total,
 * champs du locataire), les codes d'erreur propres à chaque refus, les plafonds de la saisie manuelle, l'arrondi des cumuls,
 * les champs que seul le règlement d'un SOLDE écrit sur la facture, le fait qu'une quittance qui ne part pas ne fait pas échouer
 * l'encaissement, et le contenu du journal d'activité (type, libellé, devise, montants).
 */
beforeEach(() => {
  vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false } as never);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function agence(opts: { devise?: string } = {}) {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
  const property = await createProperty(manager.id, { title: "Villa Ngor" });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow", email: "awa@example.com", phone: "+221770000001" });
  const contract = await createContract(property.id, tenant.id, { startDate: new Date(2026, 5, 1), endDate: new Date(2027, 5, 1), ...(opts.devise ? { currency: opts.devise } : {}) });
  return { manager, property, tenant, contract, h: authHeader(tokenFor(manager)) };
}
const facture = async (id: string) => (await testDb.select().from(invoices).where(eq(invoices.id, id)))[0];
const paiements = (id: string) => testDb.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, id));
const journal = (id: string) => testDb.select().from(activityLogs).where(eq(activityLogs.entityId, id));
const marquer = (h: Record<string, string>, id: string, corps: object = {}) => request(app).post(`/api/invoices/${id}/mark-paid`).set(h).send(corps);
const annuler = (h: Record<string, string>, id: string) => request(app).post(`/api/invoices/${id}/cancel`).set(h).send({});

/** Fait arriver un changement dans la base JUSTE avant l'ouverture de la transaction de règlement : la course que deux onglets provoquent. */
function avantTransaction(action: () => Promise<unknown>) {
  const reel = testDb.transaction.bind(testDb);
  vi.spyOn(testDb, "transaction").mockImplementation(async (fn: unknown) => {
    await action();
    return reel(fn);
  });
}

/** Fait arriver un changement dans la base entre la lecture de la facture et l'écriture de son annulation. */
function avantEcritureAnnulation(action: () => Promise<unknown>) {
  const reel = testDb.update.bind(testDb);
  let fait = false;
  vi.spyOn(testDb, "update").mockImplementation((table: unknown) => {
    const constructeur = reel(table);
    if (fait) return constructeur;
    fait = true;
    return {
      set: (valeurs: unknown) => {
        const etape = constructeur.set(valeurs);
        return {
          where: (condition: unknown) => {
            const ecriture = etape.where(condition);
            return { returning: () => ({ then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => action().then(() => ecriture.returning()).then(ok, ko) }) };
          },
        };
      },
    };
  });
}

describe("GET /api/invoices : ordre, pages, total", () => {
  it("les factures les plus récentes d'abord : l'année décide, puis le mois", async () => {
    const { contract, h } = await agence();
    const a = await createInvoice(contract.id, { periodYear: 2025, periodMonth: 6 });
    const b = await createInvoice(contract.id, { periodYear: 2026, periodMonth: 3 });
    const c = await createInvoice(contract.id, { periodYear: 2025, periodMonth: 12 });
    const d = await createInvoice(contract.id, { periodYear: 2026, periodMonth: 1 });

    const res = await request(app).get("/api/invoices").set(h);

    expect((res.body.items as Array<{ id: string }>).map((f) => f.id)).toEqual([b.id, d.id, c.id, a.id]);
  });

  it("une page à la fois : la taille demandée est respectée, la 2e page reprend où la 1re s'arrête, le total est celui de toute la liste", async () => {
    const { contract, h } = await agence();
    const toutes = [];
    for (let mois = 1; mois <= 5; mois++) toutes.push(await createInvoice(contract.id, { periodYear: 2026, periodMonth: mois }));
    const recentes = [...toutes].reverse().map((f) => f.id);

    const page1 = await request(app).get("/api/invoices?pageSize=2&page=1").set(h);
    const page2 = await request(app).get("/api/invoices?pageSize=2&page=2").set(h);
    const page3 = await request(app).get("/api/invoices?pageSize=2&page=3").set(h);

    expect((page1.body.items as Array<{ id: string }>).map((f) => f.id)).toEqual(recentes.slice(0, 2));
    expect((page2.body.items as Array<{ id: string }>).map((f) => f.id)).toEqual(recentes.slice(2, 4));
    expect((page3.body.items as Array<{ id: string }>).map((f) => f.id)).toEqual(recentes.slice(4, 5));
    for (const page of [page1, page2, page3]) {
      expect(page.body.total).toBe(5);
      expect(page.body.totalPages).toBe(3);
      expect(page.body.pageSize).toBe(2);
    }
  });

  it("le total ne compte que les factures de ce gestionnaire, et suit le filtre demandé", async () => {
    const { contract, h } = await agence();
    await createInvoice(contract.id, { periodMonth: 1, status: "PAID", paidAt: new Date() });
    await createInvoice(contract.id, { periodMonth: 2, status: "PENDING" });
    await createInvoice(contract.id, { periodMonth: 3, status: "PENDING" });
    const autre = await agence();
    await createInvoice(autre.contract.id, { periodMonth: 1, status: "PENDING" });
    await createInvoice(autre.contract.id, { periodMonth: 2, status: "PENDING" });

    const toutes = await request(app).get("/api/invoices").set(h);
    const enAttente = await request(app).get("/api/invoices?status=PENDING").set(h);

    expect(toutes.body.total).toBe(3);
    expect(toutes.body.items).toHaveLength(3);
    expect(enAttente.body.total).toBe(2);
    expect(enAttente.body.items).toHaveLength(2);
  });

  it("un identifiant de bail vide est refusé (400) au lieu d'être pris pour « pas de filtre »", async () => {
    const { h } = await agence();

    const res = await request(app).get("/api/invoices?contractId=").set(h);

    expect(res.status).toBe(400);
  });

  it("chaque facture porte le nom, l'e-mail ET le téléphone du locataire, et le titre du bien", async () => {
    const { contract, h } = await agence();
    await createInvoice(contract.id, {});

    const res = await request(app).get("/api/invoices").set(h);

    const { tenant, property } = res.body.items[0].contract;
    expect(tenant).toMatchObject({ firstName: "Awa", lastName: "Sow", email: "awa@example.com", phone: "+221770000001" });
    expect(property).toMatchObject({ title: "Villa Ngor" });
  });
});

describe("POST /api/invoices/:id/mark-paid : plafonds de la saisie", () => {
  it("une référence de 200 caractères est acceptée, une de 201 est refusée ; les espaces autour sont retirés", async () => {
    const { contract, h } = await agence();
    const a = await createInvoice(contract.id, { periodMonth: 1, amount: 100 });
    const b = await createInvoice(contract.id, { periodMonth: 2, amount: 100 });
    const c = await createInvoice(contract.id, { periodMonth: 3, amount: 100 });

    const ok = await marquer(h, a.id, { paymentRef: "x".repeat(200) });
    const trop = await marquer(h, b.id, { paymentRef: "x".repeat(201) });
    const rognee = await marquer(h, c.id, { paymentRef: "  CHQ-42  " });

    expect(ok.status).toBe(200);
    expect(trop.status).toBe(400);
    expect((await facture(b.id)).status).toBe("PENDING");
    expect(rognee.body.paymentRef).toBe("CHQ-42");
  });

  it("une date d'encaissement vide (null) est acceptée : c'est le jour de l'enregistrement", async () => {
    const { contract, h } = await agence();
    const inv = await createInvoice(contract.id, { amount: 100 });

    const res = await marquer(h, inv.id, { paidAt: null });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PAID");
  });
});

describe("POST /api/invoices/:id/mark-paid : un refus dit LAQUELLE des situations s'applique", () => {
  it("une facture réglée : INVOICE_ALREADY_PAID ; une facture annulée : INVOICE_CANCELLED_LOCKED ; rien n'est enregistré", async () => {
    const { contract, h } = await agence();
    const payee = await createInvoice(contract.id, { periodMonth: 1, status: "PAID", paidAt: new Date(), amountPaid: 500 });
    const annulee = await createInvoice(contract.id, { periodMonth: 2, status: "CANCELLED" });

    const a = await marquer(h, payee.id);
    const b = await marquer(h, annulee.id);

    expect([a.status, a.body.code]).toEqual([409, "INVOICE_ALREADY_PAID"]);
    expect([b.status, b.body.code]).toEqual([409, "INVOICE_CANCELLED_LOCKED"]);
    expect(await paiements(payee.id)).toEqual([]);
    expect(await paiements(annulee.id)).toEqual([]);
  });

  it("facture réglée par quelqu'un d'autre ENTRE la lecture et l'enregistrement : INVOICE_STATE_CHANGED, aucun paiement en double", async () => {
    const { contract, h } = await agence();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 500 });
    avantTransaction(() => testDb.update(invoices).set({ status: "PAID", amountPaid: 500, paidAt: new Date() }).where(eq(invoices.id, inv.id)));

    const res = await marquer(h, inv.id);

    expect([res.status, res.body.code]).toEqual([409, "INVOICE_STATE_CHANGED"]);
    expect(await paiements(inv.id)).toEqual([]);
  });

  it("facture supprimée ENTRE la lecture et l'enregistrement : INVOICE_STATE_CHANGED, et non une erreur serveur", async () => {
    const { contract, h } = await agence();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 500 });
    avantTransaction(() => testDb.delete(invoices).where(eq(invoices.id, inv.id)));

    const res = await marquer(h, inv.id);

    expect([res.status, res.body.code]).toEqual([409, "INVOICE_STATE_CHANGED"]);
  });

  it("un dépassement du reste dû dit le reste ET la devise de la facture", async () => {
    const { contract, h } = await agence();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 500, amountPaid: 200, currency: "XOF" });

    const res = await marquer(h, inv.id, { amount: 301 });

    expect([res.status, res.body.code]).toEqual([400, "PAYMENT_EXCEEDS_BALANCE"]);
    expect(res.body.error).toContain("(300 XOF)");
    expect(res.body.params).toEqual({ amount: 300, currency: "XOF" });
  });
});

describe("POST /api/invoices/:id/mark-paid : ce qui est écrit, et sur quelle facture", () => {
  it("le cumul est arrondi au centime : 0,1 puis 0,2 donnent 0,3 et non 0,30000000000000004", async () => {
    const { contract, h } = await agence();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 1 });

    await marquer(h, inv.id, { amount: 0.1 });
    const res = await marquer(h, inv.id, { amount: 0.2 });

    expect(res.body).toMatchObject({ solde: false, resteDu: 0.7 });
    expect((await facture(inv.id)).amountPaid).toBe(0.3);
  });

  it("une facture dont le montant a des millièmes est soldée en réglant son reste dû (arrondi au centime)", async () => {
    const { contract, h } = await agence();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 100.004 });

    const res = await marquer(h, inv.id);

    expect(res.body.solde).toBe(true);
    expect(await facture(inv.id)).toMatchObject({ status: "PAID", amountPaid: 100 });
  });

  it("un paiement partiel n'écrit que le cumul : ni moyen ni référence sur la facture, mais sur la LIGNE de paiement", async () => {
    const { contract, h } = await agence();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 500 });

    await marquer(h, inv.id, { amount: 200, paymentMethod: "CHEQUE", paymentRef: "CHQ-42" });

    expect(await facture(inv.id)).toMatchObject({ status: "PENDING", amountPaid: 200, paymentMethod: null, paymentRef: null, paidAt: null });
    const [ligne] = await paiements(inv.id);
    expect(ligne).toMatchObject({ amount: 200, paymentMethod: "CHEQUE", paymentRef: "CHQ-42" });
  });

  it("le règlement du solde écrit le moyen, la référence et la date sur la facture ET sur la ligne de paiement", async () => {
    const { contract, h } = await agence();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 500 });

    await marquer(h, inv.id, { paymentMethod: "MOBILE_MONEY", paymentRef: "WAVE-9", paidAt: "2026-06-03" });

    const apres = await facture(inv.id);
    expect(apres).toMatchObject({ status: "PAID", amountPaid: 500, paymentMethod: "MOBILE_MONEY", paymentRef: "WAVE-9" });
    expect(apres.paidAt?.toISOString().slice(0, 10)).toBe("2026-06-03");
    const [ligne] = await paiements(inv.id);
    expect(ligne).toMatchObject({ amount: 500, paymentMethod: "MOBILE_MONEY", paymentRef: "WAVE-9" });
  });

  it("enregistrer un règlement ne touche à aucune AUTRE facture", async () => {
    const { contract, h } = await agence();
    const cible = await createInvoice(contract.id, { periodMonth: 1, status: "PENDING", amount: 500 });
    const autre = await createInvoice(contract.id, { periodMonth: 2, status: "PENDING", amount: 500 });

    await marquer(h, cible.id, { amount: 200 });
    await marquer(h, cible.id);

    expect(await facture(autre.id)).toMatchObject({ status: "PENDING", amountPaid: 0, paymentMethod: null, paymentRef: null, paidAt: null });
    expect(await paiements(autre.id)).toEqual([]);
  });

  it("une quittance qui ne part pas ne fait pas échouer l'encaissement (solde comme paiement partiel)", async () => {
    const { contract, h } = await agence();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 500 });
    vi.spyOn(receiptService, "sendPaymentReceiptEmail").mockRejectedValue(new Error("smtp en panne"));
    vi.spyOn(receiptService, "sendPartialPaymentReceiptEmail").mockRejectedValue(new Error("smtp en panne"));

    const partiel = await marquer(h, inv.id, { amount: 200 });
    const solde = await marquer(h, inv.id);

    expect(partiel.status).toBe(200);
    expect(solde.status).toBe(200);
    expect((await facture(inv.id)).status).toBe("PAID");
  });

  it("une date d'encaissement saisie pour une facture ANCIENNE est jugée par rapport à son échéance, pas à aujourd'hui", async () => {
    const { contract, h } = await agence();
    const echeance = new Date(Date.now() - 2 * 365 * 86_400_000);
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 500, dueDate: echeance });
    const jour = new Date(echeance.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);

    const res = await marquer(h, inv.id, { paidAt: jour });

    expect(res.status).toBe(200);
    expect((await facture(inv.id)).paidAt?.toISOString().slice(0, 10)).toBe(jour);
  });
});

describe("journal d'activité : type, libellé, montants et devise", () => {
  it("facture soldée : le journal dit qui, quel bien, quelle période, quel montant, dans quelle devise, par quel moyen", async () => {
    const { contract, h } = await agence();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 500, currency: "XOF", periodMonth: 6, periodYear: 2026 });

    await marquer(h, inv.id);

    const [ligne] = await journal(inv.id);
    expect(ligne).toMatchObject({ action: "invoice.mark_paid", entityType: "invoice", entityLabel: "Awa Sow — Villa Ngor" });
    expect(ligne.details).toBe("Facture 6/2026 marquée réglée (500 XOF, Espèces)");
  });

  it("paiement partiel : le montant encaissé et le reste, dans la devise de la facture", async () => {
    const { contract, h } = await agence();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 500, currency: "XOF", periodMonth: 6, periodYear: 2026 });

    await marquer(h, inv.id, { amount: 200 });

    const [ligne] = await journal(inv.id);
    expect(ligne.details).toBe("Paiement partiel de 200 XOF sur la facture 6/2026 (reste 300 XOF, Espèces)");
  });

  it("sans date saisie, le journal ne mentionne pas de date d'encaissement ; avec une autre date, il la donne", async () => {
    const { contract, h } = await agence();
    const a = await createInvoice(contract.id, { periodMonth: 1, status: "PENDING", amount: 500 });
    const b = await createInvoice(contract.id, { periodMonth: 2, status: "PENDING", amount: 500 });

    await marquer(h, a.id);
    await marquer(h, b.id, { paidAt: "2026-06-03" });

    expect((await journal(a.id))[0].details).not.toContain("encaissé");
    expect((await journal(b.id))[0].details).toBe("Facture 2/2026 marquée réglée (500 EUR, Espèces), encaissée le 2026-06-03)".replace("), encaissée", ", encaissée"));
  });

  it("l'annulation est journalisée avec le type d'entité, le libellé et le détail de la période", async () => {
    const { contract, h } = await agence();
    const inv = await createInvoice(contract.id, { status: "PENDING", periodMonth: 6, periodYear: 2026 });

    await annuler(h, inv.id);

    const [ligne] = await journal(inv.id);
    expect(ligne).toMatchObject({ action: "invoice.cancel", entityType: "invoice", entityLabel: "Facture 6/2026", details: "Facture 6/2026 annulée" });
  });
});

describe("POST /api/invoices/:id/cancel", () => {
  it("une facture réglée ne s'annule pas : INVOICE_PAID_NO_CANCEL, et elle reste réglée", async () => {
    const { contract, h } = await agence();
    const inv = await createInvoice(contract.id, { status: "PAID", paidAt: new Date(), amountPaid: 500 });

    const res = await annuler(h, inv.id);

    expect([res.status, res.body.code]).toEqual([409, "INVOICE_PAID_NO_CANCEL"]);
    expect((await facture(inv.id)).status).toBe("PAID");
  });

  it("annuler une facture n'en annule aucune autre", async () => {
    const { contract, h } = await agence();
    const cible = await createInvoice(contract.id, { periodMonth: 1, status: "PENDING" });
    const autre = await createInvoice(contract.id, { periodMonth: 2, status: "LATE" });
    const etrangere = await agence();
    const dautrui = await createInvoice(etrangere.contract.id, { status: "PENDING" });

    const res = await annuler(h, cible.id);

    expect(res.status).toBe(200);
    expect((await facture(cible.id)).status).toBe("CANCELLED");
    expect((await facture(autre.id)).status).toBe("LATE");
    expect((await facture(dautrui.id)).status).toBe("PENDING");
  });

  it("facture réglée par quelqu'un d'autre ENTRE la lecture et l'annulation : INVOICE_STATE_CHANGED, elle reste réglée", async () => {
    const { contract, h } = await agence();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 500 });
    avantEcritureAnnulation(() => testDb.update(invoices).set({ status: "PAID", paidAt: new Date() }).where(eq(invoices.id, inv.id)));

    const res = await annuler(h, inv.id);

    expect([res.status, res.body.code]).toEqual([409, "INVOICE_STATE_CHANGED"]);
    expect((await facture(inv.id)).status).toBe("PAID");
  });
});

describe("GET /api/invoices/mine : factures du locataire", () => {
  it("les plus récentes d'abord, avec le reste dû, le montant réglé et le titre du bien ; jamais celles d'un autre bail", async () => {
    const { tenant, contract, property } = await agence();
    const a = await createInvoice(contract.id, { periodYear: 2025, periodMonth: 6, amount: 500 });
    const b = await createInvoice(contract.id, { periodYear: 2026, periodMonth: 3, amount: 500, amountPaid: 200 });
    const c = await createInvoice(contract.id, { periodYear: 2025, periodMonth: 12, amount: 500 });
    const d = await createInvoice(contract.id, { periodYear: 2026, periodMonth: 1, amount: 500 });
    const autre = await agence();
    await createInvoice(autre.contract.id, { periodYear: 2026, periodMonth: 5 });

    const res = await request(app).get("/api/invoices/mine").set(authHeader(await tokenLocataire(tenant.id)));

    expect((res.body as Array<{ id: string }>).map((f) => f.id)).toEqual([b.id, d.id, c.id, a.id]);
    expect(res.body[0]).toMatchObject({ montantRegle: 200, resteDu: 300 });
    expect(res.body[0].contract.property).toMatchObject({ id: property.id, title: "Villa Ngor" });
  });
});

describe("POST /api/invoices/:id/pay : ce qui part vers le prestataire", () => {
  const demande = (token: string, id: string, corps: object) => request(app).post(`/api/invoices/${id}/pay`).set(authHeader(token)).send(corps);
  const enAttente = (methode = "PAYDUNYA", reference = "tok_1") => ({ method: methode, status: "REQUIRES_ACTION", reference, redirectUrl: "https://prestataire.example/checkout", message: "ok" }) as never;

  async function locataire() {
    const base = await agence();
    return { ...base, token: await tokenLocataire(base.tenant.id) };
  }

  it("le prestataire reçoit le RESTE dû, la devise et le numéro de CETTE facture, l'usage « loyer », l'e-mail du payeur et le retour au portail", async () => {
    const { manager, tenant, contract, token } = await locataire();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 500, amountPaid: 200, currency: "XOF" });
    const compte = { identifiants: "compte-agence", nomAgence: "Agence", managerId: manager.id } as never;
    const charger = vi.spyOn(compteService, "chargerCompteEncaissant").mockResolvedValue(compte);
    const initier = vi.spyOn(paymentService, "initiatePayment").mockResolvedValue(enAttente());

    const res = await demande(token, inv.id, { method: "PAYDUNYA" });

    expect(res.status).toBe(200);
    expect(charger).toHaveBeenCalledWith(tenant.managerId);
    expect(initier).toHaveBeenCalledTimes(1);
    expect(initier).toHaveBeenCalledWith({
      compteAgence: compte,
      method: "PAYDUNYA",
      amount: 300,
      currency: "XOF",
      invoiceId: inv.id,
      usage: "LOYER",
      payerEmail: "awa@example.com",
      returnPath: "/portail/paiements",
    });
  });

  it("le compte de l'agence n'est cherché que pour PayDunya : Stripe et la démonstration partent sans compte d'agence", async () => {
    const { contract, token } = await locataire();
    const a = await createInvoice(contract.id, { periodMonth: 1, status: "PENDING" });
    const b = await createInvoice(contract.id, { periodMonth: 2, status: "PENDING" });
    const charger = vi.spyOn(compteService, "chargerCompteEncaissant");
    const initier = vi.spyOn(paymentService, "initiatePayment").mockResolvedValue(enAttente("STRIPE", "cs_1"));

    await demande(token, a.id, { method: "STRIPE" });
    await demande(token, b.id, { method: "DEMO" });

    expect(charger).not.toHaveBeenCalled();
    expect(initier.mock.calls.map(([p]) => [p.method, p.compteAgence])).toEqual([["STRIPE", null], ["DEMO", null]]);
  });

  it("un colocataire paie avec SON adresse e-mail, pas celle du titulaire", async () => {
    const { manager, contract } = await agence();
    const coloc = await createTenant(manager.id, { firstName: "Binta", lastName: "Kane", email: "binta@example.com" });
    await testDb.insert(contractCotenants).values({ contractId: contract.id, tenantId: coloc.id });
    const inv = await createInvoice(contract.id, { status: "PENDING" });
    const initier = vi.spyOn(paymentService, "initiatePayment").mockResolvedValue(enAttente("STRIPE", "cs_1"));

    await demande(await tokenLocataire(coloc.id), inv.id, { method: "STRIPE" });

    expect(initier.mock.calls[0][0].payerEmail).toBe("binta@example.com");
  });

  it("réglage en attente : le moyen et la référence DU PRESTATAIRE sont notés sur cette facture seule, sans quittance, et la réponse porte la facture et le paiement", async () => {
    const { contract, token } = await locataire();
    const inv = await createInvoice(contract.id, { periodMonth: 1, status: "PENDING" });
    const autre = await createInvoice(contract.id, { periodMonth: 2, status: "PENDING" });
    vi.spyOn(paymentService, "initiatePayment").mockResolvedValue(enAttente("STRIPE", "cs_session"));
    const quittance = vi.spyOn(receiptService, "sendPaymentReceiptEmail");

    const res = await demande(token, inv.id, { method: "PAYDUNYA" });

    expect(res.body.invoice).toMatchObject({ id: inv.id, status: "PENDING", paymentMethod: "STRIPE", paymentRef: "cs_session" });
    expect(res.body.payment).toMatchObject({ reference: "cs_session", redirectUrl: "https://prestataire.example/checkout" });
    expect(await facture(autre.id)).toMatchObject({ paymentMethod: null, paymentRef: null });
    expect(quittance).not.toHaveBeenCalled();
  });

  it("réglé sur le champ (démonstration) : la facture est soldée avec le moyen et la référence du prestataire, et UNE quittance part", async () => {
    const { contract, token } = await locataire();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 500 });
    vi.spyOn(paymentService, "initiatePayment").mockResolvedValue({ method: "DEMO", status: "PAID", reference: "demo_7", message: "ok" } as never);
    const quittance = vi.spyOn(receiptService, "sendPaymentReceiptEmail").mockResolvedValue({ sent: true } as never);

    const res = await demande(token, inv.id, { method: "DEMO" });

    expect(res.status).toBe(200);
    expect(res.body.invoice).toMatchObject({ id: inv.id, status: "PAID" });
    expect(await facture(inv.id)).toMatchObject({ status: "PAID", paymentMethod: "DEMO", paymentRef: "demo_7", amountPaid: 500 });
    expect(quittance).toHaveBeenCalledTimes(1);
    expect(quittance).toHaveBeenCalledWith(inv.id);
  });

  it("réglé sur le champ : le moyen noté sur la facture est celui que renvoie le prestataire, pas celui qu'on suppose", async () => {
    const { contract, token } = await locataire();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 500 });
    vi.spyOn(paymentService, "initiatePayment").mockResolvedValue({ method: "PAYDUNYA", status: "PAID", reference: "pd_1", message: "ok" } as never);
    vi.spyOn(receiptService, "sendPaymentReceiptEmail").mockResolvedValue({ sent: true } as never);

    await demande(token, inv.id, { method: "PAYDUNYA" });

    expect(await facture(inv.id)).toMatchObject({ status: "PAID", paymentMethod: "PAYDUNYA", paymentRef: "pd_1" });
  });

  it("une quittance qui ne part pas ne fait pas échouer le paiement", async () => {
    const { contract, token } = await locataire();
    const inv = await createInvoice(contract.id, { status: "PENDING", amount: 500 });
    vi.spyOn(paymentService, "initiatePayment").mockResolvedValue({ method: "DEMO", status: "PAID", reference: "demo_8", message: "ok" } as never);
    vi.spyOn(receiptService, "sendPaymentReceiptEmail").mockRejectedValue(new Error("smtp en panne"));

    const res = await demande(token, inv.id, { method: "DEMO" });

    expect(res.status).toBe(200);
    expect((await facture(inv.id)).status).toBe("PAID");
  });

  it("la marque « paiement en cours » est posée PENDANT l'appel au prestataire, levée ensuite, et seulement sur cette facture", async () => {
    const { contract, token } = await locataire();
    const inv = await createInvoice(contract.id, { periodMonth: 1, status: "PENDING" });
    const marquee = new Date(Date.now() - 1000);
    const autre = await createInvoice(contract.id, { periodMonth: 2, status: "PENDING", paymentAttemptStartedAt: marquee });
    let pendantAppel: Date | null = null;
    vi.spyOn(paymentService, "initiatePayment").mockImplementation(async () => {
      pendantAppel = (await facture(inv.id)).paymentAttemptStartedAt;
      return enAttente();
    });

    await demande(token, inv.id, { method: "PAYDUNYA" });

    expect(pendantAppel).toBeInstanceOf(Date);
    expect((await facture(inv.id)).paymentAttemptStartedAt).toBeNull();
    expect((await facture(autre.id)).paymentAttemptStartedAt?.getTime()).toBe(marquee.getTime());
  });

  it("refus avant tout appel : facture inconnue (404), facture d'un autre locataire (404 même avec un corps invalide), moyen non permis (400), facture réglée (INVOICE_ALREADY_PAID)", async () => {
    const { contract, token } = await locataire();
    const etranger = await agence();
    const sienne = await createInvoice(contract.id, { periodMonth: 1, status: "PENDING" });
    const reglee = await createInvoice(contract.id, { periodMonth: 2, status: "PAID", paidAt: new Date(), amountPaid: 500 });
    const dautrui = await createInvoice(etranger.contract.id, { status: "PENDING" });
    const initier = vi.spyOn(paymentService, "initiatePayment").mockResolvedValue(enAttente());

    const inconnue = await demande(token, "00000000-0000-4000-8000-000000000000", { method: "DEMO" });
    const etrangere = await demande(token, dautrui.id, { method: "CASH" });
    const cash = await demande(token, sienne.id, { method: "CASH" });
    const payee = await demande(token, reglee.id, { method: "DEMO" });

    expect([inconnue.status, inconnue.body.code]).toEqual([404, "INVOICE_NOT_FOUND"]);
    expect([etrangere.status, etrangere.body.code]).toEqual([404, "INVOICE_NOT_FOUND"]);
    expect(cash.status).toBe(400);
    expect([payee.status, payee.body.code]).toEqual([409, "INVOICE_ALREADY_PAID"]);
    expect(initier).not.toHaveBeenCalled();
  });
});

describe("rappels : portée et réponse", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 1));
  });
  afterEach(() => vi.useRealTimers());

  const whatsappEnPanne = () => vi.spyOn(whatsappService, "envoyerMessageWhatsapp").mockResolvedValue({ simulated: false, error: true, raison: "numero_invalide" } as never);

  it("les avis d'échéance ne partent que pour les locataires du gestionnaire qui les déclenche", async () => {
    const a = await agence();
    const b = await agence();
    const envoyer = vi.mocked(emailService.sendEmail);

    const res = await request(app).post("/api/invoices/send-monthly-reminders").set(a.h).send({});

    expect(res.body.sent).toBe(1);
    expect(envoyer.mock.calls.map((appel) => appel[0])).toEqual(["awa@example.com"]);
    expect(await testDb.select().from(invoices).where(eq(invoices.contractId, b.contract.id))).toEqual([]);
  });

  it("la réponse annonce le succès, le détail par locataire, et le compte des envois, échecs et échecs WhatsApp", async () => {
    const { h } = await agence();

    const res = await request(app).post("/api/invoices/send-monthly-reminders").set(h).send({});

    expect(res.body).toMatchObject({ success: true, sent: 1, echecs: 0, whatsappEchecs: 0 });
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it("deux messages WhatsApp non délivrés : le pluriel s'accorde (« 2 messages … non délivrés »)", async () => {
    const { manager, h } = await agence();
    const property = await createProperty(manager.id, { title: "Bien 2" });
    const tenant = await createTenant(manager.id, { firstName: "Loc", lastName: "Kane", email: "loc@example.com", phone: "+221770000009" });
    await createContract(property.id, tenant.id, { startDate: new Date(2026, 7, 1), endDate: new Date(2027, 7, 1) });
    whatsappEnPanne();

    const res = await request(app).post("/api/invoices/send-monthly-reminders").set(h).send({});

    expect(res.body.whatsappEchecs).toBe(2);
    expect(res.body.message).toContain("(2 messages WhatsApp non délivrés — voir le journal d'activité)");
  });

  it("un e-mail en échec pour l'un et un WhatsApp en échec pour l'autre : le message dit les deux", async () => {
    const { manager, h } = await agence();
    const property = await createProperty(manager.id, { title: "Bien 2" });
    const tenant = await createTenant(manager.id, { firstName: "Loc", lastName: "Kane", email: "loc@example.com", phone: "+221770000009" });
    await createContract(property.id, tenant.id, { startDate: new Date(2026, 7, 1), endDate: new Date(2027, 7, 1) });
    vi.spyOn(emailService, "sendEmail").mockImplementation((async (destinataire: string) => (destinataire === "awa@example.com" ? { simulated: false, error: true } : { simulated: false })) as never);
    whatsappEnPanne();

    const res = await request(app).post("/api/invoices/send-monthly-reminders").set(h).send({});

    expect(res.body).toMatchObject({ sent: 1, echecs: 1, whatsappEchecs: 1 });
    expect(res.body.message).toBe("1 avis d'échéance envoyé(s), 1 en échec — ils seront retentés automatiquement. (1 message WhatsApp non délivré — voir le journal d'activité)");
  });
});
