import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { authHeader, createContract, createInvoice, createManager, createProperty, createTenant, tokenFor } from "./authHelpers";

/**
 * Le tableau de bord ne relit plus tout l'historique des loyers payés, seulement ce qui peut avoir encaissé de l'argent dans les
 * six derniers mois (voir getDashboardStats). Ce filtre doit rester STRICTEMENT équivalent à l'ancien (« payée récemment, ou
 * ayant reçu un acompte, puis tri par date ») : ces cas sont ceux où un filtre plus naïf perdrait de l'argent.
 * Jour courant fixé au 12 octobre 2026 : la fenêtre commence le 1er avril 2026.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T10:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

async function agence() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
  const bien = await createProperty(manager.id, { title: "Studio A", currency: "EUR" });
  const locataire = await createTenant(manager.id);
  const contrat = await createContract(bien.id, locataire.id, { status: "ACTIVE", startDate: new Date(2024, 0, 1), endDate: new Date(2028, 0, 1) });
  return { contrat, h: authHeader(tokenFor(manager)) };
}
const stats = (h: Record<string, string>) => request(app).get("/api/dashboard/stats").set(h);
const payer = (h: Record<string, string>, id: string, corps: Record<string, unknown>) => request(app).post(`/api/invoices/${id}/mark-paid`).set(h).send(corps);

describe("tableau de bord : encaissements des six derniers mois", () => {
  it("compte un règlement récent même si la facture soldée porte une date ancienne (règlements saisis dans le désordre)", async () => {
    const { contrat, h } = await agence();
    const facture = await createInvoice(contrat.id, { status: "PENDING", periodMonth: 9, periodYear: 2026, amount: 600, currency: "EUR", dueDate: new Date(Date.UTC(2026, 8, 5)) });
    // Un acompte de septembre, puis le solde saisi ensuite mais daté de février : la facture porte la date de février.
    expect((await payer(h, facture.id, { amount: 200, paymentMethod: "CASH", paidAt: "2026-09-20" })).status).toBe(200);
    const solde = await payer(h, facture.id, { amount: 400, paidAt: "2026-02-01" });
    expect(solde.body.status).toBe("PAID");

    const res = await stats(h);

    expect(res.body.revenueByMonth["2026-09"]).toEqual({ EUR: 200 });
    expect(res.body.revenueByMonth["2026-02"]).toBeUndefined(); // février est hors de la fenêtre de six mois
  });

  it("compte l'acompte d'une facture pas encore soldée", async () => {
    const { contrat, h } = await agence();
    const facture = await createInvoice(contrat.id, { status: "PENDING", periodMonth: 8, periodYear: 2026, amount: 600, currency: "EUR", dueDate: new Date(Date.UTC(2026, 7, 5)) });
    await payer(h, facture.id, { amount: 150, paymentMethod: "CASH", paidAt: "2026-08-10" });

    expect((await stats(h)).body.revenueByMonth["2026-08"]).toEqual({ EUR: 150 });
  });

  it("ne compte pas un loyer soldé il y a plus de six mois, ni une facture soldée sans date", async () => {
    const { contrat, h } = await agence();
    await createInvoice(contrat.id, { status: "PAID", periodMonth: 3, periodYear: 2024, amount: 500, amountPaid: 500, currency: "EUR", dueDate: new Date(Date.UTC(2024, 2, 5)), paidAt: new Date(Date.UTC(2024, 2, 6)) });
    await createInvoice(contrat.id, { status: "PAID", periodMonth: 4, periodYear: 2024, amount: 500, amountPaid: 500, currency: "EUR", dueDate: new Date(Date.UTC(2024, 3, 5)), paidAt: null });

    const res = await stats(h);

    expect(res.status).toBe(200);
    expect(res.body.revenueByMonth).toEqual({});
    expect(res.body.monthlyRevenueByCurrency).toEqual({});
  });

  it("compte un loyer soldé à la date du jour et celui d'un mois récent, chacun à son mois d'encaissement", async () => {
    const { contrat, h } = await agence();
    await createInvoice(contrat.id, { status: "PAID", periodMonth: 10, periodYear: 2026, amount: 500, amountPaid: 500, currency: "EUR", dueDate: new Date(Date.UTC(2026, 9, 5)), paidAt: new Date(Date.UTC(2026, 9, 6)) });
    await createInvoice(contrat.id, { status: "PAID", periodMonth: 6, periodYear: 2026, amount: 480, amountPaid: 480, currency: "EUR", dueDate: new Date(Date.UTC(2026, 5, 5)), paidAt: new Date(Date.UTC(2026, 5, 7)) });

    const res = await stats(h);

    expect(res.body.monthlyRevenueByCurrency).toEqual({ EUR: 500 });
    expect(res.body.revenueByMonth["2026-10"]).toEqual({ EUR: 500 });
    expect(res.body.revenueByMonth["2026-06"]).toEqual({ EUR: 480 });
  });
});
