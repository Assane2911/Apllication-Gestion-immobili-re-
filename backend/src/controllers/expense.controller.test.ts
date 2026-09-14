import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { expenses } from "../db/schema";
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

describe("POST /api/expenses", () => {
  it("crée une dépense pour un bien du gestionnaire connecté", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);

    const res = await request(app)
      .post("/api/expenses")
      .set(authHeader(tokenFor(manager)))
      .send({ propertyId: property.id, category: "MAINTENANCE", title: "Plomberie", amount: 150 });

    expect(res.status).toBe(201);
    expect(res.body.amount).toBe(150);
    expect(res.body.category).toBe("MAINTENANCE");
    expect(res.body.propertyId).toBe(property.id);
  });

  it("refuse de créer une dépense sur le bien d'un autre gestionnaire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const otherManager = await createManager();

    const res = await request(app)
      .post("/api/expenses")
      .set(authHeader(tokenFor(otherManager)))
      .send({ propertyId: property.id, title: "Intrusion", amount: 100 });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/expenses/:id", () => {
  it("supprime une dépense appartenant au gestionnaire connecté", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const [expense] = await testDb
      .insert(expenses)
      .values({ propertyId: property.id, title: "Assurance", amount: 80, expenseDate: new Date(2026, 5, 1) })
      .returning();

    const res = await request(app).delete(`/api/expenses/${expense.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    const remaining = await testDb.select().from(expenses).where(eq(expenses.id, expense.id));
    expect(remaining).toHaveLength(0);
  });

  it("refuse de supprimer une dépense appartenant à un autre gestionnaire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const [expense] = await testDb
      .insert(expenses)
      .values({ propertyId: property.id, title: "Assurance", amount: 80, expenseDate: new Date(2026, 5, 1) })
      .returning();
    const otherManager = await createManager();

    const res = await request(app).delete(`/api/expenses/${expense.id}`).set(authHeader(tokenFor(otherManager)));

    expect(res.status).toBe(404);
    const stillThere = await testDb.select().from(expenses).where(eq(expenses.id, expense.id));
    expect(stillThere).toHaveLength(1);
  });
});

describe("GET /api/expenses", () => {
  /**
   * Régression : même faille que sur listInvoices (invoice.controller.ts).
   * `propertyId` répété dans l'URL devient un tableau via Express/qs, et
   * `String([...])` produisait silencieusement une valeur qui ne correspond
   * à aucun bien réel — 200 avec une liste vide plutôt qu'un 400 clair.
   */
  it("rejette (400) un propertyId répété plutôt que de renvoyer silencieusement une liste vide", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    await testDb
      .insert(expenses)
      .values({ propertyId: property.id, title: "Assurance", amount: 80, expenseDate: new Date(2026, 5, 1) });

    const res = await request(app)
      .get(`/api/expenses?propertyId=${property.id}&propertyId=autre-valeur`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(400);
  });

  it("filtre correctement sur un propertyId unique", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const [expense] = await testDb
      .insert(expenses)
      .values({ propertyId: property.id, title: "Assurance", amount: 80, expenseDate: new Date(2026, 5, 1) })
      .returning();

    const res = await request(app).get(`/api/expenses?propertyId=${property.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(expense.id);
  });
});

describe("GET /api/expenses/summary", () => {
  it("calcule le résumé financier (revenus, dépenses, net) scopé au gestionnaire connecté, sans fuite d'une autre agence", async () => {
    // --- Agence A (celle dont on va lire le résumé) ---
    const managerA = await createManager();
    const propertyA = await createProperty(managerA.id);
    const tenantA = await createTenant(managerA.id);
    const contractA = await createContract(propertyA.id, tenantA.id);
    await createInvoice(contractA.id, { amount: 500, status: "PAID", paidAt: new Date(2026, 5, 5) });
    // Facture encore PENDING : ne doit pas compter dans les revenus.
    await createInvoice(contractA.id, {
      amount: 500,
      periodMonth: 7,
      status: "PENDING",
      dueDate: new Date(2026, 6, 20),
    });
    await testDb
      .insert(expenses)
      .values({ propertyId: propertyA.id, category: "MAINTENANCE", title: "Réparation", amount: 200, expenseDate: new Date(2026, 5, 10) });

    // --- Agence B (ne doit jamais apparaître dans le résumé de A) ---
    const managerB = await createManager();
    const propertyB = await createProperty(managerB.id);
    const tenantB = await createTenant(managerB.id);
    const contractB = await createContract(propertyB.id, tenantB.id);
    await createInvoice(contractB.id, { amount: 9000, status: "PAID", paidAt: new Date(2026, 5, 5) });
    await testDb
      .insert(expenses)
      .values({ propertyId: propertyB.id, category: "TAX", title: "Taxe foncière", amount: 9000, expenseDate: new Date(2026, 5, 10) });

    const res = await request(app).get("/api/expenses/summary").set(authHeader(tokenFor(managerA)));

    expect(res.status).toBe(200);
    expect(res.body.totalRevenueByCurrency).toEqual({ EUR: 500 });
    expect(res.body.totalExpensesByCurrency).toEqual({ EUR: 200 });
    expect(res.body.netCashFlowByCurrency).toEqual({ EUR: 300 });
    expect(res.body.expensesByCategory).toEqual({ MAINTENANCE: { EUR: 200 } });
    expect(res.body.expenseCount).toBe(1);
    expect(res.body.paidInvoiceCount).toBe(1);
  });

  /**
   * Régression : totalRevenue/totalExpenses/netCashFlow additionnaient
   * invoice.amount / expense.amount à travers TOUTES les devises sans les
   * distinguer — un gestionnaire avec un bien réglé en EUR et un autre en
   * XOF obtenait un total unique sans signification (ex: 1500 + 500000 =
   * "501500"), affiché comme si c'était homogène. Chaque total doit rester
   * ventilé par devise, comme dashboard.controller.ts et admin.controller.ts
   * le font déjà pour les mêmes montants.
   */
  it("ne mélange pas les devises dans le résumé financier", async () => {
    const manager = await createManager();

    const propertyEur = await createProperty(manager.id, { currency: "EUR" });
    const tenantEur = await createTenant(manager.id);
    const contractEur = await createContract(propertyEur.id, tenantEur.id, { currency: "EUR" });
    await createInvoice(contractEur.id, { amount: 1500, currency: "EUR", status: "PAID", paidAt: new Date(2026, 5, 5) });
    await testDb.insert(expenses).values({
      propertyId: propertyEur.id,
      category: "MAINTENANCE",
      title: "Plomberie",
      amount: 100,
      currency: "EUR",
      expenseDate: new Date(2026, 5, 10),
    });

    const propertyXof = await createProperty(manager.id, { currency: "XOF" });
    const tenantXof = await createTenant(manager.id);
    const contractXof = await createContract(propertyXof.id, tenantXof.id, { currency: "XOF" });
    await createInvoice(contractXof.id, { amount: 500000, currency: "XOF", status: "PAID", paidAt: new Date(2026, 5, 5) });
    await testDb.insert(expenses).values({
      propertyId: propertyXof.id,
      category: "MAINTENANCE",
      title: "Peinture",
      amount: 50000,
      currency: "XOF",
      expenseDate: new Date(2026, 5, 10),
    });

    const res = await request(app).get("/api/expenses/summary").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.totalRevenueByCurrency).toEqual({ EUR: 1500, XOF: 500000 });
    expect(res.body.totalExpensesByCurrency).toEqual({ EUR: 100, XOF: 50000 });
    expect(res.body.netCashFlowByCurrency).toEqual({ EUR: 1400, XOF: 450000 });
    expect(res.body.expensesByCategory).toEqual({ MAINTENANCE: { EUR: 100, XOF: 50000 } });
    expect(res.body.expenseCount).toBe(2);
    expect(res.body.paidInvoiceCount).toBe(2);
  });
});
