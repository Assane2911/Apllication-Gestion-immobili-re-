import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { activityLogs, invoicePayments, invoices } from "../db/schema";
import * as receiptService from "../services/receipt.service";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createProperty,
  createTenant,
  tokenFor,
  tokenLocataire,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Paiements partiels. Une facture n'était que « tout ou rien » : un loyer payé
 * en plusieurs fois ne pouvait pas être suivi, et le gestionnaire devait choisir
 * entre ne rien enregistrer et tout déclarer réglé.
 */
async function facture(montant = 500, overrides: Parameters<typeof createInvoice>[1] = {}) {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id);
  const invoice = await createInvoice(contract.id, { status: "PENDING", amount: montant, ...overrides });
  return { manager, tenant, invoice };
}

const payer = (manager: { id: string }, id: string, corps: Record<string, unknown>) =>
  request(app).post(`/api/invoices/${id}/mark-paid`).set(authHeader(tokenFor(manager as never))).send(corps);

const relire = async (id: string) => (await testDb.select().from(invoices).where(eq(invoices.id, id)))[0];
const paiements = (id: string) => testDb.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, id));

describe("paiement partiel", () => {
  it("enregistre un acompte : la facture reste en attente, le reste dû est calculé", async () => {
    const { manager, invoice } = await facture(500);
    const res = await payer(manager, invoice.id, { amount: 300, paymentMethod: "CASH" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "PENDING", solde: false, montantEnregistre: 300, resteDu: 200, amountPaid: 300 });
    const apres = await relire(invoice.id);
    expect(apres.status).toBe("PENDING");
    expect(apres.paidAt).toBeNull();
    expect(apres.amountPaid).toBe(300);
    const lignes = await paiements(invoice.id);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ amount: 300, paymentMethod: "CASH" });
  });

  it("solde la facture au dernier paiement, datée de ce dernier paiement, avec son moyen", async () => {
    const { manager, invoice } = await facture(500);
    await payer(manager, invoice.id, { amount: 300, paymentMethod: "CASH", paidAt: "2026-09-02" });
    const res = await payer(manager, invoice.id, { amount: 200, paymentMethod: "MOBILE_MONEY", paidAt: "2026-09-20", paymentRef: "MM-77" });

    expect(res.body).toMatchObject({ status: "PAID", solde: true, resteDu: 0 });
    const apres = await relire(invoice.id);
    expect(apres.status).toBe("PAID");
    expect(apres.amountPaid).toBe(500);
    expect(apres.paidAt?.toISOString()).toBe("2026-09-20T12:00:00.000Z");
    expect(apres.paymentMethod).toBe("MOBILE_MONEY");
    expect(apres.paymentRef).toBe("MM-77");
    expect((await paiements(invoice.id)).map((p: { amount: number }) => p.amount).sort()).toEqual([200, 300]);
  });

  it("sans montant : règle le reste dû (comportement d'avant pour une facture sans acompte)", async () => {
    const { manager, invoice } = await facture(500);
    const res = await payer(manager, invoice.id, {});
    expect(res.body).toMatchObject({ status: "PAID", solde: true, montantEnregistre: 500 });

    const b = await facture(500);
    await payer(b.manager, b.invoice.id, { amount: 120 });
    const reste = await payer(b.manager, b.invoice.id, {});
    expect(reste.body).toMatchObject({ status: "PAID", montantEnregistre: 380 });
  });

  it("refuse un montant nul, négatif ou supérieur au reste dû, sans rien écrire", async () => {
    const { manager, invoice } = await facture(500);
    await payer(manager, invoice.id, { amount: 300 });

    for (const amount of [0, -5, 200.01, 9999]) {
      const res = await payer(manager, invoice.id, { amount });
      expect(res.status, String(amount)).toBe(400);
    }
    expect((await relire(invoice.id)).amountPaid).toBe(300);
    expect(await paiements(invoice.id)).toHaveLength(1);
  });

  it("n'accumule pas d'erreur de virgule flottante (0,1 + 0,2 solde 0,3)", async () => {
    const { manager, invoice } = await facture(0.3);
    await payer(manager, invoice.id, { amount: 0.1 });
    const res = await payer(manager, invoice.id, { amount: 0.2 });
    expect(res.body).toMatchObject({ status: "PAID", solde: true });
  });

  it("une facture en retard le reste après un acompte", async () => {
    const { manager, invoice } = await facture(500, { status: "LATE", dueDate: new Date(Date.now() - 20 * 86_400_000) });
    const res = await payer(manager, invoice.id, { amount: 100 });
    expect(res.body.status).toBe("LATE");
    expect(res.body.resteDu).toBe(400);
  });

  it("deux paiements simultanés ne dépassent jamais le montant de la facture", async () => {
    const { manager, invoice } = await facture(500);
    const reponses = await Promise.all([300, 300].map((amount) => payer(manager, invoice.id, { amount })));

    expect(reponses.map((r) => r.status).sort()).toEqual([200, 400]);
    const apres = await relire(invoice.id);
    expect(apres.amountPaid).toBe(300);
    expect(await paiements(invoice.id)).toHaveLength(1);
  });

  it("n'envoie la quittance qu'une fois la facture soldée", async () => {
    const envoi = vi.spyOn(receiptService, "sendPaymentReceiptEmail").mockResolvedValue(undefined as never);
    const { manager, invoice } = await facture(500);

    await payer(manager, invoice.id, { amount: 300 });
    expect(envoi).not.toHaveBeenCalled();

    await payer(manager, invoice.id, { amount: 200 });
    expect(envoi).toHaveBeenCalledTimes(1);
    envoi.mockRestore();
  });

  it("journalise le paiement partiel avec le reste dû", async () => {
    const { manager, invoice } = await facture(500);
    await payer(manager, invoice.id, { amount: 300, paymentMethod: "CHEQUE" });
    const [journal] = await testDb.select().from(activityLogs).where(eq(activityLogs.entityId, invoice.id));
    expect(journal.details).toContain("Paiement partiel de 300");
    expect(journal.details).toContain("reste 200");
    expect(journal.details).toContain("Chèque");
  });

  it("refuse d'annuler une facture sur laquelle de l'argent a été encaissé", async () => {
    const { manager, invoice } = await facture(500);
    await payer(manager, invoice.id, { amount: 100 });
    const res = await request(app).post(`/api/invoices/${invoice.id}/cancel`).set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(409);
    expect((await relire(invoice.id)).status).toBe("PENDING");
  });

  it("refuse un paiement sur une facture déjà réglée ou d'un autre gestionnaire", async () => {
    const a = await facture(500);
    await payer(a.manager, a.invoice.id, {});
    expect((await payer(a.manager, a.invoice.id, { amount: 10 })).status).toBe(409);

    const b = await facture(500);
    expect((await payer(a.manager, b.invoice.id, { amount: 10 })).status).toBe(404);
  });
});

describe("listes de factures", () => {
  it("le gestionnaire voit montant réglé et reste dû, y compris pour une facture réglée d'un coup avant cette évolution", async () => {
    const { manager, invoice } = await facture(500);
    await payer(manager, invoice.id, { amount: 300 });
    // Facture réglée « à l'ancienne » : PAYÉE, sans paiement ni amountPaid.
    const ancienne = await createInvoice(invoice.contractId, {
      status: "PAID", amount: 400, periodMonth: 2, periodYear: 2026, paidAt: new Date(2026, 1, 5), paymentMethod: "BANK_TRANSFER",
    });

    const res = await request(app).get("/api/invoices").set(authHeader(tokenFor(manager)));
    const lignes = Object.fromEntries(res.body.items.map((i: { id: string }) => [i.id, i]));
    expect(lignes[invoice.id]).toMatchObject({ montantRegle: 300, resteDu: 200 });
    expect(lignes[ancienne.id]).toMatchObject({ montantRegle: 400, resteDu: 0, amountPaid: 0 });
  });

  it("le locataire voit son reste dû", async () => {
    const { manager, tenant, invoice } = await facture(500);
    await payer(manager, invoice.id, { amount: 300 });
    const jeton = await tokenLocataire(tenant.id);

    const liste = await request(app).get("/api/invoices/mine").set(authHeader(jeton));
    expect(liste.body[0]).toMatchObject({ montantRegle: 300, resteDu: 200 });
  });
});
