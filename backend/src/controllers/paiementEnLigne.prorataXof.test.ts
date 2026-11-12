import crypto from "crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { invoicePayments, invoices } from "../db/schema";
import * as emailService from "../services/email.service";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

// Valeurs de test forcées dans setupTestDb.ts (sans rapport avec de vraies clés).
const SECRET_STRIPE = "whsec_test_do_not_use_in_production";
const CLE_PAYDUNYA = "test-paydunya-master-key-do-not-use-in-production";
const HASH_PAYDUNYA = crypto.createHash("sha512").update(CLE_PAYDUNYA).digest("hex");

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Un loyer au prorata en francs CFA : 100 000 FCFA sur 17 jours d'un mois de 31 jours = 54 838,709… arrondi au centime par la
 * génération des factures, soit 54 838,71. Le franc CFA n'a pas de centimes : le prestataire encaisse 54 839 (la plus petite
 * unité de la devise, au franc entier), et c'est ce montant que le webhook doit reconnaître comme le reste dû.
 */
const MONTANT_PRORATA = 54838.71;
const MONTANT_ENCAISSE = 54839;

async function factureProrataXof(methode: "STRIPE" | "PAYDUNYA", reference: string) {
  const manager = await createManager();
  const property = await createProperty(manager.id, { currency: "XOF" });
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id, { currency: "XOF", rent: 100000 });
  const facture = await createInvoice(contract.id, { status: "PENDING", paymentMethod: methode, paymentRef: reference, amount: MONTANT_PRORATA, currency: "XOF" });
  return { facture };
}

function signerStripe(corps: string) {
  const horodatage = Math.floor(Date.now() / 1000);
  return `t=${horodatage},v1=${crypto.createHmac("sha256", SECRET_STRIPE).update(`${horodatage}.${corps}`).digest("hex")}`;
}

function webhookStripe(reference: string, session: string, montantTotal: number) {
  const corps = JSON.stringify({
    type: "checkout.session.completed",
    data: { object: { id: session, payment_status: "paid", amount_total: montantTotal, currency: "xof", client_reference_id: reference } },
  });
  return request(app).post("/api/payments/stripe/webhook").set("Content-Type", "application/json").set("stripe-signature", signerStripe(corps)).send(corps);
}

function ipnPaydunya(token: string, reference: string, montantConfirme: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response_code: "00", status: "completed", invoice: { total_amount: montantConfirme }, custom_data: { reference } }),
    })
  );
  return request(app)
    .post("/api/payments/paydunya/ipn")
    .send({ data: JSON.stringify({ status: "completed", hash: HASH_PAYDUNYA, invoice: { token }, custom_data: { reference } }) });
}

describe("Paiement en ligne d'un loyer au prorata en francs CFA — le franc entier encaissé solde la facture", () => {
  it("Stripe : 54 839 FCFA encaissés soldent une facture de 54 838,71 et enregistrent un encaissement", async () => {
    vi.spyOn(emailService, "sendEmail").mockResolvedValue(undefined as never);
    const { facture } = await factureProrataXof("STRIPE", "cs_prorata_xof");

    const res = await webhookStripe(facture.id, "cs_prorata_xof", MONTANT_ENCAISSE);

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, facture.id));
    expect(apres.status).toBe("PAID");
    expect(await testDb.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, facture.id))).toHaveLength(1);
  });

  it("PayDunya : 54 839 FCFA confirmés soldent une facture de 54 838,71", async () => {
    vi.spyOn(emailService, "sendEmail").mockResolvedValue(undefined as never);
    const { facture } = await factureProrataXof("PAYDUNYA", "pd_prorata_xof");

    const res = await ipnPaydunya("pd_prorata_xof", facture.id, MONTANT_ENCAISSE);

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, facture.id));
    expect(apres.status).toBe("PAID");
  });

  it("Stripe : un franc de moins que le montant arrondi reste refusé (la facture n'est pas soldée)", async () => {
    vi.spyOn(emailService, "sendEmail").mockResolvedValue(undefined as never);
    const { facture } = await factureProrataXof("STRIPE", "cs_prorata_court");

    const res = await webhookStripe(facture.id, "cs_prorata_court", MONTANT_ENCAISSE - 1);

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, facture.id));
    expect(apres.status).toBe("PENDING");
  });

  it("PayDunya : un franc de moins que le montant arrondi reste refusé", async () => {
    vi.spyOn(emailService, "sendEmail").mockResolvedValue(undefined as never);
    const { facture } = await factureProrataXof("PAYDUNYA", "pd_prorata_court");

    await ipnPaydunya("pd_prorata_court", facture.id, MONTANT_ENCAISSE - 1);

    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, facture.id));
    expect(apres.status).toBe("PENDING");
  });

  it("Stripe : en euros, le centime reste exigé (100,25 € n'est pas soldé par 100,24 €)", async () => {
    vi.spyOn(emailService, "sendEmail").mockResolvedValue(undefined as never);
    const manager = await createManager();
    const property = await createProperty(manager.id, { currency: "EUR" });
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, { currency: "EUR" });
    const facture = await createInvoice(contract.id, { status: "PENDING", paymentMethod: "STRIPE", paymentRef: "cs_eur_centime", amount: 100.25, currency: "EUR" });
    const corps = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { id: "cs_eur_centime", payment_status: "paid", amount_total: 10024, currency: "eur", client_reference_id: facture.id } },
    });

    await request(app).post("/api/payments/stripe/webhook").set("Content-Type", "application/json").set("stripe-signature", signerStripe(corps)).send(corps);

    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, facture.id));
    expect(apres.status).toBe("PENDING");
  });
});
