import crypto from "crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { invoices, platformSubscriptions, users } from "../db/schema";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

// Doit correspondre exactement à PAYDUNYA_MASTER_KEY forcée dans setupTestDb.ts
// (valeur de test fixe, sans rapport avec une vraie clé PayDunya).
const TEST_MASTER_KEY = "test-paydunya-master-key-do-not-use-in-production";
const VALID_HASH = crypto.createHash("sha512").update(TEST_MASTER_KEY).digest("hex");

function ipnBody(overrides: { hash?: string; token?: string; reference?: string }) {
  return {
    data: JSON.stringify({
      status: "completed",
      hash: overrides.hash ?? VALID_HASH,
      invoice: { token: overrides.token ?? "pd_token_default" },
      custom_data: { reference: overrides.reference ?? "" },
    }),
  };
}

/**
 * Mocke la confirmation serveur-à-serveur (confirmerAupresDePaydunya) : c'est
 * désormais elle, et non plus le corps de l'IPN, qui fait foi pour le statut
 * et le montant — voir paydunya.controller.ts.
 */
function mockConfirmation(overrides: { status?: string; totalAmount?: number | string; reference?: string } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      response_code: "00",
      status: overrides.status ?? "completed",
      invoice: { total_amount: overrides.totalAmount },
      custom_data: { reference: overrides.reference },
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("POST /api/payments/paydunya/ipn", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("confirme le paiement d'une facture sur une notification authentique confirmée par PayDunya", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, {
      status: "PENDING",
      paymentMethod: "PAYDUNYA",
      paymentRef: "pd_token_abc123",
    });

    const fetchMock = mockConfirmation({ totalAmount: invoice.amount, reference: invoice.id });

    const res = await request(app)
      .post("/api/payments/paydunya/ipn")
      .send(ipnBody({ token: "pd_token_abc123", reference: invoice.id }));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/checkout-invoice/confirm/pd_token_abc123"),
      expect.objectContaining({ headers: expect.objectContaining({ "PAYDUNYA-MASTER-KEY": TEST_MASTER_KEY }) })
    );

    const [updated] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(updated.status).toBe("PAID");
    expect(updated.paidAt).not.toBeNull();
  });

  it("confirme le paiement d'un abonnement SaaS quand la référence commence par 'sub_' : historique ET accès du compte activés", async () => {
    const manager = await createManager({ subscriptionStatus: "EXPIRED" });
    const [subscription] = await testDb
      .insert(platformSubscriptions)
      .values({
        userId: manager.id,
        plan: "STARTER",
        amount: 15,
        status: "PENDING",
        paymentMethod: "PAYDUNYA",
        paymentRef: "pd_token_sub456",
        startDate: new Date(2026, 5, 1),
        endDate: new Date(2026, 6, 1),
      })
      .returning();

    mockConfirmation({ totalAmount: subscription.amount, reference: `sub_${manager.id}_123456` });

    const res = await request(app)
      .post("/api/payments/paydunya/ipn")
      .send(ipnBody({ token: "pd_token_sub456", reference: `sub_${manager.id}_123456` }));

    expect(res.status).toBe(200);

    const [updated] = await testDb
      .select()
      .from(platformSubscriptions)
      .where(eq(platformSubscriptions.id, subscription.id));
    expect(updated.status).toBe("PAID");

    // L'historique de paiement ne suffit pas : l'accès du compte doit aussi
    // être réellement débloqué (régression corrigée par
    // subscriptionActivation.service.ts, voir son commentaire).
    const [updatedManager] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(updatedManager.subscriptionStatus).toBe("ACTIVE");
    expect(updatedManager.subscriptionPlan).toBe("STARTER");
    expect(updatedManager.subscriptionEndsAt).not.toBeNull();
  });

  it("rejette une notification dont le hash de signature est invalide, sans même appeler PayDunya", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, {
      status: "PENDING",
      paymentMethod: "PAYDUNYA",
      paymentRef: "pd_token_falsifie",
    });

    const fetchMock = mockConfirmation();

    const res = await request(app)
      .post("/api/payments/paydunya/ipn")
      .send(ipnBody({ hash: "un-hash-invente-par-un-attaquant", token: "pd_token_falsifie", reference: invoice.id }));

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();

    const [stillPending] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(stillPending.status).toBe("PENDING");
  });

  it("n'effectue aucune mise à jour si PayDunya confirme un statut différent de 'completed'", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, {
      status: "PENDING",
      paymentMethod: "PAYDUNYA",
      paymentRef: "pd_token_encours",
    });

    mockConfirmation({ status: "pending", totalAmount: invoice.amount, reference: invoice.id });

    const res = await request(app)
      .post("/api/payments/paydunya/ipn")
      .send(ipnBody({ token: "pd_token_encours", reference: invoice.id }));

    expect(res.status).toBe(200);
    const [stillPending] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(stillPending.status).toBe("PENDING");
  });

  it("rejette la confirmation si le montant réellement confirmé par PayDunya ne correspond pas au montant attendu (paiement partiel/incorrect)", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, {
      status: "PENDING",
      paymentMethod: "PAYDUNYA",
      paymentRef: "pd_token_montant_incorrect",
      amount: 500,
    });

    mockConfirmation({ totalAmount: 100, reference: invoice.id });

    const res = await request(app)
      .post("/api/payments/paydunya/ipn")
      .send(ipnBody({ token: "pd_token_montant_incorrect", reference: invoice.id }));

    expect(res.status).toBe(200);

    const [stillPending] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(stillPending.status).toBe("PENDING");
    expect(stillPending.paidAt).toBeNull();
  });

  /**
   * Le hash de l'IPN (voir isAuthentic) prouve seulement la connaissance de
   * la master key, jamais que CE statut ni CE montant du corps POSTÉ
   * viennent réellement de PayDunya — n'importe qui le connaissant pourrait
   * fabriquer un statut "completed" et un montant de son choix. Sans la
   * confirmation serveur-à-serveur, une IPN authentique mais fabriquée avec
   * un montant mensonger aurait quand même soldé la facture.
   */
  it("ne fait pas confiance au statut/montant du corps POSTÉ : seule la confirmation PayDunya décide", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, {
      status: "PENDING",
      paymentMethod: "PAYDUNYA",
      paymentRef: "pd_token_corps_mensonger",
      amount: 500,
    });

    // Le corps POSTÉ prétend un statut/montant complets et corrects (comme le
    // ferait un attaquant connaissant le hash), mais PayDunya confirme un
    // montant différent : c'est la confirmation qui doit décider.
    mockConfirmation({ status: "completed", totalAmount: 1, reference: invoice.id });

    const res = await request(app).post("/api/payments/paydunya/ipn").send({
      data: JSON.stringify({
        status: "completed",
        hash: VALID_HASH,
        invoice: { token: "pd_token_corps_mensonger", total_amount: 500 },
        custom_data: { reference: invoice.id },
      }),
    });

    expect(res.status).toBe(200);
    const [stillPending] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(stillPending.status).toBe("PENDING");
  });

  it("renvoie 502 et ne crédite rien si PayDunya ne peut pas être contacté pour confirmer", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, {
      status: "PENDING",
      paymentMethod: "PAYDUNYA",
      paymentRef: "pd_token_panne_reseau",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );

    const res = await request(app)
      .post("/api/payments/paydunya/ipn")
      .send(ipnBody({ token: "pd_token_panne_reseau", reference: invoice.id }));

    expect(res.status).toBe(502);
    const [stillPending] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(stillPending.status).toBe("PENDING");
  });

  it("ignore la confirmation si la référence renvoyée par PayDunya ne correspond pas à celle reçue dans l'IPN", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, {
      status: "PENDING",
      paymentMethod: "PAYDUNYA",
      paymentRef: "pd_token_reference_divergente",
    });

    mockConfirmation({ totalAmount: invoice.amount, reference: "une-autre-facture-id" });

    const res = await request(app)
      .post("/api/payments/paydunya/ipn")
      .send(ipnBody({ token: "pd_token_reference_divergente", reference: invoice.id }));

    expect(res.status).toBe(200);
    const [stillPending] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(stillPending.status).toBe("PENDING");
  });

  it("renvoie 400 si le corps ne contient aucun champ 'data' exploitable", async () => {
    const res = await request(app).post("/api/payments/paydunya/ipn").send({ n_importe_quoi: true });

    expect(res.status).toBe(400);
  });

  /**
   * Régression : contrairement au webhook Stripe (qui traitait au moins le
   * cas PAID en no-op) et à markInvoicePaid/cancelInvoice, cette IPN
   * n'inspectait AUCUN statut courant avant d'écrire — une facture CANCELLED
   * pouvait être ressuscitée en PAID par une confirmation arrivée après
   * l'annulation.
   */
  it("ne ressuscite pas une facture annulée sur une IPN de confirmation", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, {
      status: "CANCELLED",
      paymentMethod: "PAYDUNYA",
      paymentRef: "pd_token_annulee",
    });

    mockConfirmation({ totalAmount: invoice.amount, reference: invoice.id });

    const res = await request(app)
      .post("/api/payments/paydunya/ipn")
      .send(ipnBody({ token: "pd_token_annulee", reference: invoice.id }));

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(apres.status).toBe("CANCELLED");
    expect(apres.paidAt).toBeNull();
  });

  /**
   * Régression : sans aucune garde d'état, une IPN rejouée (PayDunya rejoue
   * en cas de doute réseau) sur une facture déjà PAID écrasait silencieusement
   * paidAt et renvoyait une SECONDE quittance au locataire pour le même loyer.
   */
  it("n'écrase pas paidAt et ne renvoie pas de seconde quittance sur une IPN rejouée pour une facture déjà payée", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const paidAtOrigine = new Date(2026, 5, 1, 10, 0, 0);
    const invoice = await createInvoice(contract.id, {
      status: "PAID",
      paidAt: paidAtOrigine,
      paymentMethod: "PAYDUNYA",
      paymentRef: "pd_token_rejeu",
    });

    mockConfirmation({ totalAmount: invoice.amount, reference: invoice.id });

    const res = await request(app)
      .post("/api/payments/paydunya/ipn")
      .send(ipnBody({ token: "pd_token_rejeu", reference: invoice.id }));

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(apres.status).toBe("PAID");
    expect(apres.paidAt?.getTime()).toBe(paidAtOrigine.getTime());
  });
});
