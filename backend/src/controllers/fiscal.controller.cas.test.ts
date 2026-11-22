import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { expenses } from "../db/schema";
import { authHeader, createContract, createInvoice, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Bilan fiscal et exports comptables : les cas où un montant change de ligne ou d'année. Une devise vide doit se ranger sous
 * l'euro (sinon un même loyer apparaît deux fois, une fois par clé), l'année par défaut est l'année courante, et un
 * encaissement du 31 décembre à 23 h 59 appartient à l'année qui se termine, pas à la suivante.
 */

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 20)); // 20 septembre 2026
});
afterEach(() => vi.useRealTimers());

async function agence() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: new Date(2030, 0, 1) });
  const property = await createProperty(manager.id, { title: "Villa Ngor" });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow" });
  const contract = await createContract(property.id, tenant.id);
  return { manager, property, contract, h: authHeader(tokenFor(manager)) };
}
const depense = (propertyId: string, o: Partial<typeof expenses.$inferInsert> = {}) =>
  testDb.insert(expenses).values({ propertyId, category: "MAINTENANCE", title: "Plomberie", amount: 100, expenseDate: new Date(2026, 5, 1), ...o });
const sansEspaces = (s: string) => s.split(" ").join("").split(" ").join("").split(" ").join("");

describe("synthèse annuelle : devise vide et limites de l'année", () => {
  it("une devise vide est comptée en euros et fusionne avec les montants en euros (un seul total, une seule ligne par bien)", async () => {
    const { property, contract, h } = await agence();
    await createInvoice(contract.id, { amount: 500, periodMonth: 3, status: "PAID", paidAt: new Date(2026, 2, 5), currency: "EUR" });
    await createInvoice(contract.id, { amount: 300, periodMonth: 4, status: "PAID", paidAt: new Date(2026, 3, 5), currency: "" });
    await depense(property.id, { amount: 100, currency: "EUR" });
    await depense(property.id, { amount: 40, currency: "", title: "Serrure" });

    const res = await request(app).get("/api/fiscal/synthese?year=2026").set(h);

    expect(res.status).toBe(200);
    expect(res.body.totalRevenueByCurrency).toEqual({ EUR: 800 });
    expect(res.body.totalExpensesByCurrency).toEqual({ EUR: 140 });
    expect(res.body.netResultByCurrency).toEqual({ EUR: 660 });
    expect(res.body.expensesByCategory).toEqual({ MAINTENANCE: { EUR: 140 } });
    expect(res.body.bilanParBien).toEqual([{ propertyId: property.id, propertyTitle: "Villa Ngor", currency: "EUR", revenue: 800, expense: 140, net: 660 }]);
  });

  it("un loyer du 31 décembre à 23 h 59 compte pour l'année qui se termine, celui du 1er janvier minuit pour la suivante ; idem pour les dépenses", async () => {
    const { property, contract, h } = await agence();
    await createInvoice(contract.id, { amount: 100, periodMonth: 12, periodYear: 2026, status: "PAID", paidAt: new Date(2026, 11, 31, 23, 59, 0) });
    await createInvoice(contract.id, { amount: 200, periodMonth: 1, periodYear: 2027, status: "PAID", paidAt: new Date(2027, 0, 1, 0, 0, 0) });
    await depense(property.id, { amount: 10, expenseDate: new Date(2026, 11, 31, 23, 59, 0) });
    await depense(property.id, { amount: 20, expenseDate: new Date(2027, 0, 1, 0, 0, 0), title: "Peinture" });

    const a2026 = (await request(app).get("/api/fiscal/synthese?year=2026").set(h)).body;
    const a2027 = (await request(app).get("/api/fiscal/synthese?year=2027").set(h)).body;

    expect(a2026.totalRevenueByCurrency).toEqual({ EUR: 100 });
    expect(a2026.totalExpensesByCurrency).toEqual({ EUR: 10 });
    expect(a2027.totalRevenueByCurrency).toEqual({ EUR: 200 });
    expect(a2027.totalExpensesByCurrency).toEqual({ EUR: 20 });
    expect(a2026.availableYears).toEqual([2027, 2026]);
  });

  it("une dépense du jour de l'an est rangée dans le mois de janvier, une facture payée sans date retombe sur son échéance", async () => {
    const { property, contract, h } = await agence();
    await depense(property.id, { amount: 25, expenseDate: new Date(2026, 0, 1, 0, 0, 0), title: "Assurance" });
    await createInvoice(contract.id, { amount: 90, periodMonth: 7, status: "PAID", paidAt: null, dueDate: new Date(2026, 6, 5) });

    const res = await request(app).get("/api/fiscal/synthese?year=2026").set(h);

    expect(res.body.expensesByMonth["2026-01"]).toEqual({ EUR: 25 });
    expect(res.body.revenueByMonth["2026-07"]).toEqual({ EUR: 90 });
  });
});

describe("synthèse annuelle : année par défaut, dernière milliseconde, devises et ordre", () => {
  it("sans ?year, la synthèse porte l'année en cours", async () => {
    const { contract, h } = await agence();
    await createInvoice(contract.id, { amount: 500, periodMonth: 3, periodYear: 2026, status: "PAID", paidAt: new Date(2026, 2, 5) });
    await createInvoice(contract.id, { amount: 777, periodMonth: 3, periodYear: 2025, status: "PAID", paidAt: new Date(2025, 2, 5) });

    const res = await request(app).get("/api/fiscal/synthese").set(h);

    expect(res.body.year).toBe(2026);
    expect(res.body.totalRevenueByCurrency).toEqual({ EUR: 500 });
  });

  it("un encaissement à la toute dernière milliseconde de l'année (31 décembre, 23 h 59 min 59,999 s) compte pour cette année, une milliseconde plus tard pour la suivante", async () => {
    const { contract, h } = await agence();
    await createInvoice(contract.id, { amount: 100, periodMonth: 12, periodYear: 2026, status: "PAID", paidAt: new Date(2026, 11, 31, 23, 59, 59, 999) });
    await createInvoice(contract.id, { amount: 200, periodMonth: 1, periodYear: 2027, status: "PAID", paidAt: new Date(2027, 0, 1, 0, 0, 0, 0) });

    const a2026 = (await request(app).get("/api/fiscal/synthese?year=2026").set(h)).body;
    const a2027 = (await request(app).get("/api/fiscal/synthese?year=2027").set(h)).body;

    expect(a2026.totalRevenueByCurrency).toEqual({ EUR: 100 });
    expect(a2027.totalRevenueByCurrency).toEqual({ EUR: 200 });
  });

  it("une devise qui n'a que des dépenses figure au résultat net, en négatif", async () => {
    const { property, contract, h } = await agence();
    await createInvoice(contract.id, { amount: 500, periodMonth: 3, status: "PAID", paidAt: new Date(2026, 2, 5) });
    await depense(property.id, { amount: 120000, currency: "XOF", title: "Toiture" });

    const res = await request(app).get("/api/fiscal/synthese?year=2026").set(h);

    expect(res.body.netResultByCurrency).toEqual({ EUR: 500, XOF: -120000 });
    expect(res.body.totalRevenueByCurrency).toEqual({ EUR: 500 });
    expect(res.body.totalExpensesByCurrency).toEqual({ XOF: 120000 });
  });

  it("le bilan par bien est trié par titre, puis par devise pour un même bien", async () => {
    const { manager, property, contract, h } = await agence(); // « Villa Ngor »
    const autre = await createProperty(manager.id, { title: "Appartement Plateau" });
    const locataire = await createTenant(manager.id);
    const bail = await createContract(autre.id, locataire.id);
    await createInvoice(contract.id, { amount: 500, periodMonth: 3, status: "PAID", paidAt: new Date(2026, 2, 5) });
    await createInvoice(bail.id, { amount: 300, periodMonth: 3, status: "PAID", paidAt: new Date(2026, 2, 6) });
    await depense(property.id, { amount: 50000, currency: "XOF" });

    const res = await request(app).get("/api/fiscal/synthese?year=2026").set(h);

    expect(res.body.bilanParBien.map((b: { propertyTitle: string; currency: string }) => `${b.propertyTitle}|${b.currency}`)).toEqual(["Appartement Plateau|EUR", "Villa Ngor|EUR", "Villa Ngor|XOF"]);
  });
});

describe("exports comptables : ordre chronologique", () => {
  it("le grand livre range les écritures par date, pas par nature : une dépense de février précède le loyer de mars, et le solde cumulé suit", async () => {
    const { property, contract, h } = await agence();
    await createInvoice(contract.id, { amount: 500, periodMonth: 3, periodYear: 2026, status: "PAID", paidAt: new Date(2026, 2, 5) });
    await depense(property.id, { amount: 200, expenseDate: new Date(2026, 1, 1) });

    const res = await request(app).get("/api/fiscal/grand-livre?year=2026").set(h);

    const lignes = res.text.split("\n");
    const depenseIdx = lignes.findIndex((l: string) => l.includes("Plomberie"));
    const loyerIdx = lignes.findIndex((l: string) => l.includes("Loyer 3/2026"));
    expect(depenseIdx).toBeGreaterThan(-1);
    expect(depenseIdx).toBeLessThan(loyerIdx);
    expect(lignes[depenseIdx]).toContain(";-200");
    expect(lignes[loyerIdx]).toContain(";300");
  });

  it("le FEC numérote les écritures dans l'ordre des dates : la dépense de février porte le numéro 000001", async () => {
    const { property, contract, h } = await agence();
    await createInvoice(contract.id, { amount: 500, periodMonth: 3, periodYear: 2026, status: "PAID", paidAt: new Date(2026, 2, 5) });
    await depense(property.id, { amount: 200, expenseDate: new Date(2026, 1, 1) });

    const res = await request(app).get("/api/fiscal/fec?year=2026").set(h);

    const lignes = res.text.split("\n").filter((l: string) => l.length > 0);
    const premiere = lignes[1].split("\t");
    expect(premiere[2]).toBe("000001");
    expect(lignes[1]).toContain("Plomberie");
    expect(lignes.find((l: string) => l.includes("Loyer 3/2026"))?.split("\t")[2]).toBe("000002");
  });
});

describe("exports comptables : année par défaut et devise vide", () => {
  it("sans ?year, le grand livre porte l'année en cours : les écritures de 2026 y sont, celles de 2025 non", async () => {
    const { property, contract, h } = await agence();
    await createInvoice(contract.id, { amount: 500, periodMonth: 3, periodYear: 2026, status: "PAID", paidAt: new Date(2026, 2, 5) });
    await createInvoice(contract.id, { amount: 777, periodMonth: 3, periodYear: 2025, status: "PAID", paidAt: new Date(2025, 2, 5) });
    await depense(property.id, { amount: 200, title: "Plomberie 2026" });
    await depense(property.id, { amount: 333, title: "Toiture 2025", expenseDate: new Date(2025, 5, 1) });

    const res = await request(app).get("/api/fiscal/grand-livre").set(h);

    expect(res.status).toBe(200);
    expect(res.text).toContain("Grand Livre 2026");
    expect(res.text).toContain("Loyer 3/2026");
    expect(res.text).toContain("Plomberie 2026");
    expect(res.text).not.toContain("Loyer 3/2025");
    expect(res.text).not.toContain("Toiture 2025");
  });

  it("sans ?year, le FEC porte l'année en cours dans son nom de fichier et n'en exporte que les écritures", async () => {
    const { property, contract, h } = await agence();
    await createInvoice(contract.id, { amount: 500, periodMonth: 3, periodYear: 2026, status: "PAID", paidAt: new Date(2026, 2, 5) });
    await depense(property.id, { amount: 333, title: "Toiture 2025", expenseDate: new Date(2025, 5, 1) });

    const res = await request(app).get("/api/fiscal/fec").set(h);

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("FEC20261231.txt");
    expect(res.text).toContain("Loyer 3/2026");
    expect(res.text).not.toContain("Toiture 2025");
  });

  it("sans ?year, le SYSCOHADA porte l'année en cours", async () => {
    const { contract, h } = await agence();
    await createInvoice(contract.id, { amount: 500, periodMonth: 3, periodYear: 2026, status: "PAID", paidAt: new Date(2026, 2, 5) });
    await createInvoice(contract.id, { amount: 777, periodMonth: 3, periodYear: 2025, status: "PAID", paidAt: new Date(2025, 2, 5) });

    const res = await request(app).get("/api/fiscal/syscohada").set(h);

    expect(res.status).toBe(200);
    expect(res.text).toContain("Loyer 3/2026");
    expect(res.text).not.toContain("Loyer 3/2025");
  });

  it("une devise vide est exportée en euros : grand livre (colonne devise) et SYSCOHADA (total par devise)", async () => {
    const { property, contract, h } = await agence();
    await createInvoice(contract.id, { amount: 500, periodMonth: 3, periodYear: 2026, status: "PAID", paidAt: new Date(2026, 2, 5), currency: "" });
    await depense(property.id, { amount: 200, currency: "" });

    const livre = await request(app).get("/api/fiscal/grand-livre?year=2026").set(h);
    const ohada = await request(app).get("/api/fiscal/syscohada?year=2026").set(h);

    const ligneLoyer = livre.text.split("\n").find((l: string) => l.includes("Loyer 3/2026"));
    const ligneDepense = livre.text.split("\n").find((l: string) => l.includes("Plomberie"));
    expect(ligneLoyer?.split(";")[7]).toBe("EUR");
    expect(ligneDepense?.split(";")[7]).toBe("EUR");
    expect(ohada.text).toContain("Total général EUR");
    expect(sansEspaces(ohada.text)).not.toContain("Totalgénéral;");
  });

  it("le grand livre cumule le solde par devise sans mélanger l'euro et une devise vide rangée en euros", async () => {
    const { property, contract, h } = await agence();
    await createInvoice(contract.id, { amount: 500, periodMonth: 3, periodYear: 2026, status: "PAID", paidAt: new Date(2026, 2, 5), currency: "" });
    await depense(property.id, { amount: 200, currency: "EUR", expenseDate: new Date(2026, 3, 1) });

    const res = await request(app).get("/api/fiscal/grand-livre?year=2026").set(h);

    const lignes = res.text.split("\n");
    expect(lignes.find((l: string) => l.includes("Loyer 3/2026"))).toContain(";500");
    expect(lignes.find((l: string) => l.includes("Plomberie"))).toContain(";300");
  });
});
