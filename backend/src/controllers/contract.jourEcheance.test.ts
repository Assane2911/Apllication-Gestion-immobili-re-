import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { contracts, invoices } from "../db/schema";
import { authHeader, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Jour d'échéance configurable par contrat (audit du compte gestionnaire,
 * défaut n°4). Sans réglage, c'est le jour de la date de début du bail : le
 * comportement de tous les contrats antérieurs au champ.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T10:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

async function contexte() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id);
  return { manager, property, tenant, h: authHeader(tokenFor(manager)) };
}

const corps = (c: Awaited<ReturnType<typeof contexte>>, extra: Record<string, unknown> = {}) => ({
  propertyId: c.property.id,
  tenantId: c.tenant.id,
  rent: 500,
  deposit: 1000,
  startDate: "2026-08-24",
  endDate: "2027-08-23",
  ...extra,
});

const echeances = async (contractId: string) =>
  (await testDb.select().from(invoices).where(eq(invoices.contractId, contractId)))
    .map((i: { periodMonth: number; dueDate: Date }) => [i.periodMonth, i.dueDate.getDate()])
    .sort((a: number[], b: number[]) => a[0] - b[0]);

describe("création avec un jour d'échéance", () => {
  it("sans réglage : chaque facture est due le jour du début du bail (comportement d'avant)", async () => {
    const c = await contexte();
    const res = await request(app).post("/api/contracts").set(c.h).send(corps(c));
    expect(res.status).toBe(201);
    expect(res.body.paymentDay).toBeNull();
    expect(await echeances(res.body.id)).toEqual([[8, 24], [9, 24], [10, 24]]);
  });

  it("au 5 : les factures suivantes sont dues le 5, et la première (au prorata) à l'entrée en vigueur, pas avant", async () => {
    const c = await contexte();
    const res = await request(app).post("/api/contracts").set(c.h).send(corps(c, { paymentDay: 5 }));
    expect(res.status).toBe(201);
    expect(res.body.paymentDay).toBe(5);
    // Août : 5 août serait AVANT le début du bail (24 août) → exigible le 24.
    expect(await echeances(res.body.id)).toEqual([[8, 24], [9, 5], [10, 5]]);
  });

  it("une première facture n'est pas en retard dès sa création à cause d'un jour d'échéance antérieur à l'entrée", async () => {
    const c = await contexte();
    const res = await request(app)
      .post("/api/contracts")
      .set(c.h)
      .send(corps(c, { startDate: "2026-10-12", paymentDay: 5 }));
    const [facture] = await testDb.select().from(invoices).where(eq(invoices.contractId, res.body.id));
    expect(facture.dueDate.getDate()).toBe(12);
    expect(facture.status).toBe("PENDING");
  });

  it("« dernier jour du mois » (31) : plafonné au dernier jour réel de chaque mois", async () => {
    const c = await contexte();
    const res = await request(app).post("/api/contracts").set(c.h).send(corps(c, { startDate: "2026-08-01", paymentDay: 31 }));
    expect(await echeances(res.body.id)).toEqual([[8, 31], [9, 30], [10, 31]]);
  });

  it.each([0, 32, 5.5, -1, "abc"])("refuse le jour d'échéance %s", async (valeur) => {
    const c = await contexte();
    const res = await request(app).post("/api/contracts").set(c.h).send(corps(c, { paymentDay: valeur }));
    expect(res.status).toBe(400);
  });
});

describe("modification du jour d'échéance", () => {
  async function bailExistant() {
    const c = await contexte();
    const res = await request(app).post("/api/contracts").set(c.h).send(corps(c));
    return { ...c, id: res.body.id as string };
  }

  it("ne touche pas aux factures déjà émises", async () => {
    const c = await bailExistant();
    const avant = await echeances(c.id);
    const res = await request(app).put(`/api/contracts/${c.id}`).set(c.h).send({ paymentDay: 5 });
    expect(res.status).toBe(200);
    expect(res.body.paymentDay).toBe(5);
    expect(await echeances(c.id)).toEqual(avant);
  });

  it("peut revenir au jour du début du bail (null)", async () => {
    const c = await bailExistant();
    await request(app).put(`/api/contracts/${c.id}`).set(c.h).send({ paymentDay: 5 });
    const res = await request(app).put(`/api/contracts/${c.id}`).set(c.h).send({ paymentDay: null });
    expect(res.status).toBe(200);
    expect(res.body.paymentDay).toBeNull();
  });

  it("est verrouillé une fois le bail signé par le locataire (contenu contractuel)", async () => {
    const c = await bailExistant();
    await testDb.update(contracts).set({ signedByTenantAt: new Date() }).where(eq(contracts.id, c.id));
    const res = await request(app).put(`/api/contracts/${c.id}`).set(c.h).send({ paymentDay: 5 });
    expect(res.status).toBe(409);
    const [relu] = await testDb.select().from(contracts).where(eq(contracts.id, c.id));
    expect(relu.paymentDay).toBeNull();
  });
});

describe("renouvellement et bail PDF", () => {
  it("le renouvellement garde le jour d'échéance", async () => {
    const c = await contexte();
    const cree = await request(app).post("/api/contracts").set(c.h).send(corps(c, { paymentDay: 5 }));
    const res = await request(app).post(`/api/contracts/${cree.body.id}/renew`).set(c.h).send({ months: 12 });
    expect(res.status).toBe(201);
    expect(res.body.paymentDay).toBe(5);
  });

  it.each([
    [{ paymentDay: 5 }, "payable mensuellement au plus tard le 5 de chaque mois"],
    [{}, "payable mensuellement au plus tard le 24 de chaque mois"],
    [{ paymentDay: 31 }, "payable mensuellement au plus tard le dernier jour de chaque mois"],
  ])("le bail %j dit « %s »", async (extra, phrase) => {
    const c = await contexte();
    const cree = await request(app).post("/api/contracts").set(c.h).send(corps(c, extra));
    const bail = await request(app).get(`/api/documents/lease/${cree.body.id}`).set(c.h);
    expect(bail.status).toBe(200);
    expect(bail.text).toContain(phrase);
  });
});
