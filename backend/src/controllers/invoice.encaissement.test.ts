import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { activityLogs, invoices } from "../db/schema";
import { authHeader, createContract, createInvoice, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Audit du compte gestionnaire, défaut n°3 : « Marquer réglée » envoyait
 * toujours « virement » et datait l'encaissement de l'instant du clic. Un loyer
 * reçu le 28 décembre et enregistré le 2 janvier était classé dans la mauvaise
 * année par le bilan fiscal et le compte-rendu de gestion.
 */
async function facture(overrides: Parameters<typeof createInvoice>[1] = {}) {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id);
  const invoice = await createInvoice(contract.id, { status: "PENDING", ...overrides });
  return { manager, tenant, invoice };
}

const marquer = (manager: { id: string }, id: string, corps: Record<string, unknown>) =>
  request(app).post(`/api/invoices/${id}/mark-paid`).set(authHeader(tokenFor(manager as never))).send(corps);

describe("mark-paid — moyen d'encaissement", () => {
  it.each(["BANK_TRANSFER", "CASH", "CHEQUE", "MOBILE_MONEY"])("enregistre le moyen %s", async (moyen) => {
    const { manager, invoice } = await facture();
    const res = await marquer(manager, invoice.id, { paymentMethod: moyen });
    expect(res.status).toBe(200);
    expect(res.body.paymentMethod).toBe(moyen);
    const [relu] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(relu.paymentMethod).toBe(moyen);
  });

  it.each(["STRIPE", "PAYDUNYA", "DEMO", "BITCOIN"])("refuse %s : ce n'est pas un encaissement saisi à la main", async (moyen) => {
    const { manager, invoice } = await facture();
    const res = await marquer(manager, invoice.id, { paymentMethod: moyen });
    expect(res.status).toBe(400);
    const [relu] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(relu.status).toBe("PENDING");
  });

  it("garde la référence saisie (numéro de chèque), sinon une référence manuelle", async () => {
    const a = await facture();
    const avec = await marquer(a.manager, a.invoice.id, { paymentMethod: "CHEQUE", paymentRef: "  CHQ 0045871  " });
    expect(avec.body.paymentRef).toBe("CHQ 0045871");
    const b = await facture();
    const sans = await marquer(b.manager, b.invoice.id, { paymentMethod: "CASH", paymentRef: "" });
    expect(sans.body.paymentRef).toMatch(/^manuel_/);
  });
});

describe("mark-paid — date d'encaissement", () => {
  const annee = new Date().getFullYear() - 1;

  it("sans date : l'instant du clic, comme avant", async () => {
    const { manager, invoice } = await facture();
    const avant = Date.now();
    const res = await marquer(manager, invoice.id, {});
    const paidAt = new Date(res.body.paidAt).getTime();
    expect(paidAt).toBeGreaterThanOrEqual(avant - 1000);
    expect(paidAt).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("enregistre la date réelle, à midi UTC, et la journalise quand elle diffère d'aujourd'hui", async () => {
    const { manager, invoice } = await facture({ dueDate: new Date(Date.UTC(annee, 11, 1)) });
    const res = await marquer(manager, invoice.id, { paymentMethod: "CASH", paidAt: `${annee}-12-28` });

    expect(res.status).toBe(200);
    expect(res.body.paidAt).toBe(`${annee}-12-28T12:00:00.000Z`);
    const [journal] = await testDb.select().from(activityLogs).where(eq(activityLogs.entityId, invoice.id));
    expect(journal.details).toContain("Espèces");
    expect(journal.details).toContain(`encaissée le ${annee}-12-28`);
  });

  it("classe le loyer dans l'année de l'ENCAISSEMENT (cas de l'audit : reçu le 28 décembre, saisi en janvier)", async () => {
    const { manager, invoice } = await facture({ dueDate: new Date(Date.UTC(annee, 11, 1)), periodMonth: 12, periodYear: annee });
    await marquer(manager, invoice.id, { paidAt: `${annee}-12-28` });

    const token = authHeader(tokenFor(manager));
    const anneeEncaissement = await request(app).get(`/api/fiscal/synthese?year=${annee}`).set(token);
    const anneeDeSaisie = await request(app).get(`/api/fiscal/synthese?year=${annee + 1}`).set(token);
    const total = (r: { body: { totalRevenueByCurrency?: Record<string, number> } }) =>
      Object.values(r.body.totalRevenueByCurrency ?? {}).reduce((a, b) => a + b, 0);

    expect(total(anneeEncaissement)).toBeGreaterThan(0);
    expect(total(anneeDeSaisie)).toBe(0);
  });

  it("refuse une date future sans rien écrire", async () => {
    const { manager, invoice } = await facture();
    const demain = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const res = await marquer(manager, invoice.id, { paidAt: demain });
    expect(res.status).toBe(400);
    expect(res.body.error ?? res.body.message).toContain("futur");
    const [relu] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(relu.status).toBe("PENDING");
    expect(relu.paidAt).toBeNull();
  });

  it("refuse une date absurde ou beaucoup trop ancienne", async () => {
    const { manager, invoice } = await facture({ dueDate: new Date(Date.UTC(annee, 11, 1)) });
    expect((await marquer(manager, invoice.id, { paidAt: "n'importe quoi" })).status).toBe(400);
    expect((await marquer(manager, invoice.id, { paidAt: `${annee - 3}-01-01` })).status).toBe(400);
    const [relu] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(relu.status).toBe("PENDING");
  });

  it("la quittance affiche le moyen en clair et la date saisie", async () => {
    const { manager, invoice } = await facture({ dueDate: new Date(Date.UTC(annee, 11, 1)) });
    await marquer(manager, invoice.id, { paymentMethod: "MOBILE_MONEY", paidAt: `${annee}-12-28` });
    const res = await request(app).get(`/api/documents/receipt/${invoice.id}`).set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(200);
    expect(res.text).toContain("Mobile Money");
    expect(res.text).not.toContain("MOBILE_MONEY");
    expect(res.text).toMatch(new RegExp(`28[/.-]12[/.-]${annee}|${annee}-12-28|28 d[ée]cembre ${annee}|28 December ${annee}`, "i"));
  });
});
