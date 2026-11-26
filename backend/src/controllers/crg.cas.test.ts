import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { agencySettings, expenses, invoicePayments, ownerFeeRates, ownerPayouts } from "../db/schema";
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
import { computeCrg, computeCrgPourProprietaires } from "./crg.controller";

/**
 * Cas limites du compte-rendu de gestion (CRG) mensuel et du relevé annuel : bornes exactes du mois et de l'année (à la milliseconde),
 * paramètres de la requête, arrondis au centime, plusieurs propriétaires calculés ensemble, reversements, taux de commission
 * mois par mois, notes internes cachées au propriétaire, et documents exportés (langue du propriétaire, nom de l'agence).
 */

const d = (annee: number, mois: number, jour: number, h = 0, mn = 0, s = 0, ms = 0) => new Date(annee, mois - 1, jour, h, mn, s, ms);
const entete = (m: { id: string }) => authHeader(tokenFor(m as never));

let compteur = 0;
/** Un loyer encaissé à une date donnée (chaque facture a sa propre période pour ne jamais se heurter à l'unicité). */
async function encaisser(contractId: string, amount: number, paidAt: Date, extra: Record<string, unknown> = {}) {
  compteur += 1;
  return createInvoice(contractId, { periodMonth: 1, periodYear: 1000 + compteur, amount, status: "PAID", paidAt, ...extra });
}
async function depenser(propertyId: string, amount: number, expenseDate: Date, extra: Record<string, unknown> = {}) {
  await testDb.insert(expenses).values({ propertyId, category: "MAINTENANCE", title: "Dépense", amount, expenseDate, ...extra });
}
async function reverser(ownerId: string, month: number, year: number, amount: number, extra: Record<string, unknown> = {}) {
  const [ligne] = await testDb
    .insert(ownerPayouts)
    .values({ ownerId, periodMonth: month, periodYear: year, currency: "EUR", amount, paidAt: d(year, month, 28), method: "BANK_TRANSFER", ...extra })
    .returning();
  return ligne;
}

async function agence(ownerExtra: Record<string, unknown> = {}, propertyExtra: Record<string, unknown> = {}) {
  const manager = await createManager();
  const owner = await createOwner(manager.id, { managementFeeRate: 0, ...ownerExtra });
  const property = await createProperty(manager.id, { title: "Villa Ngor", ownerId: owner.id, ...propertyExtra });
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id);
  return { manager, owner, property, tenant, contract, h: entete(manager) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 20)); // 20 septembre 2026
});
afterEach(() => {
  vi.useRealTimers();
});

describe("paramètres de la requête", () => {
  it("accepte le mois 1 et le mois 12, refuse 0, 13 et un mois décimal", async () => {
    const { owner, h } = await agence();
    for (const [mois, statut] of [
      ["1", 200],
      ["12", 200],
      ["0", 400],
      ["13", 400],
      ["1.5", 400],
    ] as const) {
      const res = await request(app).get(`/api/crg/${owner.id}?month=${mois}&year=2026`).set(h);
      expect(res.status, `mois ${mois}`).toBe(statut);
    }
  });

  it("accepte les années 2000 et 2100, refuse 1999, 2101 et une année décimale", async () => {
    const { owner, h } = await agence();
    for (const [annee, statut] of [
      ["2000", 200],
      ["2100", 200],
      ["1999", 400],
      ["2101", 400],
      ["2026.5", 400],
    ] as const) {
      const mensuel = await request(app).get(`/api/crg/${owner.id}?month=3&year=${annee}`).set(h);
      expect(mensuel.status, `CRG ${annee}`).toBe(statut);
      const annuel = await request(app).get(`/api/crg/${owner.id}/annual?year=${annee}`).set(h);
      expect(annuel.status, `relevé ${annee}`).toBe(statut);
    }
  });

  it("prend le mois et l'année demandés, et complète seulement ce qui manque avec la date du jour", async () => {
    const { owner, h } = await agence();

    const complet = await request(app).get(`/api/crg/${owner.id}?month=3&year=2025`).set(h);
    expect(complet.body).toMatchObject({ month: 3, year: 2025 });

    const moisSeul = await request(app).get(`/api/crg/${owner.id}?month=3`).set(h);
    expect(moisSeul.body).toMatchObject({ month: 3, year: 2026 });

    const anneeSeule = await request(app).get(`/api/crg/${owner.id}?year=2025`).set(h);
    expect(anneeSeule.body).toMatchObject({ month: 9, year: 2025 });
  });

  it("relevé annuel : l'année demandée, ou l'année en cours à défaut", async () => {
    const { manager, owner, h } = await agence();
    const ownerUser = await createOwnerPortalUser(owner);
    const hOwner = authHeader(tokenFor(ownerUser, null, owner.id));
    void manager;

    expect((await request(app).get(`/api/crg/${owner.id}/annual?year=2024`).set(h)).body.year).toBe(2024);
    expect((await request(app).get(`/api/crg/${owner.id}/annual`).set(h)).body.year).toBe(2026);
    expect((await request(app).get("/api/crg/mine/annual?year=2024").set(hOwner)).body.year).toBe(2024);
    expect((await request(app).get("/api/crg/mine/annual").set(hOwner)).body.year).toBe(2026);
    expect((await request(app).get("/api/crg/mine/annual/export?year=2024").set(hOwner)).text).toContain("2024");
    expect((await request(app).get(`/api/crg/${owner.id}/annual/export?year=2024`).set(h)).text).toContain("2024");
  });
});

describe("propriétaire introuvable ou d'une autre agence", () => {
  it("répond 404 OWNER_NOT_FOUND sur les quatre routes du gestionnaire, que le propriétaire existe ailleurs ou pas", async () => {
    const { h } = await agence();
    const autre = await createManager();
    const etranger = await createOwner(autre.id);

    for (const id of [etranger.id, "inconnu"]) {
      for (const chemin of ["", "/export", "/annual", "/annual/export"]) {
        const res = await request(app).get(`/api/crg/${id}${chemin}`).set(h);
        expect(res.status, `${id}${chemin}`).toBe(404);
        expect(res.body.code, `${id}${chemin}`).toBe("OWNER_NOT_FOUND");
      }
    }
  });
});

describe("bornes du mois, à la milliseconde", () => {
  it("compte les loyers et les charges de toute la journée du 1er au dernier jour, et pas une milliseconde de plus", async () => {
    const { owner, property, contract, h } = await agence();
    const dedans: Array<[number, Date]> = [
      [1, d(2026, 9, 1, 0, 0, 0, 0)],
      [2, d(2026, 9, 1, 0, 30)],
      [4, d(2026, 9, 30, 23, 59, 59, 999)],
      [8, d(2026, 9, 30, 23, 59, 59, 500)],
      [16, d(2026, 9, 30, 23, 59, 30)],
      [32, d(2026, 9, 30, 23, 30)],
      [64, d(2026, 9, 30, 18)],
      [128, d(2026, 9, 30, 12)],
      [256, d(2026, 9, 15)],
    ];
    const dehors: Array<[number, Date]> = [
      [512, d(2026, 8, 31, 23, 59, 59, 999)],
      [1024, d(2026, 10, 1, 0, 0, 0, 0)],
    ];
    for (const [montant, date] of [...dedans, ...dehors]) {
      await encaisser(contract.id, montant, date);
      await depenser(property.id, montant, date);
    }

    const res = await request(app).get(`/api/crg/${owner.id}?month=9&year=2026`).set(h);

    expect(res.body.totalLoyersByCurrency).toEqual({ EUR: 511 });
    expect(res.body.totalChargesByCurrency).toEqual({ EUR: 511 });
  });

  it("le dernier jour de février d'une année bissextile ferme bien le mois", async () => {
    const { owner, contract, h } = await agence();
    await encaisser(contract.id, 10, d(2028, 2, 29, 23, 59, 59, 999));
    await encaisser(contract.id, 20, d(2028, 3, 1, 0, 0, 0, 0));

    const fevrier = await request(app).get(`/api/crg/${owner.id}?month=2&year=2028`).set(h);
    const mars = await request(app).get(`/api/crg/${owner.id}?month=3&year=2028`).set(h);

    expect(fevrier.body.totalLoyersByCurrency).toEqual({ EUR: 10 });
    expect(mars.body.totalLoyersByCurrency).toEqual({ EUR: 20 });
  });

  it("une facture sans date de paiement compte à son échéance", async () => {
    const { owner, contract, h } = await agence();
    await createInvoice(contract.id, { periodMonth: 1, periodYear: 1990, amount: 70, status: "PAID", paidAt: null, dueDate: d(2026, 9, 12) });
    await createInvoice(contract.id, { periodMonth: 2, periodYear: 1990, amount: 700, status: "PAID", paidAt: null, dueDate: d(2026, 8, 12) });
    // Un paiement daté d'août ne se rattache pas à l'échéance de septembre.
    await createInvoice(contract.id, { periodMonth: 3, periodYear: 1990, amount: 7000, status: "PAID", paidAt: d(2026, 8, 3), dueDate: d(2026, 9, 12) });

    const res = await request(app).get(`/api/crg/${owner.id}?month=9&year=2026`).set(h);

    expect(res.body.totalLoyersByCurrency).toEqual({ EUR: 70 });
  });

  it("ne compte pas une facture impayée, et compte chaque paiement partiel à sa date et pour son montant", async () => {
    const { owner, contract, h } = await agence();
    await createInvoice(contract.id, { periodMonth: 1, periodYear: 1991, amount: 900, status: "PENDING", dueDate: d(2026, 9, 5) });
    const partielle = await createInvoice(contract.id, { periodMonth: 2, periodYear: 1991, amount: 500, status: "PENDING", amountPaid: 300, dueDate: d(2026, 8, 5) });
    await testDb.insert(invoicePayments).values([
      { invoiceId: partielle.id, amount: 100, paidAt: d(2026, 8, 10), paymentMethod: "CASH" },
      { invoiceId: partielle.id, amount: 200, paidAt: d(2026, 9, 10), paymentMethod: "CASH" },
    ]);

    const septembre = await request(app).get(`/api/crg/${owner.id}?month=9&year=2026`).set(h);
    const aout = await request(app).get(`/api/crg/${owner.id}?month=8&year=2026`).set(h);

    expect(septembre.body.totalLoyersByCurrency).toEqual({ EUR: 200 });
    expect(aout.body.totalLoyersByCurrency).toEqual({ EUR: 100 });
  });
});

describe("calculs au centime", () => {
  it("arrondit les loyers, les charges, la commission et le net, ligne par ligne puis au total", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { managementFeeRate: 10 });
    const tenant = await createTenant(manager.id);
    const biens = [];
    for (const titre of ["Appart A", "Appart B"]) {
      const bien = await createProperty(manager.id, { title: titre, ownerId: owner.id });
      biens.push({ bien, contrat: await createContract(bien.id, tenant.id) });
    }
    // A : 333,33 de loyer ; deux charges dont la somme en flottants traîne (10,10 + 20,20).
    await encaisser(biens[0].contrat.id, 333.33, d(2026, 9, 5));
    await depenser(biens[0].bien.id, 10.1, d(2026, 9, 6));
    await depenser(biens[0].bien.id, 20.2, d(2026, 9, 7));
    // B : 666,66 de loyer ; 10 % = 66,666 → 66,67 (arrondi au plus proche, pas vers le bas).
    await encaisser(biens[1].contrat.id, 666.66, d(2026, 9, 5));

    const crg = await computeCrg(owner, 9, 2026);

    expect(crg.properties).toEqual([
      { propertyId: biens[0].bien.id, propertyTitle: "Appart A", currency: "EUR", loyersEncaisses: 333.33, chargesDeduites: 30.3, commission: 33.33, netAReverser: 269.7 },
      { propertyId: biens[1].bien.id, propertyTitle: "Appart B", currency: "EUR", loyersEncaisses: 666.66, chargesDeduites: 0, commission: 66.67, netAReverser: 599.99 },
    ]);
    expect(crg.totalLoyersByCurrency).toEqual({ EUR: 999.99 });
    expect(crg.totalChargesByCurrency).toEqual({ EUR: 30.3 });
    expect(crg.totalCommissionByCurrency).toEqual({ EUR: 100 });
    expect(crg.totalNetByCurrency).toEqual({ EUR: 869.69 });
  });

  it("additionne plusieurs loyers et plusieurs charges d'un même bien, la commission porte sur les loyers seuls", async () => {
    const { owner, property, contract } = await agence({ managementFeeRate: 8.5 });
    await encaisser(contract.id, 400, d(2026, 9, 2));
    await encaisser(contract.id, 600, d(2026, 9, 3));
    await depenser(property.id, 50, d(2026, 9, 4));
    await depenser(property.id, 70, d(2026, 9, 5));

    const [ligne] = (await computeCrg(owner, 9, 2026)).properties;

    expect(ligne).toMatchObject({ loyersEncaisses: 1000, chargesDeduites: 120, commission: 85, netAReverser: 795 });
  });

  it("arrondit chaque total au centime (0,1 + 0,2 = 0,3)", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { managementFeeRate: 1 });
    const tenant = await createTenant(manager.id);
    for (const [titre, loyer, charge] of [
      ["Bien 1", 10, 0.1],
      ["Bien 2", 20, 0.2],
    ] as const) {
      const bien = await createProperty(manager.id, { title: titre, ownerId: owner.id });
      const contrat = await createContract(bien.id, tenant.id);
      await encaisser(contrat.id, loyer, d(2026, 9, 5));
      await depenser(bien.id, charge, d(2026, 9, 6));
    }

    const crg = await computeCrg(owner, 9, 2026);

    // Commissions 0,10 et 0,20 ; nets 9,80 et 19,60 : chaque somme de deux montants décimaux laisse un reste binaire sans arrondi.
    expect(crg.totalLoyersByCurrency).toEqual({ EUR: 30 });
    expect(crg.totalChargesByCurrency).toEqual({ EUR: 0.3 });
    expect(crg.totalCommissionByCurrency).toEqual({ EUR: 0.3 });
    expect(crg.totalNetByCurrency).toEqual({ EUR: 29.4 });
  });

  it("additionne des loyers décimaux au centime près (10,10 + 20,20 = 30,30)", async () => {
    const { owner, contract } = await agence();
    await encaisser(contract.id, 10.1, d(2026, 9, 2));
    await encaisser(contract.id, 20.2, d(2026, 9, 3));

    const crg = await computeCrg(owner, 9, 2026);

    expect(crg.properties[0].loyersEncaisses).toBe(30.3);
    expect(crg.totalLoyersByCurrency).toEqual({ EUR: 30.3 });
  });

  it("les lignes sortent triées par titre puis par devise, quel que soit l'ordre de création", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id);
    const tenant = await createTenant(manager.id);
    const creer = (titre: string, currency: string) => createProperty(manager.id, { title: titre, ownerId: owner.id, currency });
    const b = await creer("Bien B", "EUR");
    const aXof = await creer("Bien A", "XOF");
    // Même bien, loyer dans une autre devise que celle du bien : deux lignes pour « Bien C ».
    const c = await creer("Bien C", "XOF");
    const contratC = await createContract(c.id, tenant.id, { currency: "EUR" });
    await encaisser(contratC.id, 10, d(2026, 9, 5));
    void b;
    void aXof;

    const crg = await computeCrg(owner, 9, 2026);

    expect(crg.properties.map((p) => `${p.propertyTitle}|${p.currency}`)).toEqual(["Bien A|XOF", "Bien B|EUR", "Bien C|EUR", "Bien C|XOF"]);
  });

  it("un bien sans aucune activité garde sa ligne à zéro dans la devise du bien", async () => {
    const { owner, property } = await agence({}, { currency: "XOF" });

    const crg = await computeCrg(owner, 9, 2026);

    expect(crg.properties).toEqual([
      { propertyId: property.id, propertyTitle: "Villa Ngor", currency: "XOF", loyersEncaisses: 0, chargesDeduites: 0, commission: 0, netAReverser: 0 },
    ]);
    expect(crg.totalNetByCurrency).toEqual({ XOF: 0 });
    expect(crg.resteAReverserByCurrency).toEqual({ XOF: 0 });
  });

  it("un bien du propriétaire sans bail, et un propriétaire sans bien, se calculent sans erreur", async () => {
    const manager = await createManager();
    const sansBail = await createOwner(manager.id);
    await createProperty(manager.id, { title: "Terrain nu", ownerId: sansBail.id });
    const sansBien = await createOwner(manager.id);

    const [a, b] = await computeCrgPourProprietaires([sansBail, sansBien], 9, 2026);

    expect(a.properties).toHaveLength(1);
    expect(a.properties[0]).toMatchObject({ propertyTitle: "Terrain nu", loyersEncaisses: 0 });
    expect(b.properties).toEqual([]);
    expect(b.totalLoyersByCurrency).toEqual({});
    expect(b.resteAReverserByCurrency).toEqual({});
  });
});

describe("plusieurs propriétaires calculés ensemble", () => {
  it("sans propriétaire, rien à calculer", async () => {
    expect(await computeCrgPourProprietaires([], 9, 2026)).toEqual([]);
  });

  it("chacun reçoit ses propres biens, loyers, charges, reversements et son propre historique de taux", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id);
    const a = await createOwner(manager.id, { managementFeeRate: 10 });
    const b = await createOwner(manager.id, { managementFeeRate: 20 });
    const c = await createOwner(manager.id, { managementFeeRate: 5 });
    const bienA = await createProperty(manager.id, { title: "Bien d'Awa", ownerId: a.id });
    const bienB = await createProperty(manager.id, { title: "Bien de Boubacar", ownerId: b.id });
    const contratA = await createContract(bienA.id, tenant.id);
    const contratB = await createContract(bienB.id, tenant.id);
    await encaisser(contratA.id, 1000, d(2026, 8, 5));
    await encaisser(contratB.id, 2000, d(2026, 8, 6));
    await depenser(bienA.id, 10, d(2026, 8, 7));
    await depenser(bienB.id, 20, d(2026, 8, 8));
    await reverser(a.id, 8, 2026, 111);
    await reverser(b.id, 8, 2026, 222);
    // B a changé de taux : 5 % avant septembre 2026, 20 % depuis. A n'a pas d'historique.
    await testDb.insert(ownerFeeRates).values([
      { ownerId: b.id, effectiveYear: 1970, effectiveMonth: 1, rate: 5 },
      { ownerId: b.id, effectiveYear: 2026, effectiveMonth: 9, rate: 20 },
    ]);

    const [crgA, crgB, crgC] = await computeCrgPourProprietaires([a, b, c], 8, 2026);

    expect([crgA.ownerId, crgB.ownerId, crgC.ownerId]).toEqual([a.id, b.id, c.id]);
    expect(crgA.properties).toEqual([
      { propertyId: bienA.id, propertyTitle: "Bien d'Awa", currency: "EUR", loyersEncaisses: 1000, chargesDeduites: 10, commission: 100, netAReverser: 890 },
    ]);
    expect(crgA.managementFeeRate).toBe(10);
    expect(crgA.reversements.map((r) => r.amount)).toEqual([111]);
    expect(crgA.resteAReverserByCurrency).toEqual({ EUR: 779 });
    expect(crgB.properties).toEqual([
      { propertyId: bienB.id, propertyTitle: "Bien de Boubacar", currency: "EUR", loyersEncaisses: 2000, chargesDeduites: 20, commission: 100, netAReverser: 1880 },
    ]);
    expect(crgB.managementFeeRate).toBe(5);
    expect(crgB.reversements.map((r) => r.amount)).toEqual([222]);
    expect(crgB.resteAReverserByCurrency).toEqual({ EUR: 1658 });
    expect(crgC.properties).toEqual([]);
    expect(crgC.reversements).toEqual([]);
    expect(crgC.managementFeeRate).toBe(5);
  });

  it("un loyer et une charge d'un bien d'un autre propriétaire ne rejoignent jamais le compte-rendu", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id);
    const a = await createOwner(manager.id);
    const b = await createOwner(manager.id);
    const bienA = await createProperty(manager.id, { title: "Bien A", ownerId: a.id });
    const bienB = await createProperty(manager.id, { title: "Bien B", ownerId: b.id });
    await encaisser((await createContract(bienB.id, tenant.id)).id, 999, d(2026, 9, 5));
    await depenser(bienB.id, 99, d(2026, 9, 5));
    await reverser(b.id, 9, 2026, 9);

    const crg = await computeCrg(a, 9, 2026);

    expect(crg.properties.map((p) => p.propertyTitle)).toEqual(["Bien A"]);
    expect(crg.totalLoyersByCurrency).toEqual({ EUR: 0 });
    expect(crg.totalChargesByCurrency).toEqual({ EUR: 0 });
    expect(crg.reversements).toEqual([]);
    void bienA;
  });
});

describe("reversements", () => {
  it("liste ceux du mois, du plus ancien au plus récent (à date égale, dans l'ordre de saisie), avec tous leurs champs", async () => {
    const { owner } = await agence({ managementFeeRate: 0 });
    const autre = await createOwner((await createManager()).id);
    const p1 = await reverser(owner.id, 9, 2026, 100, { paidAt: d(2026, 9, 10), createdAt: d(2026, 9, 10, 12), method: "CASH", reference: "REF-1", note: "Note 1" });
    const p2 = await reverser(owner.id, 9, 2026, 200, { paidAt: d(2026, 9, 10), createdAt: d(2026, 9, 10, 8), method: "CHEQUE", reference: "REF-2", note: "Note 2" });
    const p3 = await reverser(owner.id, 9, 2026, 300, { paidAt: d(2026, 9, 5), createdAt: d(2026, 9, 11), method: "MOBILE_MONEY", reference: null, note: null });
    // Hors périmètre : autre mois, autre année, autre propriétaire.
    await reverser(owner.id, 8, 2026, 1);
    await reverser(owner.id, 9, 2025, 2);
    await reverser(autre.id, 9, 2026, 4);

    const crg = await computeCrg(owner, 9, 2026);

    expect(crg.reversements).toEqual([
      { id: p3.id, currency: "EUR", amount: 300, paidAt: d(2026, 9, 5), method: "MOBILE_MONEY", reference: null, note: null },
      { id: p2.id, currency: "EUR", amount: 200, paidAt: d(2026, 9, 10), method: "CHEQUE", reference: "REF-2", note: "Note 2" },
      { id: p1.id, currency: "EUR", amount: 100, paidAt: d(2026, 9, 10), method: "CASH", reference: "REF-1", note: "Note 1" },
    ]);
  });

  it("totalise par devise au centime et calcule le reste à reverser, y compris pour une devise absente du net ou du reversé", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { managementFeeRate: 10 });
    const tenant = await createTenant(manager.id);
    const bienEur = await createProperty(manager.id, { title: "Bien EUR", ownerId: owner.id });
    await createProperty(manager.id, { title: "Bien XOF", ownerId: owner.id, currency: "XOF" });
    await encaisser((await createContract(bienEur.id, tenant.id)).id, 1000, d(2026, 9, 5));
    await reverser(owner.id, 9, 2026, 0.1);
    await reverser(owner.id, 9, 2026, 0.2);
    await reverser(owner.id, 9, 2026, 50, { currency: "USD" });

    const crg = await computeCrg(owner, 9, 2026);

    expect(crg.totalNetByCurrency).toEqual({ EUR: 900, XOF: 0 });
    expect(crg.totalReverseByCurrency).toEqual({ EUR: 0.3, USD: 50 });
    // 900 − 0,3 ; XOF sans rien reversé ; USD reversé sans aucun net : négatif.
    expect(crg.resteAReverserByCurrency).toEqual({ EUR: 899.7, XOF: 0, USD: -50 });
  });
});

describe("résultat du compte-rendu", () => {
  it("rend l'identité du propriétaire (civilité, société), le taux du mois et la période, sans coordonnées bancaires", async () => {
    const { owner, h } = await agence({ civility: "M", companyName: "SCI Soleil", managementFeeRate: 7 });

    const res = await request(app).get(`/api/crg/${owner.id}?month=4&year=2025`).set(h);

    expect(res.body).toMatchObject({
      ownerId: owner.id,
      ownerName: "Monsieur Fatou Diop",
      ownerCompanyName: "SCI Soleil",
      managementFeeRate: 7,
      month: 4,
      year: 2025,
    });
  });

  it("sans civilité ni société : le nom seul, et une société nulle", async () => {
    const { owner, h } = await agence();

    const res = await request(app).get(`/api/crg/${owner.id}?month=4&year=2025`).set(h);

    expect(res.body).toMatchObject({ ownerName: "Fatou Diop", ownerCompanyName: null });
    expect(res.body).not.toHaveProperty("iban");
    expect(res.body).not.toHaveProperty("bic");
  });

  it("le taux affiché est celui du mois demandé, pas le taux actuel", async () => {
    const { owner, h } = await agence({ managementFeeRate: 15 });
    await testDb.insert(ownerFeeRates).values([
      { ownerId: owner.id, effectiveYear: 1970, effectiveMonth: 1, rate: 10 },
      { ownerId: owner.id, effectiveYear: 2026, effectiveMonth: 9, rate: 12 },
      { ownerId: owner.id, effectiveYear: 2026, effectiveMonth: 11, rate: 15 },
    ]);

    const taux = async (mois: number, annee: number) => (await request(app).get(`/api/crg/${owner.id}?month=${mois}&year=${annee}`).set(h)).body.managementFeeRate;

    expect(await taux(8, 2026)).toBe(10);
    expect(await taux(9, 2026)).toBe(12);
    expect(await taux(10, 2026)).toBe(12);
    expect(await taux(9, 2025)).toBe(10);
    expect(await taux(11, 2026)).toBe(15);
  });
});

describe("l'espace propriétaire ne voit jamais les notes internes de l'agence", () => {
  it("compte-rendu et relevé annuel du propriétaire : sans note, avec le reste du reversement et du document", async () => {
    const { owner, contract, h } = await agence({ managementFeeRate: 10 });
    const ownerUser = await createOwnerPortalUser(owner);
    const hOwner = authHeader(tokenFor(ownerUser, null, owner.id));
    await encaisser(contract.id, 1000, d(2026, 9, 5));
    const versement = await reverser(owner.id, 9, 2026, 400, { reference: "VIR-42", note: "propriétaire difficile à joindre", method: "CHEQUE" });

    const mensuel = await request(app).get("/api/crg/mine?month=9&year=2026").set(hOwner);
    const annuel = await request(app).get("/api/crg/mine/annual?year=2026").set(hOwner);
    const cote = await request(app).get(`/api/crg/${owner.id}?month=9&year=2026`).set(h);
    const coteAnnuel = await request(app).get(`/api/crg/${owner.id}/annual?year=2026`).set(h);

    for (const corps of [mensuel.body, annuel.body]) {
      expect(corps.reversements).toEqual([expect.not.objectContaining({ note: expect.anything() })]);
      expect(corps.reversements[0]).not.toHaveProperty("note");
      expect(corps.reversements[0]).toEqual({ id: versement.id, currency: "EUR", amount: 400, paidAt: d(2026, 9, 28).toISOString(), method: "CHEQUE", reference: "VIR-42" });
      expect(corps.totalLoyersByCurrency).toEqual({ EUR: 1000 });
      expect(corps.totalCommissionByCurrency).toEqual({ EUR: 100 });
      expect(corps.ownerId).toBe(owner.id);
      expect(corps.properties).toHaveLength(1);
    }
    expect(JSON.stringify(mensuel.body)).not.toContain("difficile");
    expect(JSON.stringify(annuel.body)).not.toContain("difficile");
    // Le gestionnaire, lui, voit la note.
    expect(cote.body.reversements[0].note).toBe("propriétaire difficile à joindre");
    expect(coteAnnuel.body.reversements[0].note).toBe("propriétaire difficile à joindre");
  });
});

describe("documents exportés", () => {
  async function exports() {
    const base = await agence({ language: "en" });
    const ownerUser = await createOwnerPortalUser(base.owner);
    const hOwner = authHeader(tokenFor(ownerUser, null, base.owner.id));
    const routes: Array<[string, Record<string, string>, string]> = [
      [`/api/crg/${base.owner.id}/export?month=9&year=2026`, base.h, "MANAGEMENT REPORT"],
      ["/api/crg/mine/export?month=9&year=2026", hOwner, "MANAGEMENT REPORT"],
      [`/api/crg/${base.owner.id}/annual/export?year=2026`, base.h, "ANNUAL RENT STATEMENT"],
      ["/api/crg/mine/annual/export?year=2026", hOwner, "ANNUAL RENT STATEMENT"],
    ];
    return { ...base, hOwner, routes };
  }

  it("quatre exports en HTML, écrits dans la langue du propriétaire quelle que soit celle du lecteur", async () => {
    const { routes } = await exports();

    for (const [chemin, h, titre] of routes) {
      const res = await request(app).get(chemin).set(h);
      expect(res.status, chemin).toBe(200);
      expect(res.headers["content-type"], chemin).toBe("text/html; charset=utf-8");
      expect(res.text, chemin).toContain(titre);
      expect(res.text, chemin).toContain('<html lang="en">');
    }
  });

  it("sans langue renseignée, le français", async () => {
    const { owner, h } = await agence();
    const ownerUser = await createOwnerPortalUser(owner);
    const hOwner = authHeader(tokenFor(ownerUser, null, owner.id));

    for (const [chemin, entetes, titre] of [
      [`/api/crg/${owner.id}/export?month=9&year=2026`, h, "COMPTE-RENDU DE GESTION"],
      ["/api/crg/mine/export?month=9&year=2026", hOwner, "COMPTE-RENDU DE GESTION"],
      [`/api/crg/${owner.id}/annual/export?year=2026`, h, "RELEVÉ ANNUEL DES LOYERS"],
      ["/api/crg/mine/annual/export?year=2026", hOwner, "RELEVÉ ANNUEL DES LOYERS"],
    ] as const) {
      const res = await request(app).get(chemin).set(entetes);
      expect(res.text, chemin).toContain(titre);
      expect(res.text, chemin).toContain('<html lang="fr">');
    }
  });

  it("porte le nom de l'agence du propriétaire, « Agence Immobilière » à défaut, et jamais celui d'une autre agence", async () => {
    const { manager, owner, h } = await agence();
    const ownerUser = await createOwnerPortalUser(owner);
    const hOwner = authHeader(tokenFor(ownerUser, null, owner.id));
    const autre = await createManager();
    await testDb.insert(agencySettings).values({ userId: autre.id, agencyName: "Agence Bêta" });
    const chemins: Array<[string, Record<string, string>]> = [
      [`/api/crg/${owner.id}/export?month=9&year=2026`, h],
      ["/api/crg/mine/export?month=9&year=2026", hOwner],
      [`/api/crg/${owner.id}/annual/export?year=2026`, h],
      ["/api/crg/mine/annual/export?year=2026", hOwner],
    ];

    for (const [chemin, entetes] of chemins) {
      expect((await request(app).get(chemin).set(entetes)).text, `sans réglage ${chemin}`).toContain("Agence Immobilière");
    }

    await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "Agence Alpha" });
    for (const [chemin, entetes] of chemins) {
      const { text } = await request(app).get(chemin).set(entetes);
      expect(text, chemin).toContain("Agence Alpha");
      expect(text, chemin).not.toContain("Agence Bêta");
      expect(text, chemin).not.toContain("Agence Immobilière");
    }
  });

  it("un nom d'agence vide retombe sur « Agence Immobilière »", async () => {
    const { manager, owner, h } = await agence();
    await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "" });

    const res = await request(app).get(`/api/crg/${owner.id}/export?month=9&year=2026`).set(h);

    expect(res.text).toContain("Agence Immobilière");
  });
});

describe("arrondis au centime (compte-rendu mensuel)", () => {
  it("le net d'une ligne est arrondi au centime (100,10 − 20,20 − 10,01 = 69,89)", async () => {
    const { owner, property, contract } = await agence({ managementFeeRate: 10 });
    await encaisser(contract.id, 100.1, d(2026, 9, 5));
    await depenser(property.id, 20.2, d(2026, 9, 6));

    const [ligne] = (await computeCrg(owner, 9, 2026)).properties;

    expect(ligne).toMatchObject({ loyersEncaisses: 100.1, chargesDeduites: 20.2, commission: 10.01 });
    expect(ligne.netAReverser).toBe(69.89);
  });

  it("totaux, reste à reverser et devise des reversements : 0,1 + 0,2 − 0,1 = 0,2", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { managementFeeRate: 0 });
    const tenant = await createTenant(manager.id);
    for (const [titre, loyer] of [
      ["Bien 1", 0.1],
      ["Bien 2", 0.2],
    ] as const) {
      const bien = await createProperty(manager.id, { title: titre, ownerId: owner.id });
      await encaisser((await createContract(bien.id, tenant.id)).id, loyer, d(2026, 9, 5));
    }
    await reverser(owner.id, 9, 2026, 0.1, { paidAt: d(2026, 9, 10) });
    await reverser(owner.id, 9, 2026, 7, { paidAt: d(2026, 9, 11), currency: "USD" });

    const crg = await computeCrg(owner, 9, 2026);

    expect(crg.totalLoyersByCurrency).toEqual({ EUR: 0.3 });
    expect(crg.totalNetByCurrency).toEqual({ EUR: 0.3 });
    expect(crg.resteAReverserByCurrency).toEqual({ EUR: 0.2, USD: -7 });
    expect(crg.reversements.map((r) => [r.currency, r.amount])).toEqual([
      ["EUR", 0.1],
      ["USD", 7],
    ]);
  });
});

describe("relevé annuel", () => {
  it("compte du 1er janvier 00:00:00.000 au 31 décembre 23:59:59.999, et pas une milliseconde de plus (loyers et charges)", async () => {
    const { owner, property, contract, h } = await agence();
    const dedans: Array<[number, Date]> = [
      [1, d(2026, 1, 1, 0, 0, 0, 0)],
      [2, d(2026, 1, 1, 0, 30)],
      [4, d(2026, 12, 31, 23, 59, 59, 999)],
      [8, d(2026, 12, 31, 23, 59, 59, 500)],
      [16, d(2026, 12, 31, 23, 59, 30)],
      [32, d(2026, 12, 31, 23, 30)],
      [64, d(2026, 12, 31, 12)],
    ];
    const dehors: Array<[number, Date]> = [
      [128, d(2025, 12, 31, 23, 59, 59, 999)],
      [256, d(2027, 1, 1, 0, 0, 0, 0)],
    ];
    for (const [montant, date] of [...dedans, ...dehors]) {
      await encaisser(contract.id, montant, date);
      await depenser(property.id, montant, date);
    }

    const res = await request(app).get(`/api/crg/${owner.id}/annual?year=2026`).set(h);

    expect(res.body.totalLoyersByCurrency).toEqual({ EUR: 127 });
    expect(res.body.totalChargesByCurrency).toEqual({ EUR: 127 });
    expect(res.body.months[0].totalLoyersByCurrency).toEqual({ EUR: 3 });
    expect(res.body.months[11].totalLoyersByCurrency).toEqual({ EUR: 124 });
  });

  it("répartit chaque encaissement et chaque charge dans le bon mois, aux bornes exactes", async () => {
    const { owner, property, contract, h } = await agence();
    await encaisser(contract.id, 1000, d(2026, 2, 28, 23, 59, 59, 999));
    await encaisser(contract.id, 2000, d(2026, 3, 1, 0, 0, 0, 0));
    await encaisser(contract.id, 4000, d(2026, 3, 31, 23, 59, 59, 999));
    await encaisser(contract.id, 8000, d(2026, 4, 1, 0, 0, 0, 0));
    await depenser(property.id, 1, d(2026, 2, 28, 23, 59, 59, 999));
    await depenser(property.id, 2, d(2026, 3, 1, 0, 0, 0, 0));
    await depenser(property.id, 4, d(2026, 3, 31, 23, 59, 59, 999));
    await depenser(property.id, 8, d(2026, 4, 1, 0, 0, 0, 0));

    const res = await request(app).get(`/api/crg/${owner.id}/annual?year=2026`).set(h);

    const mois = (n: number) => res.body.months.find((m: { month: number }) => m.month === n);
    expect(res.body.months.map((m: { month: number }) => m.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(mois(2).totalLoyersByCurrency).toEqual({ EUR: 1000 });
    expect(mois(3).totalLoyersByCurrency).toEqual({ EUR: 6000 });
    expect(mois(4).totalLoyersByCurrency).toEqual({ EUR: 8000 });
    expect(mois(2).totalChargesByCurrency).toEqual({ EUR: 1 });
    expect(mois(3).totalChargesByCurrency).toEqual({ EUR: 6 });
    expect(mois(4).totalChargesByCurrency).toEqual({ EUR: 8 });
    expect(res.body.totalLoyersByCurrency).toEqual({ EUR: 15000 });
    expect(res.body.totalChargesByCurrency).toEqual({ EUR: 15 });
  });

  it("chaque colonne du mois porte la bonne grandeur (loyers, charges, commission, net, reversé), les totaux de l'année aussi", async () => {
    const { owner, property, contract, h } = await agence({ managementFeeRate: 12.5 });
    await encaisser(contract.id, 1000, d(2026, 3, 5));
    await depenser(property.id, 80, d(2026, 3, 6));
    await reverser(owner.id, 3, 2026, 300, { paidAt: d(2026, 4, 2) });

    const res = await request(app).get(`/api/crg/${owner.id}/annual?year=2026`).set(h);

    expect(res.body.months[2]).toEqual({
      month: 3,
      totalLoyersByCurrency: { EUR: 1000 },
      totalChargesByCurrency: { EUR: 80 },
      totalCommissionByCurrency: { EUR: 125 },
      totalNetByCurrency: { EUR: 795 },
      totalReverseByCurrency: { EUR: 300 },
    });
    expect(res.body.totalLoyersByCurrency).toEqual({ EUR: 1000 });
    expect(res.body.totalChargesByCurrency).toEqual({ EUR: 80 });
    expect(res.body.totalCommissionByCurrency).toEqual({ EUR: 125 });
    expect(res.body.totalNetByCurrency).toEqual({ EUR: 795 });
    expect(res.body.totalReverseByCurrency).toEqual({ EUR: 300 });
    expect(res.body.resteAReverserByCurrency).toEqual({ EUR: 495 });
  });

  it("cumule chaque bien sur l'année au centime, trié par titre puis par devise", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { managementFeeRate: 10 });
    const tenant = await createTenant(manager.id);
    const h = entete(manager);
    const bienB = await createProperty(manager.id, { title: "Bien B", ownerId: owner.id });
    const bienA = await createProperty(manager.id, { title: "Bien A", ownerId: owner.id, currency: "XOF" });
    const contratB = await createContract(bienB.id, tenant.id);
    const contratBxof = await createContract(bienB.id, tenant.id, { currency: "XOF" });
    await encaisser(contratB.id, 10.1, d(2026, 3, 5));
    await encaisser(contratB.id, 20.2, d(2026, 4, 5));
    await encaisser(contratBxof.id, 500, d(2026, 4, 6), { currency: "XOF" });
    await depenser(bienB.id, 0.1, d(2026, 3, 6));
    await depenser(bienB.id, 0.2, d(2026, 4, 6));

    const res = await request(app).get(`/api/crg/${owner.id}/annual?year=2026`).set(h);

    expect(res.body.properties).toEqual([
      { propertyId: bienA.id, propertyTitle: "Bien A", currency: "XOF", loyersEncaisses: 0, chargesDeduites: 0, commission: 0, netAReverser: 0 },
      { propertyId: bienB.id, propertyTitle: "Bien B", currency: "EUR", loyersEncaisses: 30.3, chargesDeduites: 0.3, commission: 3.03, netAReverser: 26.97 },
      { propertyId: bienB.id, propertyTitle: "Bien B", currency: "XOF", loyersEncaisses: 500, chargesDeduites: 0, commission: 50, netAReverser: 450 },
    ]);
    expect(res.body.totalLoyersByCurrency).toEqual({ EUR: 30.3, XOF: 500 });
    expect(res.body.totalChargesByCurrency).toEqual({ EUR: 0.3, XOF: 0 });
    expect(res.body.totalCommissionByCurrency).toEqual({ EUR: 3.03, XOF: 50 });
    expect(res.body.totalNetByCurrency).toEqual({ EUR: 26.97, XOF: 450 });
  });

  it("rend les reversements de l'année (pas ceux d'une autre année ni d'un autre propriétaire), dans l'ordre, avec tous leurs champs", async () => {
    const { owner, h } = await agence();
    const autre = await createOwner((await createManager()).id);
    const p1 = await reverser(owner.id, 5, 2026, 100, { paidAt: d(2026, 6, 10), createdAt: d(2026, 6, 10, 12), method: "CASH", reference: "R1", note: "N1" });
    const p2 = await reverser(owner.id, 5, 2026, 200, { paidAt: d(2026, 6, 10), createdAt: d(2026, 6, 10, 8), method: "CHEQUE", reference: "R2", note: "N2" });
    const p3 = await reverser(owner.id, 2, 2026, 300, { paidAt: d(2026, 2, 28), createdAt: d(2026, 7, 1), method: "OTHER", reference: null, note: null });
    await reverser(owner.id, 5, 2025, 1);
    await reverser(owner.id, 5, 2027, 2);
    await reverser(autre.id, 5, 2026, 4);

    const res = await request(app).get(`/api/crg/${owner.id}/annual?year=2026`).set(h);

    expect(res.body.reversements).toEqual([
      { id: p3.id, currency: "EUR", amount: 300, paidAt: d(2026, 2, 28).toISOString(), method: "OTHER", reference: null, note: null },
      { id: p2.id, currency: "EUR", amount: 200, paidAt: d(2026, 6, 10).toISOString(), method: "CHEQUE", reference: "R2", note: "N2" },
      { id: p1.id, currency: "EUR", amount: 100, paidAt: d(2026, 6, 10).toISOString(), method: "CASH", reference: "R1", note: "N1" },
    ]);
    expect(res.body.totalReverseByCurrency).toEqual({ EUR: 600 });
    expect(res.body.months[1].totalReverseByCurrency).toEqual({ EUR: 300 });
    expect(res.body.months[4].totalReverseByCurrency).toEqual({ EUR: 300 });
  });

  it("reste à reverser : devise sans net, devise sans reversement, et arrondi au centime", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, { managementFeeRate: 10 });
    const tenant = await createTenant(manager.id);
    const h = entete(manager);
    const bien = await createProperty(manager.id, { title: "Bien", ownerId: owner.id });
    await createProperty(manager.id, { title: "Bien XOF", ownerId: owner.id, currency: "XOF" });
    await encaisser((await createContract(bien.id, tenant.id)).id, 1000, d(2026, 3, 5));
    await reverser(owner.id, 3, 2026, 0.1);
    await reverser(owner.id, 3, 2026, 0.2);
    await reverser(owner.id, 3, 2026, 50, { currency: "USD" });

    const res = await request(app).get(`/api/crg/${owner.id}/annual?year=2026`).set(h);

    expect(res.body.totalReverseByCurrency).toEqual({ EUR: 0.3, USD: 50 });
    expect(res.body.resteAReverserByCurrency).toEqual({ EUR: 899.7, XOF: 0, USD: -50 });
  });

  it("ne montre ni ne compte rien d'un autre propriétaire de la même agence", async () => {
    const { manager, owner, contract, h } = await agence();
    const autre = await createOwner(manager.id);
    const bienAutre = await createProperty(manager.id, { title: "Bien de l'autre", ownerId: autre.id });
    const contratAutre = await createContract(bienAutre.id, (await createTenant(manager.id)).id);
    await encaisser(contract.id, 100, d(2026, 3, 5));
    await encaisser(contratAutre.id, 9000, d(2026, 3, 5));
    await depenser(bienAutre.id, 900, d(2026, 3, 6));
    await reverser(autre.id, 3, 2026, 90);

    const res = await request(app).get(`/api/crg/${owner.id}/annual?year=2026`).set(h);

    expect(res.body.properties.map((p: { propertyTitle: string }) => p.propertyTitle)).toEqual(["Villa Ngor"]);
    expect(res.body.totalLoyersByCurrency).toEqual({ EUR: 100 });
    expect(res.body.totalChargesByCurrency).toEqual({ EUR: 0 });
    expect(res.body.reversements).toEqual([]);
  });

  it("compte un règlement partiel à la date et pour le montant de chaque paiement, et ignore une facture impayée", async () => {
    const { owner, contract, h } = await agence();
    const partielle = await createInvoice(contract.id, { periodMonth: 1, periodYear: 1992, amount: 500, status: "PENDING", amountPaid: 300, dueDate: d(2026, 3, 5) });
    await testDb.insert(invoicePayments).values([
      { invoiceId: partielle.id, amount: 100, paidAt: d(2026, 3, 10), paymentMethod: "CASH" },
      { invoiceId: partielle.id, amount: 200, paidAt: d(2026, 4, 10), paymentMethod: "CASH" },
    ]);
    await createInvoice(contract.id, { periodMonth: 2, periodYear: 1992, amount: 900, status: "PENDING", dueDate: d(2026, 6, 5) });

    const res = await request(app).get(`/api/crg/${owner.id}/annual?year=2026`).set(h);

    expect(res.body.months[2].totalLoyersByCurrency).toEqual({ EUR: 100 });
    expect(res.body.months[3].totalLoyersByCurrency).toEqual({ EUR: 200 });
    expect(res.body.months[5].totalLoyersByCurrency).toEqual({ EUR: 0 });
    expect(res.body.totalLoyersByCurrency).toEqual({ EUR: 300 });
  });

  it("arrondit au centime le net cumulé du bien et le reste à reverser (0,1 + 0,2 − 0,1 = 0,2)", async () => {
    const { owner, contract, h } = await agence({ managementFeeRate: 0 });
    await encaisser(contract.id, 0.1, d(2026, 3, 5));
    await encaisser(contract.id, 0.2, d(2026, 4, 5));
    await reverser(owner.id, 3, 2026, 0.1, { currency: "EUR" });
    await reverser(owner.id, 4, 2026, 9, { currency: "XOF" });

    const res = await request(app).get(`/api/crg/${owner.id}/annual?year=2026`).set(h);

    expect(res.body.properties[0]).toMatchObject({ loyersEncaisses: 0.3, commission: 0 });
    expect(res.body.properties[0].netAReverser).toBe(0.3);
    expect(res.body.resteAReverserByCurrency).toEqual({ EUR: 0.2, XOF: -9 });
    expect(res.body.reversements.map((r: { currency: string }) => r.currency)).toEqual(["EUR", "XOF"]);
  });

  it("trie les lignes même quand une devise n'apparaît qu'en cours d'année (CAD avant EUR pour un même bien)", async () => {
    const { owner, contract, property, h } = await agence();
    await encaisser(contract.id, 100, d(2026, 3, 5));
    await encaisser(contract.id, 50, d(2026, 6, 5), { currency: "CAD" });

    const res = await request(app).get(`/api/crg/${owner.id}/annual?year=2026`).set(h);

    expect(res.body.properties.map((p: { propertyId: string; currency: string }) => [p.propertyId, p.currency])).toEqual([
      [property.id, "CAD"],
      [property.id, "EUR"],
    ]);
  });

  it("identité du propriétaire et année dans le relevé", async () => {
    const { owner, h } = await agence({ civility: "MME", companyName: "SCI Soleil" });

    const res = await request(app).get(`/api/crg/${owner.id}/annual?year=2025`).set(h);

    expect(res.body).toMatchObject({ ownerId: owner.id, ownerName: "Madame Fatou Diop", ownerCompanyName: "SCI Soleil", year: 2025 });
    expect(res.body.months).toHaveLength(12);
  });

  describe("taux de commission de l'année", () => {
    async function proprietaireAvecHistorique(historique: Array<[number, number, number]>, taux = 17) {
      const base = await agence({ managementFeeRate: taux });
      await testDb.insert(ownerFeeRates).values(historique.map(([effectiveYear, effectiveMonth, rate]) => ({ ownerId: base.owner.id, effectiveYear, effectiveMonth, rate })));
      return base;
    }

    it("liste les taux des seuls mois qui ont une activité (loyers, charges même négatives, ou reversements), sans répétition, dans l'ordre", async () => {
      const { owner, property, contract, h } = await proprietaireAvecHistorique([
        [1970, 1, 10],
        [2026, 4, 12],
        [2026, 5, 14],
        [2026, 7, 20],
        [2026, 10, 15],
        [2026, 12, 18],
      ]);
      await encaisser(contract.id, 1000, d(2026, 3, 5)); // mars : loyers, taux 10
      await depenser(property.id, 50, d(2026, 4, 5)); // avril : charges seules, taux 12
      await encaisser(contract.id, 1000, d(2026, 5, 5)); // mai : loyers, taux 14
      await encaisser(contract.id, 1000, d(2026, 6, 5)); // juin : loyers, taux 14 (déjà noté)
      await reverser(owner.id, 9, 2026, 100); // septembre : reversement seul, taux 20
      // novembre (taux 15) : aucune activité
      await depenser(property.id, -50, d(2026, 12, 5)); // décembre : un remboursement de charge (montant négatif), taux 18

      const res = await request(app).get(`/api/crg/${owner.id}/annual?year=2026`).set(h);

      expect(res.body.managementFeeRates).toEqual([10, 12, 14, 20, 18]);
      expect(res.body.managementFeeRate).toBe(18);
    });

    it("sans aucune activité, le taux du dernier mois de l'année", async () => {
      const { owner, h } = await proprietaireAvecHistorique(
        [
          [1970, 1, 10],
          [2026, 12, 11],
          [2027, 3, 15],
        ],
        15
      );

      const res = await request(app).get(`/api/crg/${owner.id}/annual?year=2026`).set(h);

      expect(res.body.managementFeeRates).toEqual([11]);
      expect(res.body.managementFeeRate).toBe(11);

      const avant = await request(app).get(`/api/crg/${owner.id}/annual?year=2025`).set(h);
      expect(avant.body.managementFeeRates).toEqual([10]);
    });

    it("un seul mois actif, au taux d'avant un changement : ce taux-là, pas celui de la fin d'année", async () => {
      const { owner, contract, h } = await proprietaireAvecHistorique(
        [
          [1970, 1, 10],
          [2026, 10, 12],
        ],
        12
      );
      await encaisser(contract.id, 1000, d(2026, 3, 5));

      const res = await request(app).get(`/api/crg/${owner.id}/annual?year=2026`).set(h);

      expect(res.body.managementFeeRates).toEqual([10]);
      expect(res.body.managementFeeRate).toBe(10);
    });

    it("un seul taux sur l'année : une seule valeur", async () => {
      const { owner, contract, h } = await agence({ managementFeeRate: 9 });
      await encaisser(contract.id, 1000, d(2026, 3, 5));
      await encaisser(contract.id, 1000, d(2026, 7, 5));

      const res = await request(app).get(`/api/crg/${owner.id}/annual?year=2026`).set(h);

      expect(res.body.managementFeeRates).toEqual([9]);
    });
  });
});
