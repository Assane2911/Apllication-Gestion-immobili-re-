import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { activityLogs, invoices } from "../db/schema";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createPortalUser,
  createProperty,
  createTenant,
  tokenFor,
  tokenLocataire,
} from "../test/authHelpers";
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

/**
 * Régressions sur les états terminaux d'une facture.
 *
 * PAYÉE et ANNULÉE étaient traversables dans les deux sens : aucune des trois
 * routes ne regardait l'état courant avant d'écrire. Ces tests en font des
 * états terminaux.
 */
describe("états terminaux d'une facture", () => {
  it("refuse (409) de re-marquer payée une facture déjà réglée, et préserve la référence du paiement réel", async () => {
    // Le cas coûteux : la facture a été réglée en ligne, sa référence est
    // celle du prestataire. Un second « marquer payée » la remplaçait par
    // `manuel_<horodatage>` — le rapprochement comptable devenait impossible —
    // et renvoyait une SECONDE quittance au locataire pour le même loyer.
    const { manager, invoice } = await setupManagerWithInvoice({
      status: "PAID",
      paidAt: new Date(2026, 5, 15),
      paymentMethod: "PAYDUNYA",
      paymentRef: "pd_token_reel_123",
    });

    const res = await request(app)
      .post(`/api/invoices/${invoice.id}/mark-paid`)
      .set(authHeader(tokenFor(manager)))
      .send({ paymentMethod: "BANK_TRANSFER" });

    expect(res.status).toBe(409);

    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(apres.paymentRef).toBe("pd_token_reel_123");
    expect(apres.paymentMethod).toBe("PAYDUNYA");
  });

  it("refuse (409) de ressusciter en payée une facture annulée", async () => {
    const { manager, invoice } = await setupManagerWithInvoice({ status: "CANCELLED" });

    const res = await request(app)
      .post(`/api/invoices/${invoice.id}/mark-paid`)
      .set(authHeader(tokenFor(manager)))
      .send({});

    expect(res.status).toBe(409);
    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(apres.status).toBe("CANCELLED");
  });

  it("accepte de régler une facture en retard (LATE reste un état modifiable)", async () => {
    // Le garde-fou ne doit pas bloquer le cas le plus courant : un loyer en
    // retard que le gestionnaire encaisse enfin.
    const { manager, invoice } = await setupManagerWithInvoice({ status: "LATE" });

    const res = await request(app)
      .post(`/api/invoices/${invoice.id}/mark-paid`)
      .set(authHeader(tokenFor(manager)))
      .send({});

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(apres.status).toBe("PAID");
  });

  it("refuse (409) d'annuler une facture réglée, et lui laisse ses traces de paiement", async () => {
    // Sans cette garde, la facture passait à ANNULÉE en CONSERVANT paidAt et
    // sa référence : un loyer réellement encaissé disparaissait des recettes
    // tout en gardant les preuves du paiement.
    const paidAt = new Date(2026, 5, 15);
    const { manager, invoice } = await setupManagerWithInvoice({
      status: "PAID",
      paidAt,
      paymentMethod: "PAYDUNYA",
      paymentRef: "pd_token_reel_456",
    });

    const res = await request(app)
      .post(`/api/invoices/${invoice.id}/cancel`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(409);
    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(apres.status).toBe("PAID");
    expect(apres.paidAt?.getTime()).toBe(paidAt.getTime());
  });

  it("annuler deux fois n'est pas une erreur : la seconde fois ne change rien", async () => {
    const { manager, invoice } = await setupManagerWithInvoice();

    const premier = await request(app)
      .post(`/api/invoices/${invoice.id}/cancel`)
      .set(authHeader(tokenFor(manager)));
    expect(premier.status).toBe(200);

    const second = await request(app)
      .post(`/api/invoices/${invoice.id}/cancel`)
      .set(authHeader(tokenFor(manager)));

    expect(second.status).toBe(200);
    expect(second.body.status).toBe("CANCELLED");

    // Et l'action n'est journalisée qu'une seule fois.
    const journal = await testDb
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.entityId, invoice.id));
    expect(journal.filter((ligne: typeof activityLogs.$inferSelect) => ligne.action === "invoice.cancel")).toHaveLength(1);
  });
});

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

  /**
   * Régression : `contractId` répété dans l'URL (`?contractId=a&contractId=b`)
   * devient un tableau via Express/qs. `String([...])` ne plantait pas — il
   * produisait une valeur ("a,b") qui ne correspond à aucun contrat réel, et
   * la route renvoyait 200 avec une liste vide plutôt qu'un 400 signalant
   * clairement une requête mal formée.
   */
  it("rejette (400) un contractId répété plutôt que de renvoyer silencieusement une liste vide", async () => {
    const { manager, contract } = await setupManagerWithInvoice();

    const res = await request(app)
      .get(`/api/invoices?contractId=${contract.id}&contractId=autre-valeur`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(400);
  });

  it("filtre correctement sur un contractId unique", async () => {
    const { manager, contract, invoice } = await setupManagerWithInvoice();

    const res = await request(app)
      .get(`/api/invoices?contractId=${contract.id}`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(invoice.id);
  });
});

describe("POST /api/invoices/:id/pay (portail locataire)", () => {
  it("confirme instantanément un paiement en mode DEMO", async () => {
    const { tenant, invoice } = await setupManagerWithInvoice();
    const tenantToken = await tokenLocataire(tenant.id);

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
    const otherTenantToken = await tokenLocataire(otherTenant.id);

    const res = await request(app)
      .post(`/api/invoices/${invoice.id}/pay`)
      .set(authHeader(otherTenantToken))
      .send({ method: "DEMO" });

    expect(res.status).toBe(403);
  });

  it("refuse de payer une facture déjà réglée", async () => {
    const { tenant, invoice } = await setupManagerWithInvoice({ status: "PAID", paidAt: new Date() });
    const tenantToken = await tokenLocataire(tenant.id);

    const res = await request(app)
      .post(`/api/invoices/${invoice.id}/pay`)
      .set(authHeader(tenantToken))
      .send({ method: "DEMO" });

    expect(res.status).toBe(409);
  });
});
