import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { expenses, issueReports } from "../db/schema";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createProperty,
  createTenant,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

describe("GET /api/dashboard/stats", () => {
  it("refuse l'accès sans authentification", async () => {
    const res = await request(app).get("/api/dashboard/stats");
    expect(res.status).toBe(401);
  });

  it("refuse l'accès à un locataire", async () => {
    const res = await request(app)
      .get("/api/dashboard/stats")
      .set(authHeader(tokenFor({ id: "t1", role: "TENANT" }, "tenant-1")));
    expect(res.status).toBe(403);
  });

  it("renvoie des statistiques vides pour un gestionnaire sans données", async () => {
    const manager = await createManager();

    const res = await request(app).get("/api/dashboard/stats").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.totalProperties).toBe(0);
    expect(res.body.totalTenants).toBe(0);
    expect(res.body.activeContracts).toBe(0);
    expect(res.body.occupancyRate).toBe(0);
    expect(res.body.openIssues).toBe(0);
    expect(res.body.lateInvoices).toBe(0);
  });

  it("calcule le taux d'occupation et le nombre de biens/locataires/contrats", async () => {
    const manager = await createManager();
    const occupied = await createProperty(manager.id, { status: "OCCUPIED" });
    await createProperty(manager.id, { status: "AVAILABLE" });
    const tenant = await createTenant(manager.id);
    await createContract(occupied.id, tenant.id, { status: "ACTIVE" });

    const res = await request(app).get("/api/dashboard/stats").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.totalProperties).toBe(2);
    expect(res.body.totalTenants).toBe(1);
    expect(res.body.activeContracts).toBe(1);
    expect(res.body.occupancyRate).toBe(50);
    expect(res.body.propertiesByStatus.OCCUPIED).toBe(1);
    expect(res.body.propertiesByStatus.AVAILABLE).toBe(1);
  });

  it("regroupe les revenus du mois en cours par devise plutôt que de les additionner", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const now = new Date();

    await createInvoice(contract.id, {
      periodMonth: now.getMonth() + 1,
      periodYear: now.getFullYear(),
      amount: 500,
      currency: "EUR",
      status: "PAID",
    });
    await createInvoice(contract.id, {
      periodMonth: now.getMonth() + 1,
      periodYear: now.getFullYear(),
      amount: 250000,
      currency: "XOF",
      status: "PAID",
    });

    const res = await request(app).get("/api/dashboard/stats").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.monthlyRevenueByCurrency.EUR).toBe(500);
    expect(res.body.monthlyRevenueByCurrency.XOF).toBe(250000);
  });

  it("compte les factures en retard et les incidents ouverts, isolés par gestionnaire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, { status: "LATE" });
    await testDb.insert(issueReports).values({
      contractId: contract.id,
      tenantId: tenant.id,
      title: "Fuite d'eau",
      description: "Fuite sous l'évier",
      photoUrl: "issues/test.jpg",
      status: "OPEN",
    });

    const otherManager = await createManager();
    const otherProperty = await createProperty(otherManager.id);
    const otherTenant = await createTenant(otherManager.id);
    const otherContract = await createContract(otherProperty.id, otherTenant.id);
    await createInvoice(otherContract.id, { status: "LATE" });

    const res = await request(app).get("/api/dashboard/stats").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.lateInvoices).toBe(1);
    expect(res.body.openIssues).toBe(1);
  });

  it("regroupe les dépenses des 6 derniers mois par devise", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    await testDb.insert(expenses).values({
      propertyId: property.id,
      category: "MAINTENANCE",
      title: "Réparation chaudière",
      amount: 300,
      currency: "EUR",
      expenseDate: new Date(),
    });

    const res = await request(app).get("/api/dashboard/stats").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const monthKeys = Object.keys(res.body.expensesByMonth);
    expect(monthKeys.length).toBeGreaterThan(0);
    const total = Object.values(res.body.expensesByMonth[monthKeys[0]] as Record<string, number>).reduce(
      (a, b) => a + b,
      0
    );
    expect(total).toBe(300);
  });
});
