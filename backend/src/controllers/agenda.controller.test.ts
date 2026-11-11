import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { contracts, insurancePolicies, leaseNotices, rentRevisions } from "../db/schema";
import { authHeader, createContract, createInsurancePolicy, createInvoice, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

// 15 juin 2026 : les dates ci-dessous sont relatives à ce jour.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 5, 15, 8, 0, 0));
});
afterEach(() => vi.useRealTimers());

async function setup() {
  const manager = await createManager();
  const property = await createProperty(manager.id, { title: "Villa Baobab" });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow" });
  const contract = await createContract(property.id, tenant.id, { startDate: new Date(2026, 0, 1), endDate: new Date(2027, 0, 1) });
  return { manager, property, tenant, contract };
}

const lire = (manager: { id: string }, query = "") => request(app).get(`/api/agenda${query}`).set(authHeader(tokenFor(manager as never)));

describe("GET /api/agenda", () => {
  it("réunit loyers, fin de bail, assurance et révision, avec le bien et le locataire", async () => {
    const { manager, property, contract } = await setup();
    await createContract(property.id, (await createTenant(manager.id)).id, { endDate: new Date(2026, 7, 31) });
    await createInvoice(contract.id, { dueDate: new Date(2026, 5, 20), amount: 500, amountPaid: 200 });
    await createInsurancePolicy(property.id, { insurerName: "AXA", expiryDate: new Date(2026, 8, 1) });
    await testDb.insert(rentRevisions).values({ contractId: contract.id, previousRent: 500, newRent: 520, effectiveDate: new Date(2026, 6, 1), method: "AMOUNT" });

    const res = await lire(manager);

    expect(res.status).toBe(200);
    const types = res.body.map((e: { type: string }) => e.type);
    expect(types).toEqual(["RENT_DUE", "RENT_REVISION", "LEASE_END", "INSURANCE_EXPIRY"]);
    const loyer = res.body[0];
    expect(loyer).toMatchObject({ propertyTitle: "Villa Baobab", tenantName: "Awa Sow", amount: 300, enRetard: false });
    expect(res.body[3]).toMatchObject({ label: "AXA" });
  });

  it("met en tête ce qui est en retard, et laisse de côté ce qui est soldé", async () => {
    const { manager, property, contract } = await setup();
    await createInvoice(contract.id, { dueDate: new Date(2026, 4, 5), periodMonth: 5, status: "LATE" });
    await createInvoice(contract.id, { dueDate: new Date(2026, 3, 5), periodMonth: 4, status: "PAID" });
    await createInvoice(contract.id, { dueDate: new Date(2026, 5, 15), periodMonth: 6 }); // échéance du jour : pas un retard
    await createInsurancePolicy(property.id, { expiryDate: new Date(2026, 5, 1) }); // échue il y a 14 jours
    await createInsurancePolicy(property.id, { policyNumber: "ANCIENNE", expiryDate: new Date(2025, 0, 1) }); // échue depuis longtemps
    await testDb.insert(rentRevisions).values({ contractId: contract.id, previousRent: 500, newRent: 520, effectiveDate: new Date(2026, 5, 1), method: "AMOUNT", status: "APPLIED" });

    const res = await lire(manager);

    expect(res.body.map((e: { type: string; enRetard: boolean }) => [e.type, e.enRetard])).toEqual([
      ["RENT_DUE", true],
      ["INSURANCE_EXPIRY", true],
      ["RENT_DUE", false],
    ]);
  });

  it("montre la sortie d'un congé à la place de la fin de bail du même bail", async () => {
    const { manager, contract } = await setup();
    await testDb.update(contracts).set({ endDate: new Date(2026, 8, 30) }).where(eq(contracts.id, contract.id));
    await testDb.insert(leaseNotices).values({
      contractId: contract.id, managerId: manager.id, givenBy: "TENANT", deliveryMode: "EMAIL", servedAt: new Date(2026, 5, 1),
      periodValue: 1, periodUnit: "MONTHS", exitDate: new Date(2026, 6, 1), reason: "Mutation",
    });

    const res = await lire(manager);

    expect(res.body.map((e: { type: string }) => e.type)).toEqual(["EXIT"]);
    expect(res.body[0]).toMatchObject({ label: "Mutation", enRetard: false });
  });

  it("limite l'horizon avec ?days= et refuse une valeur absurde", async () => {
    const { manager, property } = await setup();
    await createInsurancePolicy(property.id, { expiryDate: new Date(2026, 6, 15) }); // dans 30 jours

    const court = await lire(manager, "?days=10");
    const long = await lire(manager, "?days=60");
    const absurde = await lire(manager, "?days=100000");

    expect(court.body.filter((e: { type: string }) => e.type === "INSURANCE_EXPIRY")).toHaveLength(0);
    expect(long.body.filter((e: { type: string }) => e.type === "INSURANCE_EXPIRY")).toHaveLength(1);
    expect(absurde.status).toBe(400);
  });

  it("ne montre que les échéances de l'agence connectée", async () => {
    const { manager } = await setup();
    const autre = await setup();
    await createInvoice(autre.contract.id, { dueDate: new Date(2026, 5, 20) });
    await testDb.insert(insurancePolicies).values({ propertyId: autre.property.id, insurerName: "X", policyNumber: "Z", expiryDate: new Date(2026, 6, 1) });

    const res = await lire(manager);

    expect(res.body.every((e: { propertyId: string }) => e.propertyId !== autre.property.id)).toBe(true);
  });
});
