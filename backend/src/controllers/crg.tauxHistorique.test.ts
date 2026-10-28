import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { ownerFeeRates } from "../db/schema";
import { authHeader, createContract, createInvoice, createManager, createOwner, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { tauxDuMois } from "../utils/tauxCommission";

/**
 * Changer le taux de commission d'un propriétaire ne recalcule pas les mois passés : un compte-rendu ou un relevé déjà remis
 * garde le taux qui était en vigueur. Le nouveau taux vaut à partir du mois en cours.
 */
async function agence() {
  const manager = await createManager();
  const owner = await createOwner(manager.id, { managementFeeRate: 10 });
  const property = await createProperty(manager.id, { title: "Villa Ngor", ownerId: owner.id });
  const contract = await createContract(property.id, (await createTenant(manager.id)).id);
  // Mars et septembre : 1 000 chacun.
  await createInvoice(contract.id, { periodMonth: 3, amount: 1000, status: "PAID", paidAt: new Date(2026, 2, 5) });
  await createInvoice(contract.id, { periodMonth: 9, amount: 1000, status: "PAID", paidAt: new Date(2026, 8, 5) });
  return { owner, h: authHeader(tokenFor(manager)) };
}

const changerTaux = (h: Record<string, string>, ownerId: string, managementFeeRate: number) =>
  request(app).put(`/api/owners/${ownerId}`).set(h).send({ managementFeeRate });

describe("tauxDuMois", () => {
  it("sans historique, le taux actuel vaut pour tous les mois", () => {
    expect(tauxDuMois(8, [], 1, 2020)).toBe(8);
    expect(tauxDuMois(8, [], 12, 2030)).toBe(8);
  });

  it("prend la dernière ligne datée du mois ou d'avant, quel que soit l'ordre des lignes", () => {
    const historique = [
      { year: 2026, month: 9, rate: 12 },
      { year: 1970, month: 1, rate: 10 },
      { year: 2027, month: 2, rate: 15 },
    ];
    expect(tauxDuMois(15, historique, 3, 2025)).toBe(10);
    expect(tauxDuMois(15, historique, 8, 2026)).toBe(10);
    expect(tauxDuMois(15, historique, 9, 2026)).toBe(12);
    expect(tauxDuMois(15, historique, 12, 2026)).toBe(12);
    expect(tauxDuMois(15, historique, 2, 2027)).toBe(15);
  });
});

describe("taux de commission — les mois passés gardent leur taux", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 20)); // 20 septembre 2026
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("le nouveau taux vaut à partir du mois en cours, les mois d'avant gardent l'ancien", async () => {
    const { owner, h } = await agence();

    const maj = await changerTaux(h, owner.id, 12);
    expect(maj.status).toBe(200);
    expect(maj.body.managementFeeRate).toBe(12);

    const mars = await request(app).get(`/api/crg/${owner.id}?month=3&year=2026`).set(h);
    expect(mars.body.managementFeeRate).toBe(10);
    expect(mars.body.totalCommissionByCurrency).toEqual({ EUR: 100 });
    expect(mars.body.totalNetByCurrency).toEqual({ EUR: 900 });

    const septembre = await request(app).get(`/api/crg/${owner.id}?month=9&year=2026`).set(h);
    expect(septembre.body.managementFeeRate).toBe(12);
    expect(septembre.body.totalCommissionByCurrency).toEqual({ EUR: 120 });
    expect(septembre.body.totalNetByCurrency).toEqual({ EUR: 880 });
  });

  it("le relevé annuel additionne chaque mois à son taux et affiche la suite des taux", async () => {
    const { owner, h } = await agence();
    await changerTaux(h, owner.id, 12);

    const res = await request(app).get(`/api/crg/${owner.id}/annual?year=2026`).set(h);

    expect(res.body.totalCommissionByCurrency).toEqual({ EUR: 220 });
    expect(res.body.totalNetByCurrency).toEqual({ EUR: 1780 });
    expect(res.body.managementFeeRates).toEqual([10, 12]);
    expect(res.body.managementFeeRate).toBe(12);

    const doc = await request(app).get(`/api/crg/${owner.id}/annual/export?year=2026`).set(h);
    expect(doc.text).toContain("10 % → 12 %");
  });

  it("changer de taux avant tout encaissement de l'année ne laisse qu'un seul taux à l'écran", async () => {
    const { owner, h } = await agence();
    await changerTaux(h, owner.id, 12);

    const res = await request(app).get(`/api/crg/${owner.id}/annual?year=2025`).set(h);

    expect(res.body.managementFeeRates).toEqual([10]);
  });

  it("changer deux fois dans le même mois remplace le taux du mois, sans toucher aux mois d'avant", async () => {
    const { owner, h } = await agence();
    await changerTaux(h, owner.id, 12);
    await changerTaux(h, owner.id, 9);

    const septembre = await request(app).get(`/api/crg/${owner.id}?month=9&year=2026`).set(h);
    expect(septembre.body.managementFeeRate).toBe(9);
    const mars = await request(app).get(`/api/crg/${owner.id}?month=3&year=2026`).set(h);
    expect(mars.body.managementFeeRate).toBe(10);
    // Une ligne pour l'ancien taux, une pour le mois en cours.
    expect(await testDb.select().from(ownerFeeRates).where(eq(ownerFeeRates.ownerId, owner.id))).toHaveLength(2);
  });

  it("n'enregistre rien tant que le taux ne change pas (autre champ, ou même taux)", async () => {
    const { owner, h } = await agence();

    await request(app).put(`/api/owners/${owner.id}`).set(h).send({ notes: "Appeler le lundi" });
    await changerTaux(h, owner.id, 10);

    expect(await testDb.select().from(ownerFeeRates).where(eq(ownerFeeRates.ownerId, owner.id))).toHaveLength(0);
    const septembre = await request(app).get(`/api/crg/${owner.id}?month=9&year=2026`).set(h);
    expect(septembre.body.totalCommissionByCurrency).toEqual({ EUR: 100 });
  });

  it("un taux refusé (hors bornes) n'écrit rien dans l'historique", async () => {
    const { owner, h } = await agence();

    const res = await changerTaux(h, owner.id, 150);

    expect(res.status).toBe(400);
    expect(await testDb.select().from(ownerFeeRates).where(eq(ownerFeeRates.ownerId, owner.id))).toHaveLength(0);
  });
});
