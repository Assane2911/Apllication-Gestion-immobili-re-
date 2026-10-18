import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { invoices } from "../db/schema";
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
 * Stripe et PayDunya sont le compte de la PLATEFORME : ils servent à encaisser les abonnements des
 * agences. Un loyer payé par carte ou Mobile Money arriverait sur ce même compte avant d'être reversé à
 * l'agence, c'est-à-dire que la plateforme détiendrait de l'argent qui n'est pas le sien. Tant que
 * RENT_ONLINE_PAYMENTS n'est pas activé, le locataire règle son loyer par virement vers le compte de son
 * agence (déclaré dans l'application) et rien d'autre.
 */
describe("paiement du loyer en ligne — réservé aux abonnements par défaut", () => {
  const original = {
    demoMode: env.payments.demoMode,
    rentOnline: env.payments.rentOnline,
    stripeSecretKey: env.payments.stripeSecretKey,
    stripeCurrencies: [...env.payments.stripeCurrencies],
    paydunya: { ...env.payments.paydunya },
  };

  afterEach(() => {
    env.payments.demoMode = original.demoMode;
    env.payments.rentOnline = original.rentOnline;
    env.payments.stripeSecretKey = original.stripeSecretKey;
    env.payments.stripeCurrencies = [...original.stripeCurrencies];
    env.payments.paydunya = { ...original.paydunya };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Comptes Stripe et PayDunya « réellement » configurés, hors mode démo. */
  function prestatairesConfigures() {
    env.payments.demoMode = false;
    env.payments.stripeSecretKey = "sk_test_x";
    env.payments.paydunya = { ...original.paydunya, masterKey: "mk", privateKey: "pk", token: "tk", currency: "XOF" };
  }

  async function locataireAvecFacture() {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, { currency: "XOF", amount: 25000 });
    return { invoice, tenantToken: await tokenLocataire(tenant.id) };
  }

  it("l'interrupteur est désactivé par défaut", () => {
    expect(original.rentOnline).toBe(false);
  });

  it("n'appelle jamais Stripe ni PayDunya pour un loyer, et laisse la facture intacte", async () => {
    prestatairesConfigures();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { invoice, tenantToken } = await locataireAvecFacture();

    for (const method of ["STRIPE", "PAYDUNYA"]) {
      const res = await request(app).post(`/api/invoices/${invoice.id}/pay`).set(authHeader(tenantToken)).send({ method });
      expect(res.status, method).toBe(400);
      expect(res.body.error, method).toContain("virement");
    }

    expect(fetchMock).not.toHaveBeenCalled();
    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(apres.status).toBe("PENDING");
    expect(apres.paymentRef).toBeNull();
    // La réclamation anti-doublon ne doit pas rester posée après le refus.
    expect(apres.paymentAttemptStartedAt).toBeNull();
  });

  it("accepte toujours la déclaration d'un virement vers l'agence", async () => {
    prestatairesConfigures();
    const { invoice, tenantToken } = await locataireAvecFacture();

    const res = await request(app)
      .post(`/api/invoices/${invoice.id}/pay`)
      .set(authHeader(tenantToken))
      .send({ method: "BANK_TRANSFER", bankReference: "VIR-2026-001" });

    expect(res.status).toBe(200);
  });

  it("ne propose au locataire que le virement, même quand les prestataires sont configurés", async () => {
    prestatairesConfigures();
    const manager = await createManager();

    const loyer = await request(app).get("/api/payments/methods?currency=XOF&usage=loyer").set(authHeader(tokenFor(manager)));

    expect(loyer.status).toBe(200);
    expect(loyer.body.methods).toEqual(["BANK_TRANSFER"]);
  });

  it("continue de proposer Stripe et PayDunya pour l'abonnement", async () => {
    prestatairesConfigures();
    env.payments.stripeCurrencies = ["EUR", "XOF"];
    const manager = await createManager();

    const parDefaut = await request(app).get("/api/payments/methods?currency=XOF").set(authHeader(tokenFor(manager)));
    const abonnement = await request(app).get("/api/payments/methods?currency=XOF&usage=abonnement").set(authHeader(tokenFor(manager)));

    for (const res of [parDefaut, abonnement]) {
      expect(res.status).toBe(200);
      expect(res.body.methods).toContain("PAYDUNYA");
      expect(res.body.methods).toContain("STRIPE");
    }
  });

  it("refuse un usage inconnu", async () => {
    const manager = await createManager();
    const res = await request(app).get("/api/payments/methods?currency=XOF&usage=autre").set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(400);
  });

  it("rétablit le paiement du loyer en ligne quand l'interrupteur est activé", async () => {
    prestatairesConfigures();
    env.payments.rentOnline = true;
    const manager = await createManager();

    const res = await request(app).get("/api/payments/methods?currency=XOF&usage=loyer").set(authHeader(tokenFor(manager)));

    expect(res.body.methods).toContain("PAYDUNYA");
    expect(res.body.methods).toContain("BANK_TRANSFER");
  });
});
