import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { contracts, invoices } from "../db/schema";
import { authHeader, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Un bail créé avec une date de début passée recevait une facture par mois depuis cette date, toutes « en retard » : neuf
 * lignes de retard pour un bail commencé en janvier, sans moyen de dire « on ne facture qu'à partir d'ici ». La création
 * accepte maintenant `billingFrom` (la colonne existait déjà pour les baux importés) ; absente, rien ne change.
 */
describe("création d'un bail : début de la facturation", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 20)); // 20 octobre 2026
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function contexte() {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const corps = (extra: Record<string, unknown> = {}) => ({
      propertyId: property.id,
      tenantId: tenant.id,
      rent: 35000,
      deposit: 70000,
      currency: "XOF",
      startDate: "2026-01-01",
      endDate: "2029-01-01",
      ...extra,
    });
    return { h: authHeader(tokenFor(manager)), corps };
  }

  const moisFactures = async (contractId: string) =>
    (await testDb.select().from(invoices).where(eq(invoices.contractId, contractId))).map((f: { periodMonth: number }) => f.periodMonth).sort((a: number, b: number) => a - b);

  it("sans billingFrom : une facture par mois depuis le début du bail, comme avant", async () => {
    const { h, corps } = await contexte();
    const res = await request(app).post("/api/contracts").set(h).send(corps());
    expect(res.status).toBe(201);
    expect(await moisFactures(res.body.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("avec billingFrom : les mois d'avant ne sont pas facturés, donc jamais « en retard »", async () => {
    const { h, corps } = await contexte();
    const res = await request(app).post("/api/contracts").set(h).send(corps({ billingFrom: "2026-10-01" }));

    expect(res.status).toBe(201);
    expect(await moisFactures(res.body.id)).toEqual([10]);
    const [bail] = await testDb.select().from(contracts).where(eq(contracts.id, res.body.id));
    expect(new Date(bail.billingFrom).getFullYear()).toBe(2026);
    expect(new Date(bail.billingFrom).getMonth()).toBe(9);
  });

  it("billingFrom au milieu de l'année : la facturation part de ce mois-là", async () => {
    const { h, corps } = await contexte();
    const res = await request(app).post("/api/contracts").set(h).send(corps({ billingFrom: "2026-07-01" }));
    expect(await moisFactures(res.body.id)).toEqual([7, 8, 9, 10]);
  });

  it("billingFrom null ou égal au début du bail : tout est facturé", async () => {
    const { h, corps } = await contexte();
    const res = await request(app).post("/api/contracts").set(h).send(corps({ billingFrom: null }));
    expect(await moisFactures(res.body.id)).toHaveLength(10);
  });

  it("refuse une date de facturation avant le début du bail ou à la fin du bail ou après", async () => {
    const { h, corps } = await contexte();
    for (const billingFrom of ["2025-12-31", "2029-01-01", "2030-06-01"]) {
      const res = await request(app).post("/api/contracts").set(h).send(corps({ billingFrom }));
      expect(res.status, billingFrom).toBe(400);
      expect(res.body.code, billingFrom).toBe("CONTRACT_BILLING_FROM_INVALID");
    }
    expect(await testDb.select().from(contracts)).toHaveLength(0);
  });

  it("refuse une date illisible", async () => {
    const { h, corps } = await contexte();
    const res = await request(app).post("/api/contracts").set(h).send(corps({ billingFrom: "pas-une-date" }));
    expect(res.status).toBe(400);
  });

  it("une modification du bail ignore billingFrom : il ne se règle qu'à la création", async () => {
    const { h, corps } = await contexte();
    const cree = await request(app).post("/api/contracts").set(h).send(corps({ billingFrom: "2026-10-01" }));

    const maj = await request(app).put(`/api/contracts/${cree.body.id}`).set(h).send({ terms: "Clause particulière", billingFrom: "2026-01-01" });

    expect(maj.status).toBe(200);
    const [bail] = await testDb.select().from(contracts).where(eq(contracts.id, cree.body.id));
    expect(bail.terms).toBe("Clause particulière");
    expect(new Date(bail.billingFrom).getMonth()).toBe(9); // inchangé : octobre
  });
});
