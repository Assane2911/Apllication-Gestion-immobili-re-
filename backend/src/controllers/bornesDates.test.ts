import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { contracts, expenses, insurancePolicies, listingLeads, listings, rentRevisions } from "../db/schema";
import { authHeader, createContract, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Dates et montants des dépenses, assurances, révisions de loyer et demandes de visite : une date de
 * l'an 1 ou d'avant notre ère, ou un loyer révisé à 10^15, ne doivent jamais atteindre la base.
 * Une dépense récurrente datée de l'an 1 faisait générer 1 000 lignes d'un coup par le cron.
 */
async function agence() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
  const property = await createProperty(manager.id);
  return { manager, property, h: authHeader(tokenFor(manager)) };
}

const DATES_ABSURDES = [
  ["l'an 1", "0001-01-01T00:00:00.000Z"],
  ["1900", "1900-06-15T00:00:00.000Z"],
  ["l'an 3000", "3000-01-01T00:00:00.000Z"],
  ["avant notre ère", "-100000-01-01T00:00:00.000Z"],
] as const;

describe("dépenses — dates", () => {
  it.each(DATES_ABSURDES)("refuse une date de dépense en %s", async (_nom, date) => {
    const { h, property } = await agence();
    const res = await request(app).post("/api/expenses").set(h).send({ propertyId: property.id, title: "Plomberie", amount: 100, expenseDate: date });
    expect(res.status).toBe(400);
    expect(await testDb.select().from(expenses)).toHaveLength(0);
  });

  it("refuse une dépense récurrente qui démarre l'an 1 (le cron générerait 1 000 lignes)", async () => {
    const { h, property } = await agence();
    const res = await request(app)
      .post("/api/expenses")
      .set(h)
      .send({ propertyId: property.id, title: "Syndic", amount: 100, expenseDate: "0001-01-01T00:00:00.000Z", recurrence: "MONTHLY" });
    expect(res.status).toBe(400);
  });

  it("refuse une date de fin de récurrence absurde", async () => {
    const { h, property } = await agence();
    const res = await request(app)
      .post("/api/expenses")
      .set(h)
      .send({ propertyId: property.id, title: "Syndic", amount: 100, recurrence: "MONTHLY", recurrenceEndDate: "9999-01-01T00:00:00.000Z" });
    expect(res.status).toBe(400);
  });

  it("accepte une dépense ordinaire", async () => {
    const { h, property } = await agence();
    const res = await request(app).post("/api/expenses").set(h).send({ propertyId: property.id, title: "Plomberie", amount: 100, expenseDate: "2026-03-10" });
    expect(res.status).toBe(201);
  });
});

describe("assurances — dates", () => {
  const police = (propertyId: string, surcharge: Record<string, unknown>) => ({
    propertyId,
    insurerName: "AXA",
    policyNumber: "P-1",
    expiryDate: "2027-01-01",
    ...surcharge,
  });

  it.each(DATES_ABSURDES)("refuse une échéance en %s", async (_nom, date) => {
    const { h, property } = await agence();
    const res = await request(app).post("/api/insurance-policies").set(h).send(police(property.id, { expiryDate: date }));
    expect(res.status).toBe(400);
    expect(await testDb.select().from(insurancePolicies)).toHaveLength(0);
  });

  it("refuse une prise d'effet absurde", async () => {
    const { h, property } = await agence();
    const res = await request(app).post("/api/insurance-policies").set(h).send(police(property.id, { startDate: "-100000-01-01T00:00:00.000Z" }));
    expect(res.status).toBe(400);
  });

  it("accepte une police ordinaire", async () => {
    const { h, property } = await agence();
    const res = await request(app).post("/api/insurance-policies").set(h).send(police(property.id, { startDate: "2026-01-01" }));
    expect(res.status).toBe(201);
  });
});

describe("révision de loyer — bornes", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T09:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  async function bail() {
    const { manager, h, property } = await agence();
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, {
      rent: 500,
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2027-12-31T00:00:00Z"),
    });
    return { h, contract };
  }
  const reviser = (h: Record<string, string>, id: string, corps: Record<string, unknown>) =>
    request(app).post(`/api/contracts/${id}/rent-revisions`).set(h).send({ effectiveDate: "2026-11-01", ...corps });

  it.each([
    ["un loyer au-delà du plafond", { mode: "AMOUNT", newRent: 2e12 }],
    ["un loyer infini", { mode: "AMOUNT", newRent: "1e999" }],
    ["un rapport d'indices qui multiplie le loyer par dix milliards", { mode: "INDEX", indexOld: 1, indexNew: 10_000_000_000 }],
    ["des indices infinis", { mode: "INDEX", indexOld: "1e999", indexNew: "1e999" }],
    ["un pourcentage infini", { mode: "PERCENT", percent: "1e999" }],
  ])("refuse %s", async (_nom, corps) => {
    const { h, contract } = await bail();
    const res = await reviser(h, contract.id, corps);
    expect(res.status).toBe(400);
    expect(await testDb.select().from(rentRevisions).where(eq(rentRevisions.contractId, contract.id))).toHaveLength(0);
    expect((await testDb.select().from(contracts).where(eq(contracts.id, contract.id)))[0].rent).toBe(500);
  });

  it("refuse une date d'effet absurde", async () => {
    const { h, contract } = await bail();
    const res = await reviser(h, contract.id, { mode: "PERCENT", percent: 3, effectiveDate: "-100000-01-01T00:00:00.000Z" });
    expect(res.status).toBe(400);
  });

  it("accepte une révision ordinaire", async () => {
    const { h, contract } = await bail();
    const res = await reviser(h, contract.id, { mode: "INDEX", indexOld: 142.06, indexNew: 144 });
    expect(res.status).toBe(201);
  });
});

describe("demande de visite — date souhaitée", () => {
  it.each(DATES_ABSURDES)("refuse une date souhaitée en %s", async (_nom, date) => {
    const manager = await createManager();
    const [listing] = await testDb
      .insert(listings)
      .values({ managerId: manager.id, title: "Villa Ngor", description: "Belle villa avec vue sur mer", price: 250000, location: "Ngor, Dakar", country: "SN" })
      .returning();

    const res = await request(app).post(`/api/listings/public/${listing.id}/leads`).send({
      prospectName: "Awa Sow",
      prospectEmail: "awa@test.local",
      prospectPhone: "+221771234567",
      requestType: "VISIT",
      message: "Disponible ?",
      preferredDate: date,
    });

    expect(res.status).toBe(400);
    expect(await testDb.select().from(listingLeads).where(eq(listingLeads.listingId, listing.id))).toHaveLength(0);
  });
});
