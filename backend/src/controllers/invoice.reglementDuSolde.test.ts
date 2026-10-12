import crypto from "crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { invoicePayments, invoices } from "../db/schema";
import * as emailService from "../services/email.service";
import { solderEnLigne } from "../services/paiementEnLigne.service";
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
 * Suite des paiements partiels : ce que reçoit le locataire (reçu, rappels) et
 * le règlement du SOLDE en ligne.
 */
async function loyerPartiel(montant = 500, acompte = 300) {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id, { email: "awa@test.local" });
  const contract = await createContract(property.id, tenant.id);
  const invoice = await createInvoice(contract.id, { status: "PENDING", amount: montant, currency: "EUR" });
  const h = authHeader(tokenFor(manager));
  if (acompte > 0) {
    const res = await request(app).post(`/api/invoices/${invoice.id}/mark-paid`).set(h).send({ amount: acompte, paymentMethod: "CASH" });
    expect(res.status).toBe(200);
  }
  return { manager, tenant, invoice, h };
}

const relire = async (id: string) => (await testDb.select().from(invoices).where(eq(invoices.id, id)))[0];
const paiements = (id: string) => testDb.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, id));

let envoi: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const envoisA = (adresse: string) => envoi.mock.calls.filter((c: unknown[]) => c[0] === adresse);

describe("reçu de paiement partiel", () => {
  it("envoie au locataire un REÇU (pas une quittance) avec ce qui a été payé et le reste dû", async () => {
    await loyerPartiel(500, 300);

    const mails = envoisA("awa@test.local");
    expect(mails).toHaveLength(1);
    const [, sujet, html, pieces] = mails[0] as [string, string, string, unknown];
    expect(sujet).toMatch(/Reçu de paiement partiel/);
    expect(html).toContain("reçu de paiement partiel");
    expect(html).toContain("non une quittance");
    expect(html).toMatch(/300/);
    expect(html).toMatch(/200/);
    expect(html).toContain("Espèces");
    expect(pieces).toBeUndefined();
  });

  it("n'envoie la quittance qu'au solde, et plus de reçu partiel à ce moment-là", async () => {
    const { h, invoice } = await loyerPartiel(500, 300);
    envoi.mockClear();

    await request(app).post(`/api/invoices/${invoice.id}/mark-paid`).set(h).send({ amount: 200 });

    const mails = envoisA("awa@test.local");
    expect(mails).toHaveLength(1);
    expect(mails[0][1]).toMatch(/Quittance de loyer/);
  });

  it("un échec d'envoi du reçu ne fait pas échouer l'enregistrement du paiement", async () => {
    envoi.mockRejectedValue(new Error("SMTP indisponible"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { invoice } = await loyerPartiel(500, 300);
    expect((await relire(invoice.id)).amountPaid).toBe(300);
  });
});

describe("rappels : le reste dû, pas le montant total", () => {
  it("la relance d'une facture partiellement payée réclame le reste dû", async () => {
    const { h, invoice } = await loyerPartiel(500, 300);
    envoi.mockClear();

    const res = await request(app).post(`/api/invoices/${invoice.id}/send-reminder`).set(h);
    expect(res.status).toBe(200);

    const mail = envoisA("awa@test.local")[0] as [string, string, string];
    expect(mail).toBeDefined();
    expect(mail[2]).toMatch(/200/);
    expect(mail[2]).not.toMatch(/500/);
  });

  it("une facture sans acompte réclame toujours le montant total", async () => {
    const { h, invoice } = await loyerPartiel(500, 0);
    envoi.mockClear();
    await request(app).post(`/api/invoices/${invoice.id}/send-reminder`).set(h);
    const mail = envoisA("awa@test.local")[0] as [string, string, string];
    expect(mail[2]).toMatch(/500/);
  });
});

describe("règlement du solde en ligne", () => {
  it("le locataire règle le RESTE DÛ (et pas le total) : encaissement enregistré, facture soldée, quittance", async () => {
    const { tenant, invoice } = await loyerPartiel(500, 300);
    envoi.mockClear();

    const res = await request(app)
      .post(`/api/invoices/${invoice.id}/pay`)
      .set(authHeader(await tokenLocataire(tenant.id)))
      .send({ method: "DEMO" });

    expect(res.status).toBe(200);
    expect(res.body.invoice.status).toBe("PAID");
    const apres = await relire(invoice.id);
    expect(apres.status).toBe("PAID");
    expect(apres.amountPaid).toBe(500);
    expect(apres.paymentMethod).toBe("DEMO");
    const lignes = await paiements(invoice.id);
    expect(lignes.map((p: { amount: number; paymentMethod: string }) => [p.paymentMethod, p.amount]).sort()).toEqual([
      ["CASH", 300],
      ["DEMO", 200],
    ]);
    expect(envoisA("awa@test.local").some((c: unknown[]) => /Quittance de loyer/.test(String(c[1])))).toBe(true);
  });

  it("une facture sans acompte se règle en ligne comme avant, avec un seul encaissement du montant total", async () => {
    const { tenant, invoice } = await loyerPartiel(500, 0);
    await request(app).post(`/api/invoices/${invoice.id}/pay`).set(authHeader(await tokenLocataire(tenant.id))).send({ method: "DEMO" });
    const lignes = await paiements(invoice.id);
    expect(lignes).toHaveLength(1);
    expect(lignes[0].amount).toBe(500);
    expect((await relire(invoice.id)).status).toBe("PAID");
  });

  describe("notification PayDunya", () => {
    const MASTER_KEY = "test-paydunya-master-key-do-not-use-in-production";
    const hash = crypto.createHash("sha512").update(MASTER_KEY).digest("hex");
    const ipn = (token: string, reference: string) => ({
      data: JSON.stringify({ status: "completed", hash, invoice: { token }, custom_data: { reference } }),
    });
    const confirmer = (total: number, reference: string) =>
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ response_code: "00", status: "completed", invoice: { total_amount: total }, custom_data: { reference } }),
        })
      );

    async function enAttenteEnLigne() {
      const a = await loyerPartiel(500, 300);
      await testDb.update(invoices).set({ paymentMethod: "PAYDUNYA", paymentRef: "pd_token_solde" }).where(eq(invoices.id, a.invoice.id));
      return a;
    }

    it("solde la facture quand le montant confirmé est le reste dû", async () => {
      const { invoice } = await enAttenteEnLigne();
      confirmer(200, invoice.id);

      const res = await request(app).post("/api/payments/paydunya/ipn").send(ipn("pd_token_solde", invoice.id));

      expect(res.status).toBe(200);
      const apres = await relire(invoice.id);
      expect(apres.status).toBe("PAID");
      expect(apres.amountPaid).toBe(500);
      expect((await paiements(invoice.id)).map((p: { amount: number }) => p.amount).sort()).toEqual([200, 300]);
    });

    it("refuse un montant confirmé égal au TOTAL : il ne correspond pas au reste dû", async () => {
      const { invoice } = await enAttenteEnLigne();
      confirmer(500, invoice.id);
      vi.spyOn(console, "warn").mockImplementation(() => {});

      await request(app).post("/api/payments/paydunya/ipn").send(ipn("pd_token_solde", invoice.id));

      const apres = await relire(invoice.id);
      expect(apres.status).toBe("PENDING");
      expect(apres.amountPaid).toBe(300);
      expect(await paiements(invoice.id)).toHaveLength(1);
    });

    it("une notification rejouée ne solde ni n'enregistre deux fois", async () => {
      const { invoice } = await enAttenteEnLigne();
      confirmer(200, invoice.id);
      await request(app).post("/api/payments/paydunya/ipn").send(ipn("pd_token_solde", invoice.id));
      await request(app).post("/api/payments/paydunya/ipn").send(ipn("pd_token_solde", invoice.id));
      expect(await paiements(invoice.id)).toHaveLength(2);
    });
  });

  describe("solderEnLigne", () => {
    it("deux appels simultanés n'enregistrent qu'un seul encaissement", async () => {
      const { invoice } = await loyerPartiel(500, 300);
      const resultats = await Promise.all([
        solderEnLigne(invoice.id, { methode: "STRIPE", reference: "cs_1" }),
        solderEnLigne(invoice.id, { methode: "STRIPE", reference: "cs_1" }),
      ]);
      expect(resultats.filter(Boolean)).toHaveLength(1);
      expect(await paiements(invoice.id)).toHaveLength(2);
    });

    it("ne ressuscite pas une facture annulée", async () => {
      const { invoice } = await loyerPartiel(500, 0);
      await testDb.update(invoices).set({ status: "CANCELLED" }).where(eq(invoices.id, invoice.id));
      expect(await solderEnLigne(invoice.id, { methode: "STRIPE" })).toBeUndefined();
      expect(await paiements(invoice.id)).toHaveLength(0);
    });
  });
});
