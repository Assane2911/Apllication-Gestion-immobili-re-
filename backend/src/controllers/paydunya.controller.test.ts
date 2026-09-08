import crypto from "crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { invoices, platformSubscriptions } from "../db/schema";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

// Doit correspondre exactement à PAYDUNYA_MASTER_KEY forcée dans setupTestDb.ts
// (valeur de test fixe, sans rapport avec une vraie clé PayDunya).
const TEST_MASTER_KEY = "test-paydunya-master-key-do-not-use-in-production";
const VALID_HASH = crypto.createHash("sha512").update(TEST_MASTER_KEY).digest("hex");

function ipnBody(overrides: {
  status?: string;
  hash?: string;
  token?: string;
  reference?: string;
}) {
  return {
    data: JSON.stringify({
      status: overrides.status ?? "completed",
      hash: overrides.hash ?? VALID_HASH,
      invoice: { token: overrides.token ?? "pd_token_default" },
      custom_data: { reference: overrides.reference ?? "" },
    }),
  };
}

describe("POST /api/payments/paydunya/ipn", () => {
  it("confirme le paiement d'une facture sur une notification authentique au statut 'completed'", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, {
      status: "PENDING",
      paymentMethod: "PAYDUNYA",
      paymentRef: "pd_token_abc123",
    });

    const res = await request(app)
      .post("/api/payments/paydunya/ipn")
      .send(ipnBody({ token: "pd_token_abc123", reference: invoice.id }));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const [updated] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(updated.status).toBe("PAID");
    expect(updated.paidAt).not.toBeNull();
  });

  it("confirme le paiement d'un abonnement SaaS quand la référence commence par 'sub_'", async () => {
    const manager = await createManager();
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

    const res = await request(app)
      .post("/api/payments/paydunya/ipn")
      .send(ipnBody({ token: "pd_token_sub456", reference: `sub_${manager.id}_123456` }));

    expect(res.status).toBe(200);

    const [updated] = await testDb
      .select()
      .from(platformSubscriptions)
      .where(eq(platformSubscriptions.id, subscription.id));
    expect(updated.status).toBe("PAID");
  });

  it("rejette une notification dont le hash de signature est invalide", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, {
      status: "PENDING",
      paymentMethod: "PAYDUNYA",
      paymentRef: "pd_token_falsifie",
    });

    const res = await request(app)
      .post("/api/payments/paydunya/ipn")
      .send(ipnBody({ hash: "un-hash-invente-par-un-attaquant", token: "pd_token_falsifie", reference: invoice.id }));

    expect(res.status).toBe(401);

    const [stillPending] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(stillPending.status).toBe("PENDING");
  });

  it("n'effectue aucune mise à jour si le statut n'est pas 'completed'", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, {
      status: "PENDING",
      paymentMethod: "PAYDUNYA",
      paymentRef: "pd_token_encours",
    });

    const res = await request(app)
      .post("/api/payments/paydunya/ipn")
      .send(ipnBody({ status: "pending", token: "pd_token_encours", reference: invoice.id }));

    expect(res.status).toBe(200);
    const [stillPending] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(stillPending.status).toBe("PENDING");
  });

  it("renvoie 400 si le corps ne contient aucun champ 'data' exploitable", async () => {
    const res = await request(app).post("/api/payments/paydunya/ipn").send({ n_importe_quoi: true });

    expect(res.status).toBe(400);
  });
});
