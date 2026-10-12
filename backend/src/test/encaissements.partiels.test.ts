import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createOwner,
  createProperty,
  createTenant,
  tokenFor,
  tokenProprietaire,
} from "./authHelpers";

/**
 * Bilans en base ENCAISSEMENTS. Un loyer réglé en plusieurs fois compte à la
 * date et pour le montant de CHAQUE paiement — et non, comme avant, le total à
 * la date du dernier. Les chiffres des factures réglées d'un coup sont, eux,
 * figés par encaissements.nonRegression.test.ts.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T10:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

async function agence() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
  const proprietaire = await createOwner(manager.id, { managementFeeRate: 10 });
  const bien = await createProperty(manager.id, { title: "Studio A", ownerId: proprietaire.id, currency: "EUR" });
  const locataire = await createTenant(manager.id, { firstName: "Awa", lastName: "Diallo" });
  const contrat = await createContract(bien.id, locataire.id, { status: "ACTIVE", startDate: new Date(2025, 0, 1), endDate: new Date(2027, 0, 1) });
  return { manager, proprietaire, contrat, h: authHeader(tokenFor(manager)) };
}

const payer = (h: Record<string, string>, id: string, corps: Record<string, unknown>) =>
  request(app).post(`/api/invoices/${id}/mark-paid`).set(h).send(corps);

const revenu = (res: { body: { totalRevenueByCurrency?: Record<string, number> } }) => res.body.totalRevenueByCurrency?.EUR ?? 0;

describe("loyer réglé en deux fois, à cheval sur deux années", () => {
  async function loyerEnDeuxFois() {
    const a = await agence();
    const facture = await createInvoice(a.contrat.id, {
      status: "PENDING", periodMonth: 12, periodYear: 2025, amount: 600, currency: "EUR", dueDate: new Date(Date.UTC(2025, 11, 5)),
    });
    expect((await payer(a.h, facture.id, { amount: 200, paymentMethod: "CASH", paidAt: "2025-12-28" })).status).toBe(200);
    const solde = await payer(a.h, facture.id, { amount: 400, paidAt: "2026-01-02" });
    expect(solde.body.status).toBe("PAID");
    return { ...a, facture };
  }

  it("le bilan fiscal range chaque paiement dans SON année (200 en 2025, 400 en 2026)", async () => {
    const { h } = await loyerEnDeuxFois();
    expect(revenu(await request(app).get("/api/fiscal/synthese?year=2025").set(h))).toBe(200);
    expect(revenu(await request(app).get("/api/fiscal/synthese?year=2026").set(h))).toBe(400);
  });

  it("le grand livre, le FEC et le SYSCOHADA détaillent un écriture par paiement", async () => {
    const { h } = await loyerEnDeuxFois();
    const gl2025 = (await request(app).get("/api/fiscal/grand-livre?year=2025").set(h)).text;
    const gl2026 = (await request(app).get("/api/fiscal/grand-livre?year=2026").set(h)).text;
    expect(gl2025).toContain("28/12/2025");
    expect(gl2025).toContain("200,00");
    expect(gl2025).not.toContain("600,00");
    expect(gl2026).toContain("02/01/2026");
    expect(gl2026).toContain("400,00");

    const fec2025 = (await request(app).get("/api/fiscal/fec?year=2025").set(h)).text;
    expect(fec2025).toContain("20251228");
    expect(fec2025).toContain("200.00");
    const syscohada2026 = (await request(app).get("/api/fiscal/syscohada?year=2026").set(h)).text;
    expect(syscohada2026).toContain("02/01/2026");
    expect(syscohada2026).toContain("400,00");
  });

  it("les années proposées au sélecteur incluent celle de chaque paiement", async () => {
    const { h } = await loyerEnDeuxFois();
    const res = await request(app).get("/api/fiscal/synthese?year=2026").set(h);
    expect(res.body.availableYears).toEqual(expect.arrayContaining([2025, 2026]));
  });

  it("le résumé des dépenses totalise l'argent reçu et compte UNE facture payée", async () => {
    const { h } = await loyerEnDeuxFois();
    const res = await request(app).get("/api/expenses/summary").set(h);
    expect(res.body.totalRevenueByCurrency.EUR).toBe(600);
    expect(res.body.paidInvoiceCount).toBe(1);
  });

  it("l'export comptable filtré par période ne garde que les paiements de la période", async () => {
    const { h } = await loyerEnDeuxFois();
    const decembre = (await request(app).get("/api/expenses/export?from=2025-12-01&to=2025-12-31").set(h)).text;
    expect(decembre).toContain("200,00");
    expect(decembre).not.toContain("400,00");
    const janvier = (await request(app).get("/api/expenses/export?from=2026-01-01&to=2026-01-31").set(h)).text;
    expect(janvier).toContain("400,00");
    expect(janvier).not.toContain("200,00");
  });

  it("le compte-rendu de gestion compte chaque paiement dans son mois, commission comprise", async () => {
    const { h, proprietaire } = await loyerEnDeuxFois();
    const lire = async (mois: number, annee: number) => {
      const res = await request(app).get(`/api/crg/${proprietaire.id}?month=${mois}&year=${annee}`).set(h);
      expect(res.status).toBe(200);
      return res.body.properties[0];
    };
    expect((await lire(12, 2025)).loyersEncaisses).toBe(200);
    expect((await lire(1, 2026)).loyersEncaisses).toBe(400);
    expect((await lire(1, 2026)).commission).toBe(40);
    expect((await lire(11, 2025)).loyersEncaisses).toBe(0);
  });
});

describe("acompte sur une facture non soldée", () => {
  it("compte dès l'encaissement dans le bilan, alors que la facture n'est pas payée", async () => {
    const { h, contrat } = await agence();
    const facture = await createInvoice(contrat.id, {
      status: "PENDING", periodMonth: 10, periodYear: 2026, amount: 500, currency: "EUR", dueDate: new Date(Date.UTC(2026, 9, 5)),
    });
    await payer(h, facture.id, { amount: 300, paidAt: "2026-10-08" });

    expect(revenu(await request(app).get("/api/fiscal/synthese?year=2026").set(h))).toBe(300);
    expect((await request(app).get("/api/expenses/summary").set(h)).body.totalRevenueByCurrency.EUR).toBe(300);
    expect((await request(app).get("/api/expenses/summary").set(h)).body.paidInvoiceCount).toBe(0);
  });

  it("tableau de bord : encaissé = acompte reçu ; attendu = loyer dû ; l'historique est rangé par mois d'encaissement", async () => {
    const { h, contrat } = await agence();
    const facture = await createInvoice(contrat.id, {
      status: "PENDING", periodMonth: 10, periodYear: 2026, amount: 500, currency: "EUR", dueDate: new Date(Date.UTC(2026, 9, 5)),
    });
    await payer(h, facture.id, { amount: 300, paidAt: "2026-10-08" });

    const res = await request(app).get("/api/dashboard/stats").set(h);
    expect(res.body.monthlyRevenueByCurrency).toEqual({ EUR: 300 });
    expect(res.body.monthlyExpectedByCurrency).toEqual({ EUR: 500 });
    expect(res.body.revenueByMonth["2026-10"]).toEqual({ EUR: 300 });
  });

  it("tableau de bord du propriétaire : perçu = acompte, en attente = reste dû", async () => {
    const { h, contrat, proprietaire } = await agence();
    const facture = await createInvoice(contrat.id, {
      status: "PENDING", periodMonth: 10, periodYear: 2026, amount: 500, currency: "EUR", dueDate: new Date(Date.UTC(2026, 9, 5)),
    });
    await payer(h, facture.id, { amount: 300, paidAt: "2026-10-08" });

    const jeton = await tokenProprietaire(proprietaire);
    const res = await request(app).get("/api/owners/mine/dashboard").set(authHeader(jeton));
    expect(res.body.collectedThisMonthByCurrency).toEqual({ EUR: 300 });
    expect(res.body.pendingThisMonthByCurrency).toEqual({ EUR: 200 });
  });
});

describe("revenus encaissés du mois : date d'encaissement, pas période louée (audit, défaut n°7)", () => {
  it("un loyer de septembre encaissé en octobre compte en octobre", async () => {
    const { h, contrat, proprietaire } = await agence();
    const facture = await createInvoice(contrat.id, {
      status: "PENDING", periodMonth: 9, periodYear: 2026, amount: 500, currency: "EUR", dueDate: new Date(Date.UTC(2026, 8, 5)),
    });
    await payer(h, facture.id, { paidAt: "2026-10-03" });

    const dashboard = await request(app).get("/api/dashboard/stats").set(h);
    expect(dashboard.body.monthlyRevenueByCurrency).toEqual({ EUR: 500 });
    expect(dashboard.body.revenueByMonth["2026-10"]).toEqual({ EUR: 500 });
    expect(dashboard.body.revenueByMonth["2026-09"]).toBeUndefined();

    const jeton = await tokenProprietaire(proprietaire);
    const owner = await request(app).get("/api/owners/mine/dashboard").set(authHeader(jeton));
    expect(owner.body.collectedThisMonthByCurrency).toEqual({ EUR: 500 });
    expect(owner.body.revenueByMonth["2026-10"]).toEqual({ EUR: 500 });
  });

  it("un loyer d'octobre encaissé en septembre (d'avance) compte en septembre", async () => {
    const { h, contrat } = await agence();
    const facture = await createInvoice(contrat.id, {
      status: "PENDING", periodMonth: 10, periodYear: 2026, amount: 500, currency: "EUR", dueDate: new Date(Date.UTC(2026, 9, 5)),
    });
    await payer(h, facture.id, { paidAt: "2026-09-28" });

    const dashboard = await request(app).get("/api/dashboard/stats").set(h);
    expect(dashboard.body.monthlyRevenueByCurrency).toEqual({});
    expect(dashboard.body.monthlyExpectedByCurrency).toEqual({ EUR: 500 });
    expect(dashboard.body.revenueByMonth["2026-09"]).toEqual({ EUR: 500 });
  });
});
