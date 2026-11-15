import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { expenses, invoicePayments } from "../db/schema";
import * as encaissements from "../services/encaissements.service";
import { authHeader, createContract, createInvoice, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Bilans fiscaux (synthèse, grand livre, FEC, SYSCOHADA) : seule l'année demandée est lue dans la base.
 *
 * Avant, chaque requête relisait TOUT l'historique des factures encaissées du gestionnaire (18 000 factures sur 5 ans : 1,6 s par
 * requête, et davantage chaque année) pour n'en garder que l'année demandée en mémoire. Le résultat doit rester exactement le même.
 */

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 20));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function agence() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: new Date(2027, 5, 1) });
  const property = await createProperty(manager.id, { title: "Villa Ngor" });
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id);
  return { manager, property, contract, h: authHeader(tokenFor(manager)) };
}

describe("Bilans fiscaux : l'historique des autres années n'est pas relu", () => {
  it("la synthèse 2026 ne charge que les factures encaissées en 2026, pas celles de 2022 à 2025", async () => {
    const { contract, h } = await agence();
    for (const annee of [2022, 2023, 2024, 2025]) {
      await createInvoice(contract.id, { periodYear: annee, periodMonth: 3, amount: 500, status: "PAID", paidAt: new Date(annee, 2, 5), dueDate: new Date(annee, 2, 1) });
    }
    await createInvoice(contract.id, { periodYear: 2026, periodMonth: 3, amount: 700, status: "PAID", paidAt: new Date(2026, 2, 5), dueDate: new Date(2026, 2, 1) });
    const espion = vi.spyOn(encaissements, "developperEncaissements");

    const res = await request(app).get("/api/fiscal/synthese?year=2026").set(h);

    expect(res.status).toBe(200);
    expect(res.body.totalRevenueByCurrency).toEqual({ EUR: 700 });
    const lignesLues = espion.mock.calls.reduce((total, [lignes]) => total + lignes.length, 0);
    expect(lignesLues).toBe(1);
  });

  it("le FEC d'une année ne charge pas non plus les autres années", async () => {
    const { contract, h } = await agence();
    await createInvoice(contract.id, { periodYear: 2024, amount: 500, status: "PAID", paidAt: new Date(2024, 2, 5), dueDate: new Date(2024, 2, 1) });
    await createInvoice(contract.id, { periodYear: 2026, amount: 700, status: "PAID", paidAt: new Date(2026, 2, 5), dueDate: new Date(2026, 2, 1) });
    const espion = vi.spyOn(encaissements, "developperEncaissements");

    const res = await request(app).get("/api/fiscal/fec?year=2026").set(h);

    expect(res.status).toBe(200);
    const lignesLues = espion.mock.calls.reduce((total, [lignes]) => total + lignes.length, 0);
    expect(lignesLues).toBe(1);
  });
});

describe("Bilans fiscaux : le résultat reste exact", () => {
  it("une facture réglée en deux fois, à cheval sur deux années, compte chaque paiement dans SON année", async () => {
    const { contract, h } = await agence();
    const facture = await createInvoice(contract.id, { periodYear: 2025, periodMonth: 12, amount: 1000, status: "PAID", paidAt: new Date(2026, 0, 3), dueDate: new Date(2025, 11, 5) });
    await testDb.insert(invoicePayments).values([
      { invoiceId: facture.id, amount: 400, paidAt: new Date(2025, 11, 28), paymentMethod: "CASH" },
      { invoiceId: facture.id, amount: 600, paidAt: new Date(2026, 0, 3), paymentMethod: "CASH" },
    ]);

    const en2025 = await request(app).get("/api/fiscal/synthese?year=2025").set(h);
    const en2026 = await request(app).get("/api/fiscal/synthese?year=2026").set(h);

    expect(en2025.body.totalRevenueByCurrency).toEqual({ EUR: 400 });
    expect(en2026.body.totalRevenueByCurrency).toEqual({ EUR: 600 });
  });

  it("un acompte de l'année compte, même quand la facture n'est pas encore soldée et que son échéance est d'une autre année", async () => {
    const { contract, h } = await agence();
    const facture = await createInvoice(contract.id, { periodYear: 2025, periodMonth: 11, amount: 1000, status: "PENDING", amountPaid: 300, dueDate: new Date(2025, 10, 5) });
    await testDb.insert(invoicePayments).values({ invoiceId: facture.id, amount: 300, paidAt: new Date(2026, 1, 10), paymentMethod: "CASH" });

    const res = await request(app).get("/api/fiscal/synthese?year=2026").set(h);

    expect(res.body.totalRevenueByCurrency).toEqual({ EUR: 300 });
  });

  it("une facture réglée sans date d'encaissement compte à son échéance", async () => {
    const { contract, h } = await agence();
    await createInvoice(contract.id, { periodYear: 2026, periodMonth: 2, amount: 800, status: "PAID", paidAt: null, dueDate: new Date(2026, 1, 5) });
    await createInvoice(contract.id, { periodYear: 2025, periodMonth: 2, amount: 900, status: "PAID", paidAt: null, dueDate: new Date(2025, 1, 5) });

    const res = await request(app).get("/api/fiscal/synthese?year=2026").set(h);

    expect(res.body.totalRevenueByCurrency).toEqual({ EUR: 800 });
  });

  it("les bornes de l'année sont incluses : le 1er janvier 00:00 et le 31 décembre 23:59:59", async () => {
    const { contract, h } = await agence();
    await createInvoice(contract.id, { periodYear: 2026, periodMonth: 1, amount: 100, status: "PAID", paidAt: new Date(2026, 0, 1, 0, 0, 0), dueDate: new Date(2026, 0, 1) });
    await createInvoice(contract.id, { periodYear: 2026, periodMonth: 12, amount: 200, status: "PAID", paidAt: new Date(2026, 11, 31, 23, 59, 59), dueDate: new Date(2026, 11, 1) });
    await createInvoice(contract.id, { periodYear: 2025, periodMonth: 12, amount: 400, status: "PAID", paidAt: new Date(2025, 11, 31, 23, 59, 59), dueDate: new Date(2025, 11, 1) });
    await createInvoice(contract.id, { periodYear: 2027, periodMonth: 1, amount: 800, status: "PAID", paidAt: new Date(2027, 0, 1, 0, 0, 0), dueDate: new Date(2027, 0, 1) });

    const res = await request(app).get("/api/fiscal/synthese?year=2026").set(h);

    expect(res.body.totalRevenueByCurrency).toEqual({ EUR: 300 });
  });

  it("le sélecteur d'année liste les années des encaissements, des paiements partiels et des dépenses, de la plus récente à la plus ancienne", async () => {
    const { property, contract, h } = await agence();
    await createInvoice(contract.id, { periodYear: 2023, periodMonth: 5, amount: 500, status: "PAID", paidAt: new Date(2023, 4, 5), dueDate: new Date(2023, 4, 1) });
    const partielle = await createInvoice(contract.id, { periodYear: 2024, periodMonth: 12, amount: 500, status: "PENDING", amountPaid: 100, dueDate: new Date(2024, 11, 5) });
    await testDb.insert(invoicePayments).values({ invoiceId: partielle.id, amount: 100, paidAt: new Date(2025, 0, 8), paymentMethod: "CASH" });
    await testDb.insert(expenses).values({ propertyId: property.id, category: "TAX", title: "Taxe", amount: 50, expenseDate: new Date(2021, 5, 1) });

    const res = await request(app).get("/api/fiscal/synthese?year=2026").set(h);

    // 2026 : l'année en cours, toujours proposée ; 2024 n'a aucun encaissement (le paiement partiel est de 2025).
    expect(res.body.availableYears).toEqual([2026, 2025, 2023, 2021]);
  });

  it("une autre agence n'apparaît dans aucun bilan ni dans le sélecteur d'année", async () => {
    const { h } = await agence();
    const autre = await agence();
    await createInvoice(autre.contract.id, { periodYear: 2019, periodMonth: 3, amount: 9999, status: "PAID", paidAt: new Date(2019, 2, 5), dueDate: new Date(2019, 2, 1) });

    const res = await request(app).get("/api/fiscal/synthese?year=2019").set(h);

    expect(res.body.totalRevenueByCurrency).toEqual({});
    expect(res.body.availableYears).toEqual([2026]);
  });
});
