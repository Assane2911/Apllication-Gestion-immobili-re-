import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { activityLogs, invoices } from "../db/schema";
import { authHeader, createContract, createInvoice, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Prépare un gestionnaire avec un bien, un locataire, un contrat et une
 * facture PENDING — le scénario de base réutilisé par la plupart des tests
 * ci-dessous (mark-paid, cancel, pay, isolation...).
 */
async function setupManagerWithInvoice(overrides: Parameters<typeof createInvoice>[1] = {}) {
  const manager = await createManager();
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id);
  const invoice = await createInvoice(contract.id, overrides);
  return { manager, property, tenant, contract, invoice };
}

describe("POST /api/invoices/:id/mark-paid", () => {
  it("marque une facture réglée manuellement, avec la méthode par défaut, et journalise l'action", async () => {
    const { manager, invoice } = await setupManagerWithInvoice();

    const res = await request(app)
      .post(`/api/invoices/${invoice.id}/mark-paid`)
      .set(authHeader(tokenFor(manager)))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PAID");
    expect(res.body.paymentMethod).toBe("BANK_TRANSFER");
    expect(res.body.paymentRef).toMatch(/^manuel_/);
    expect(res.body.paidAt).not.toBeNull();

    const logs = await testDb.select().from(activityLogs).where(eq(activityLogs.entityId, invoice.id));
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("invoice.mark_paid");
  });

  it("refuse de marquer réglée une facture appartenant à un autre gestionnaire", async () => {
    const { invoice } = await setupManagerWithInvoice();
    const otherManager = await createManager();

    const res = await request(app)
      .post(`/api/invoices/${invoice.id}/mark-paid`)
      .set(authHeader(tokenFor(otherManager)))
      .send({});

    expect(res.status).toBe(404);

    const [stillPending] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(stillPending.status).toBe("PENDING");
  });
});

describe("POST /api/invoices/:id/cancel", () => {
  it("annule une facture appartenant au gestionnaire connecté", async () => {
    const { manager, invoice } = await setupManagerWithInvoice();

    const res = await request(app).post(`/api/invoices/${invoice.id}/cancel`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");
  });

  it("refuse d'annuler une facture appartenant à un autre gestionnaire", async () => {
    const { invoice } = await setupManagerWithInvoice();
    const otherManager = await createManager();

    const res = await request(app).post(`/api/invoices/${invoice.id}/cancel`).set(authHeader(tokenFor(otherManager)));

    expect(res.status).toBe(404);
  });
});

describe("GET /api/invoices — isolation entre gestionnaires", () => {
  it("ne renvoie que les factures des biens du gestionnaire connecté", async () => {
    const { manager, invoice } = await setupManagerWithInvoice();
    await setupManagerWithInvoice(); // une autre agence, avec sa propre facture

    const res = await request(app).get("/api/invoices").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(invoice.id);
  });
});

describe("POST /api/invoices/:id/pay (portail locataire)", () => {
  it("confirme instantanément un paiement en mode DEMO", async () => {
    const { tenant, invoice } = await setupManagerWithInvoice();
    const tenantToken = tokenFor({ id: tenant.userId ?? tenant.id, role: "TENANT" }, tenant.id);

    const res = await request(app)
      .post(`/api/invoices/${invoice.id}/pay`)
      .set(authHeader(tenantToken))
      .send({ method: "DEMO" });

    expect(res.status).toBe(200);
    expect(res.body.invoice.status).toBe("PAID");
    expect(res.body.payment.status).toBe("PAID");
    expect(res.body.payment.method).toBe("DEMO");
  });

  it("refuse qu'un locataire paie la facture d'un autre locataire", async () => {
    const { invoice } = await setupManagerWithInvoice();
    const { tenant: otherTenant } = await setupManagerWithInvoice();
    const otherTenantToken = tokenFor(
      { id: otherTenant.userId ?? otherTenant.id, role: "TENANT" },
      otherTenant.id
    );

    const res = await request(app)
      .post(`/api/invoices/${invoice.id}/pay`)
      .set(authHeader(otherTenantToken))
      .send({ method: "DEMO" });

    expect(res.status).toBe(403);
  });

  it("refuse de payer une facture déjà réglée", async () => {
    const { tenant, invoice } = await setupManagerWithInvoice({ status: "PAID", paidAt: new Date() });
    const tenantToken = tokenFor({ id: tenant.userId ?? tenant.id, role: "TENANT" }, tenant.id);

    const res = await request(app)
      .post(`/api/invoices/${invoice.id}/pay`)
      .set(authHeader(tenantToken))
      .send({ method: "DEMO" });

    expect(res.status).toBe(409);
  });
});
