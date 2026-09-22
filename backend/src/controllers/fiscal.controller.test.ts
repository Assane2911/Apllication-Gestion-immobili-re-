import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { expenses } from "../db/schema";
import { authHeader, createContract, createInvoice, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

describe("GET /api/fiscal/synthese", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 20)); // 20 septembre 2026, "aujourd'hui" de la session
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calcule la synthèse annuelle scopée au gestionnaire connecté, sans fuite d'une autre agence", async () => {
    const managerA = await createManager();
    const propertyA = await createProperty(managerA.id, { title: "Villa Ngor" });
    const tenantA = await createTenant(managerA.id);
    const contractA = await createContract(propertyA.id, tenantA.id);
    await createInvoice(contractA.id, { amount: 500, status: "PAID", paidAt: new Date(2026, 2, 5) });
    await createInvoice(contractA.id, {
      amount: 500,
      periodMonth: 4,
      status: "PAID",
      paidAt: new Date(2026, 3, 5),
    });
    await testDb
      .insert(expenses)
      .values({ propertyId: propertyA.id, category: "TAX", title: "Taxe foncière", amount: 150, expenseDate: new Date(2026, 2, 10) });

    const managerB = await createManager();
    const propertyB = await createProperty(managerB.id);
    const tenantB = await createTenant(managerB.id);
    const contractB = await createContract(propertyB.id, tenantB.id);
    await createInvoice(contractB.id, { amount: 9000, status: "PAID", paidAt: new Date(2026, 2, 5) });

    const res = await request(app).get("/api/fiscal/synthese?year=2026").set(authHeader(tokenFor(managerA)));

    expect(res.status).toBe(200);
    expect(res.body.year).toBe(2026);
    expect(res.body.totalRevenueByCurrency).toEqual({ EUR: 1000 });
    expect(res.body.totalExpensesByCurrency).toEqual({ EUR: 150 });
    expect(res.body.netResultByCurrency).toEqual({ EUR: 850 });
    expect(res.body.revenueByMonth["2026-03"]).toEqual({ EUR: 500 });
    expect(res.body.revenueByMonth["2026-04"]).toEqual({ EUR: 500 });
    expect(res.body.expensesByMonth["2026-03"]).toEqual({ EUR: 150 });
    expect(res.body.expensesByCategory).toEqual({ TAX: { EUR: 150 } });
    expect(res.body.bilanParBien).toEqual([
      { propertyId: propertyA.id, propertyTitle: "Villa Ngor", currency: "EUR", revenue: 1000, expense: 150, net: 850 },
    ]);
  });

  it("ne mélange pas les devises entre deux biens réglés dans des devises différentes", async () => {
    const manager = await createManager();

    const propertyEur = await createProperty(manager.id, { currency: "EUR" });
    const tenantEur = await createTenant(manager.id);
    const contractEur = await createContract(propertyEur.id, tenantEur.id, { currency: "EUR" });
    await createInvoice(contractEur.id, { amount: 1500, currency: "EUR", status: "PAID", paidAt: new Date(2026, 4, 5) });
    await testDb.insert(expenses).values({
      propertyId: propertyEur.id,
      category: "MAINTENANCE",
      title: "Plomberie",
      amount: 100,
      currency: "EUR",
      expenseDate: new Date(2026, 4, 10),
    });

    const propertyXof = await createProperty(manager.id, { currency: "XOF" });
    const tenantXof = await createTenant(manager.id);
    const contractXof = await createContract(propertyXof.id, tenantXof.id, { currency: "XOF" });
    await createInvoice(contractXof.id, { amount: 500000, currency: "XOF", status: "PAID", paidAt: new Date(2026, 4, 5) });
    await testDb.insert(expenses).values({
      propertyId: propertyXof.id,
      category: "MAINTENANCE",
      title: "Peinture",
      amount: 50000,
      currency: "XOF",
      expenseDate: new Date(2026, 4, 10),
    });

    const res = await request(app).get("/api/fiscal/synthese?year=2026").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.totalRevenueByCurrency).toEqual({ EUR: 1500, XOF: 500000 });
    expect(res.body.totalExpensesByCurrency).toEqual({ EUR: 100, XOF: 50000 });
    expect(res.body.netResultByCurrency).toEqual({ EUR: 1400, XOF: 450000 });
    expect(res.body.bilanParBien).toHaveLength(2);
  });

  it("exclut les factures et dépenses d'une autre année que celle demandée", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    // Encaissé en 2025, ne doit pas apparaître dans la synthèse 2026.
    await createInvoice(contract.id, { amount: 500, status: "PAID", paidAt: new Date(2025, 11, 20) });
    await testDb
      .insert(expenses)
      .values({ propertyId: property.id, category: "MAINTENANCE", title: "Travaux 2025", amount: 80, expenseDate: new Date(2025, 11, 15) });

    const res = await request(app).get("/api/fiscal/synthese?year=2026").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.totalRevenueByCurrency).toEqual({});
    expect(res.body.totalExpensesByCurrency).toEqual({});
    expect(res.body.bilanParBien).toEqual([]);
  });

  it("utilise l'année en cours par défaut quand ?year n'est pas fourni", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    // "Aujourd'hui" est le 20 septembre 2026 (system time simulé ci-dessus).
    await createInvoice(contract.id, { amount: 500, status: "PAID", paidAt: new Date(2026, 8, 15) });

    const res = await request(app).get("/api/fiscal/synthese").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.year).toBe(2026);
    expect(res.body.totalRevenueByCurrency).toEqual({ EUR: 500 });
  });

  it("rejette une année hors des bornes acceptées", async () => {
    const manager = await createManager();

    const res = await request(app).get("/api/fiscal/synthese?year=abc").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(400);
  });

  it("inclut toujours l'année en cours dans availableYears même sans aucune donnée", async () => {
    const manager = await createManager();

    const res = await request(app).get("/api/fiscal/synthese").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.availableYears).toContain(2026);
  });
});

describe("GET /api/fiscal/grand-livre", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 20));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exporte un journal chronologique (recettes et dépenses mêlées) avec un solde cumulé correct", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id, { title: "Villa Ngor" });
    const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow" });
    const contract = await createContract(property.id, tenant.id);
    // Volontairement inséré dans le désordre : le journal doit re-trier par date.
    await createInvoice(contract.id, { amount: 500, periodMonth: 3, status: "PAID", paidAt: new Date(2026, 2, 5) });
    await testDb
      .insert(expenses)
      .values({ propertyId: property.id, category: "MAINTENANCE", title: "Plomberie", amount: 200, expenseDate: new Date(2026, 1, 1) });
    await createInvoice(contract.id, { amount: 500, periodMonth: 4, status: "PAID", paidAt: new Date(2026, 3, 5) });

    const res = await request(app).get("/api/fiscal/grand-livre?year=2026").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const lines = res.text.split("\n");
    // La dépense de février doit précéder les deux loyers (mars, avril).
    const plomberieIdx = lines.findIndex((l) => l.includes("Plomberie"));
    const loyerMarsIdx = lines.findIndex((l) => l.includes("Loyer 3/2026"));
    const loyerAvrilIdx = lines.findIndex((l) => l.includes("Loyer 4/2026"));
    expect(plomberieIdx).toBeGreaterThan(-1);
    expect(plomberieIdx).toBeLessThan(loyerMarsIdx);
    expect(loyerMarsIdx).toBeLessThan(loyerAvrilIdx);
    // Solde cumulé : -200 après la dépense, puis 300, puis 800.
    expect(lines[plomberieIdx]).toContain(";-200");
    expect(lines[loyerMarsIdx]).toContain(";300");
    expect(lines[loyerAvrilIdx]).toContain(";800");
    expect(res.text).toContain("Awa Sow");
  });

  it("neutralise un intitulé de dépense qui ressemble à une formule (CWE-1236)", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id, { title: "=2+2" });
    await testDb.insert(expenses).values({
      propertyId: property.id,
      category: "MAINTENANCE",
      title: "=cmd|'/C calc'!A1",
      amount: 100,
      expenseDate: new Date(2026, 5, 10),
    });

    const res = await request(app).get("/api/fiscal/grand-livre?year=2026").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.text).not.toContain(";=cmd");
    expect(res.text).not.toContain(";=2+2;");
    expect(res.text).toContain("'=cmd|'/C calc'!A1");
    expect(res.text).toContain("'=2+2");
  });

  it("ne fait pas fuiter les écritures d'un autre gestionnaire", async () => {
    const managerA = await createManager();
    const managerB = await createManager();
    const propertyB = await createProperty(managerB.id, { title: "Bien Confidentiel B" });
    const tenantB = await createTenant(managerB.id);
    const contractB = await createContract(propertyB.id, tenantB.id);
    await createInvoice(contractB.id, { amount: 777, status: "PAID", paidAt: new Date(2026, 2, 5) });

    const res = await request(app).get("/api/fiscal/grand-livre?year=2026").set(authHeader(tokenFor(managerA)));

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("Bien Confidentiel B");
    expect(res.text).not.toContain("777");
  });

  it("indique l'absence d'écritures pour un exercice sans activité", async () => {
    const manager = await createManager();

    const res = await request(app).get("/api/fiscal/grand-livre?year=2020").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.text).toContain("Aucune écriture pour cet exercice");
  });

  it("écrit montants et solde cumulé à la virgule, sans résidu de flottant", async () => {
    // Deux écritures dont la différence tombe mal en binaire : le solde
    // cumulé sortait en « 799.9999999999999 ». Et tous les montants
    // sortaient au point décimal alors que le séparateur de colonnes est le
    // point-virgule — illisibles comme nombres dans un tableur français.
    const manager = await createManager();
    const property = await createProperty(manager.id, { title: "Villa Ngor" });
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, { amount: 1000.1, status: "PAID", paidAt: new Date(2026, 2, 5) });
    await testDb.insert(expenses).values({
      propertyId: property.id,
      category: "MAINTENANCE",
      title: "Peinture",
      amount: 200.1,
      expenseDate: new Date(2026, 2, 10),
    });

    const res = await request(app).get("/api/fiscal/grand-livre?year=2026").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.text).toContain("1000,10");
    expect(res.text).toContain("200,10");
    // Solde cumulé après les deux écritures : 1000,10 - 200,10 = 800,00 —
    // et surtout pas « 799.9999999999999 ».
    expect(res.text).toContain("800,00");
    expect(res.text).not.toContain("799.99");
  });
});
