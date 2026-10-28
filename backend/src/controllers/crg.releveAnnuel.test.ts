import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { expenses } from "../db/schema";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createOwner,
  createOwnerPortalUser,
  createProperty,
  createTenant,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Relevé annuel des loyers d'un propriétaire : la somme exacte de ses douze comptes-rendus mensuels (même code de calcul,
 * même base d'encaissement, même commission arrondie mois par mois), sans jamais mélanger les devises. Document
 * informatif : il n'affirme aucune règle d'impôt.
 */
async function agence(ownerExtra: Record<string, unknown> = {}) {
  const manager = await createManager();
  const owner = await createOwner(manager.id, { managementFeeRate: 10, ...ownerExtra });
  const property = await createProperty(manager.id, { title: "Villa Ngor", ownerId: owner.id });
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id);
  // Mars 1 000, avril 2 000 (avec 100 de charges), septembre 1 000.
  await createInvoice(contract.id, { periodMonth: 3, amount: 1000, status: "PAID", paidAt: new Date(2026, 2, 5) });
  await createInvoice(contract.id, { periodMonth: 4, amount: 2000, status: "PAID", paidAt: new Date(2026, 3, 5) });
  await createInvoice(contract.id, { periodMonth: 9, amount: 1000, status: "PAID", paidAt: new Date(2026, 8, 5) });
  await testDb.insert(expenses).values({ propertyId: property.id, category: "MAINTENANCE", title: "Plomberie", amount: 100, expenseDate: new Date(2026, 3, 10) });
  return { manager, owner, property, contract, h: authHeader(tokenFor(manager)) };
}

describe("relevé annuel (gestionnaire)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 20)); // 20 septembre 2026
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("totalise l'année, mois par mois et par bien, commission arrondie mois par mois", async () => {
    const { owner, property, h } = await agence();

    const res = await request(app).get(`/api/crg/${owner.id}/annual?year=2026`).set(h);

    expect(res.status).toBe(200);
    expect(res.body.year).toBe(2026);
    expect(res.body.managementFeeRate).toBe(10);
    expect(res.body.months).toHaveLength(12);
    expect(res.body.totalLoyersByCurrency).toEqual({ EUR: 4000 });
    expect(res.body.totalChargesByCurrency).toEqual({ EUR: 100 });
    expect(res.body.totalCommissionByCurrency).toEqual({ EUR: 400 });
    expect(res.body.totalNetByCurrency).toEqual({ EUR: 3500 });
    expect(res.body.properties).toEqual([
      { propertyId: property.id, propertyTitle: "Villa Ngor", currency: "EUR", loyersEncaisses: 4000, chargesDeduites: 100, commission: 400, netAReverser: 3500 },
    ]);
    const parMois = Object.fromEntries(res.body.months.map((m: { month: number }) => [m.month, m]));
    expect(parMois[3].totalLoyersByCurrency).toEqual({ EUR: 1000 });
    expect(parMois[4]).toMatchObject({ totalLoyersByCurrency: { EUR: 2000 }, totalChargesByCurrency: { EUR: 100 }, totalCommissionByCurrency: { EUR: 200 }, totalNetByCurrency: { EUR: 1700 } });
    expect(parMois[9].totalNetByCurrency).toEqual({ EUR: 900 });
    // Un mois sans activité reste présent, à zéro, dans la devise du bien.
    expect(parMois[1].totalLoyersByCurrency).toEqual({ EUR: 0 });
  });

  it("chaque mois du relevé est exactement le compte-rendu mensuel que le propriétaire reçoit", async () => {
    const { owner, h } = await agence();
    const annuel = await request(app).get(`/api/crg/${owner.id}/annual?year=2026`).set(h);

    for (const month of [3, 4, 9]) {
      const mensuel = await request(app).get(`/api/crg/${owner.id}?month=${month}&year=2026`).set(h);
      const ligne = annuel.body.months.find((m: { month: number }) => m.month === month);
      expect(ligne, `mois ${month}`).toMatchObject({
        totalLoyersByCurrency: mensuel.body.totalLoyersByCurrency,
        totalChargesByCurrency: mensuel.body.totalChargesByCurrency,
        totalCommissionByCurrency: mensuel.body.totalCommissionByCurrency,
        totalNetByCurrency: mensuel.body.totalNetByCurrency,
      });
    }
  });

  it("compte les reversements de l'année et ce qui reste à reverser", async () => {
    const { owner, h } = await agence();
    const verse = await request(app)
      .post(`/api/crg/${owner.id}/payouts`)
      .set(h)
      .send({ month: 3, year: 2026, currency: "EUR", amount: 800, method: "BANK_TRANSFER", paidAt: "2026-04-05", reference: "VIR-0326", note: "Note interne" });
    expect(verse.status).toBe(201);

    const res = await request(app).get(`/api/crg/${owner.id}/annual?year=2026`).set(h);

    expect(res.body.totalReverseByCurrency).toEqual({ EUR: 800 });
    expect(res.body.resteAReverserByCurrency).toEqual({ EUR: 2700 });
    expect(res.body.reversements).toHaveLength(1);
    expect(res.body.reversements[0]).toMatchObject({ amount: 800, reference: "VIR-0326", note: "Note interne" });
    const mars = res.body.months.find((m: { month: number }) => m.month === 3);
    expect(mars.totalReverseByCurrency).toEqual({ EUR: 800 });
  });

  it("une autre année ne reprend rien : tout à zéro", async () => {
    const { owner, h } = await agence();
    const res = await request(app).get(`/api/crg/${owner.id}/annual?year=2025`).set(h);
    expect(res.status).toBe(200);
    expect(res.body.totalLoyersByCurrency).toEqual({ EUR: 0 });
    expect(res.body.totalNetByCurrency).toEqual({ EUR: 0 });
    expect(res.body.reversements).toEqual([]);
  });

  it("ne mélange pas les devises : une ligne par devise, jamais de somme croisée", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { managementFeeRate: 8 });
    const bienEur = await createProperty(manager.id, { currency: "EUR", ownerId: owner.id, title: "Studio Paris" });
    const contratEur = await createContract(bienEur.id, (await createTenant(manager.id)).id, { currency: "EUR" });
    await createInvoice(contratEur.id, { periodMonth: 5, amount: 1000, currency: "EUR", status: "PAID", paidAt: new Date(2026, 4, 5) });
    const bienXof = await createProperty(manager.id, { currency: "XOF", ownerId: owner.id, title: "Villa Dakar" });
    const contratXof = await createContract(bienXof.id, (await createTenant(manager.id)).id, { currency: "XOF" });
    await createInvoice(contratXof.id, { periodMonth: 5, amount: 500000, currency: "XOF", status: "PAID", paidAt: new Date(2026, 4, 6) });

    const res = await request(app).get(`/api/crg/${owner.id}/annual?year=2026`).set(authHeader(tokenFor(manager)));

    expect(res.body.totalLoyersByCurrency).toEqual({ EUR: 1000, XOF: 500000 });
    expect(res.body.totalCommissionByCurrency).toEqual({ EUR: 80, XOF: 40000 });
    expect(res.body.totalNetByCurrency).toEqual({ EUR: 920, XOF: 460000 });
    expect(res.body.properties.map((p: { propertyTitle: string; currency: string }) => `${p.propertyTitle}:${p.currency}`)).toEqual(["Studio Paris:EUR", "Villa Dakar:XOF"]);
  });

  it("refuse une année hors bornes et le propriétaire d'une autre agence", async () => {
    const { owner, h } = await agence();
    expect((await request(app).get(`/api/crg/${owner.id}/annual?year=1999`).set(h)).status).toBe(400);

    const autre = await createManager();
    const res = await request(app).get(`/api/crg/${owner.id}/annual?year=2026`).set(authHeader(tokenFor(autre)));
    expect(res.status).toBe(404);
  });
});

describe("relevé annuel (export et espace propriétaire)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 20));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("le document est imprimable, dans la langue du propriétaire, sans prétendre être une déclaration fiscale", async () => {
    const { owner, h } = await agence();

    const fr = await request(app).get(`/api/crg/${owner.id}/annual/export?year=2026`).set(h);
    expect(fr.status).toBe(200);
    expect(fr.headers["content-type"]).toContain("text/html");
    expect(fr.text).toContain("RELEVÉ ANNUEL DES LOYERS");
    expect(fr.text).toContain("Année : 2026");
    expect(fr.text).toContain("Villa Ngor");
    expect(fr.text).toContain("Avril");
    expect(fr.text).toContain("ne constitue pas une déclaration fiscale");

    const { owner: ownerEn, h: hEn } = await agence({ language: "en" });
    const en = await request(app).get(`/api/crg/${ownerEn.id}/annual/export?year=2026`).set(hEn);
    expect(en.text).toContain("ANNUAL RENT STATEMENT");
    expect(en.text).toContain("April");
    expect(en.text).toContain("not a tax return");
  });

  it("échappe le nom d'un bien dans le document", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { managementFeeRate: 5 });
    await createProperty(manager.id, { ownerId: owner.id, title: "<script>alert(1)</script>" });

    const res = await request(app).get(`/api/crg/${owner.id}/annual/export?year=2026`).set(authHeader(tokenFor(manager)));

    expect(res.text).not.toContain("<script>alert(1)</script>");
    expect(res.text).toContain("&lt;script&gt;");
  });

  it("le propriétaire lit SON relevé, sans les notes internes des reversements", async () => {
    const { manager, owner, h } = await agence();
    const ownerUser = await createOwnerPortalUser(owner);
    await request(app)
      .post(`/api/crg/${owner.id}/payouts`)
      .set(h)
      .send({ month: 3, year: 2026, currency: "EUR", amount: 500, method: "CASH", paidAt: "2026-04-05", note: "Propriétaire difficile à joindre" });
    const jetonProprietaire = authHeader(tokenFor(ownerUser, null, owner.id));

    const res = await request(app).get("/api/crg/mine/annual?year=2026").set(jetonProprietaire);

    expect(res.status).toBe(200);
    expect(res.body.totalNetByCurrency).toEqual({ EUR: 3500 });
    expect(res.body.reversements).toHaveLength(1);
    expect(res.body.reversements[0]).not.toHaveProperty("note");
    expect(JSON.stringify(res.body)).not.toContain("difficile");

    const doc = await request(app).get("/api/crg/mine/annual/export?year=2026").set(jetonProprietaire);
    expect(doc.status).toBe(200);
    expect(doc.text).toContain("RELEVÉ ANNUEL DES LOYERS");

    // Le gestionnaire n'a pas accès aux routes de l'espace propriétaire, ni l'inverse.
    expect((await request(app).get("/api/crg/mine/annual?year=2026").set(authHeader(tokenFor(manager)))).status).toBe(403);
    expect((await request(app).get(`/api/crg/${owner.id}/annual?year=2026`).set(jetonProprietaire)).status).toBe(403);
  });
});
