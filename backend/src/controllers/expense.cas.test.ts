import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { expenses } from "../db/schema";
import { authHeader, createContract, createExpense, createInvoice, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Dépenses et rapport financier : ce que les tests existants ne verrouillaient pas. Saisie (catégorie par défaut, intitulé rogné, bornes du
 * montant dont l'infini, récurrence inconnue, notes, catégorie, fin de récurrence et date par défaut réellement enregistrées), liste (filtre
 * par bien, ordre, pagination, total, bien joint), suppression réellement effectuée, bilan (cumul par catégorie, arrondi au centime, devise
 * sans loyer, facture partielle non comptée payée) et export CSV (bornes exactes de la période, isolation entre agences, une ligne de résumé
 * par bien et par devise, en-têtes de téléchargement).
 */
const JOUR = 86_400_000;

async function agence() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: new Date(Date.now() + 30 * JOUR) });
  const property = await createProperty(manager.id, { title: "Villa Alpha", currency: "EUR" });
  return { manager, property, h: authHeader(tokenFor(manager)) };
}
const creer = (h: Record<string, string>, corps: object) => request(app).post("/api/expenses").set(h).send(corps);
const synthese = (h: Record<string, string>) => request(app).get("/api/expenses/summary").set(h);
const exporter = (h: Record<string, string>, requete = "") => request(app).get(`/api/expenses/export${requete}`).set(h);
const lignes = (res: { text: string }) => res.text.split("\n");

describe("POST /api/expenses — saisie", () => {
  it("sans catégorie, c'est « Maintenance » ; l'intitulé est rogné et ne peut pas être vide", async () => {
    const { property, h } = await agence();

    const res = await creer(h, { propertyId: property.id, title: "  Plomberie  ", amount: 10 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ category: "MAINTENANCE", title: "Plomberie" });
    expect((await creer(h, { propertyId: property.id, title: "   ", amount: 10 })).status).toBe(400);
    expect((await creer(h, { propertyId: property.id, title: "x".repeat(201), amount: 10 })).status).toBe(400);
  });

  it("refuse un montant nul, négatif, infini (« 1e999 ») ou au-dessus du plafond ; accepte le plafond exact", async () => {
    const { property, h } = await agence();
    const essayer = (amount: unknown) => creer(h, { propertyId: property.id, title: "Dépense", amount });

    expect((await essayer(0)).status).toBe(400);
    expect((await essayer(-5)).status).toBe(400);
    expect((await essayer("1e999")).status).toBe(400);
    expect((await essayer(1_000_000_000_001)).status).toBe(400);
    expect((await essayer(1_000_000_000_000)).status).toBe(201);
  });

  it("enregistre vraiment la catégorie, les notes, la récurrence et sa date de fin ; refuse une récurrence inconnue et des notes démesurées", async () => {
    const { property, h } = await agence();
    const debut = new Date(2026, 0, 15);
    const fin = new Date(2027, 0, 15);

    const res = await creer(h, {
      propertyId: property.id, category: "TAX", title: "Taxe foncière", amount: 300, notes: "Avis 2026",
      expenseDate: debut.toISOString(), recurrence: "ANNUAL", recurrenceEndDate: fin.toISOString(),
    });

    expect(res.status).toBe(201);
    const [enBase] = await testDb.select().from(expenses).where(eq(expenses.id, res.body.id));
    expect(enBase).toMatchObject({ propertyId: property.id, category: "TAX", notes: "Avis 2026", recurrence: "ANNUAL" });
    expect(enBase.recurrenceEndDate).toEqual(fin);
    expect((await creer(h, { propertyId: property.id, title: "Trimestre", amount: 1, recurrence: "QUARTERLY" })).status).toBe(400);
    expect((await creer(h, { propertyId: property.id, title: "Notes", amount: 1, notes: "x".repeat(5001) })).status).toBe(400);
    expect((await creer(h, { propertyId: property.id, title: "Notes", amount: 1, notes: "x".repeat(5000) })).status).toBe(201);
  });

  it("sans date, la dépense est datée d'aujourd'hui", async () => {
    const { property, h } = await agence();
    const avant = Date.now();

    const res = await creer(h, { propertyId: property.id, title: "Sans date", amount: 10 });

    const date = new Date(res.body.expenseDate).getTime();
    expect(date).toBeGreaterThanOrEqual(avant - 1000);
    expect(date).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe("GET /api/expenses — liste", () => {
  it("filtre par bien, du plus récent au plus ancien, avec le bien joint et un total qui ne compte que les dépenses du gestionnaire", async () => {
    const { manager, property, h } = await agence();
    const autreBien = await createProperty(manager.id, { title: "Studio Beta" });
    const a = await createExpense(property.id, { title: "A", expenseDate: new Date(2026, 0, 10) });
    const b = await createExpense(property.id, { title: "B", expenseDate: new Date(2026, 2, 10) });
    const c = await createExpense(property.id, { title: "C", expenseDate: new Date(2026, 1, 10) });
    await createExpense(autreBien.id, { title: "D", expenseDate: new Date(2026, 3, 10) });
    const intrus = await createManager();
    await createExpense((await createProperty(intrus.id)).id, { title: "Intrus", expenseDate: new Date(2026, 4, 10) });

    const tout = await request(app).get("/api/expenses").set(h);
    expect(tout.body.total).toBe(4);
    expect(tout.body.items.map((i: { title: string }) => i.title)).toEqual(["D", "B", "C", "A"]);
    expect(tout.body.items.find((i: { title: string }) => i.title === "B").property).toMatchObject({ id: property.id, title: "Villa Alpha" });

    const filtre = await request(app).get(`/api/expenses?propertyId=${property.id}`).set(h);
    expect(filtre.body.items.map((i: { id: string }) => i.id)).toEqual([b.id, c.id, a.id]);
    expect(filtre.body.total).toBe(3);

    const page2 = await request(app).get("/api/expenses?pageSize=2&page=2").set(h);
    expect(page2.body.items.map((i: { title: string }) => i.title)).toEqual(["C", "A"]);
  });
});

describe("DELETE /api/expenses/:id", () => {
  it("supprime vraiment la dépense, et elle seule ; celle d'une autre agence est intouchable", async () => {
    const { property, h } = await agence();
    const cible = await createExpense(property.id, { title: "Cible" });
    const voisine = await createExpense(property.id, { title: "Voisine" });
    const intrus = await createManager();
    const autre = await createExpense((await createProperty(intrus.id)).id, { title: "Autre agence" });
    const existe = async (id: string) => (await testDb.select().from(expenses).where(eq(expenses.id, id))).length === 1;

    const refus = await request(app).delete(`/api/expenses/${autre.id}`).set(h);
    expect(refus.status).toBe(404);
    expect(await existe(autre.id)).toBe(true);

    const res = await request(app).delete(`/api/expenses/${cible.id}`).set(h);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: "Dépense supprimée" });
    expect(await existe(cible.id)).toBe(false);
    expect(await existe(voisine.id)).toBe(true);
    expect(await existe(autre.id)).toBe(true);
  });
});

describe("GET /api/expenses/summary — bilan", () => {
  it("cumule les dépenses d'une même catégorie et d'une même devise, arrondies au centime (0,1 + 0,2 = 0,3)", async () => {
    const { property, h } = await agence();
    await createExpense(property.id, { category: "MAINTENANCE", amount: 0.1, currency: "EUR" });
    await createExpense(property.id, { category: "MAINTENANCE", amount: 0.2, currency: "EUR" });
    await createExpense(property.id, { category: "TAX", amount: 50, currency: "EUR" });

    const res = await synthese(h);

    expect(res.body.totalExpensesByCurrency).toEqual({ EUR: 50.3 });
    expect(res.body.expensesByCategory).toEqual({ MAINTENANCE: { EUR: 0.3 }, TAX: { EUR: 50 } });
    expect(res.body.netCashFlowByCurrency).toEqual({ EUR: -50.3 });
    expect(res.body.expenseCount).toBe(3);
  });

  it("le total des dépenses est lui aussi arrondi au centime quand il ne contient que 0,1 et 0,2", async () => {
    const { property, h } = await agence();
    await createExpense(property.id, { category: "OTHER", amount: 0.1, currency: "EUR" });
    await createExpense(property.id, { category: "OTHER", amount: 0.2, currency: "EUR" });

    const res = await synthese(h);

    // Sans arrondi, 0,1 + 0,2 donnerait 0,30000000000000004.
    expect(res.body.totalExpensesByCurrency).toEqual({ EUR: 0.3 });
    expect(res.body.expensesByCategory).toEqual({ OTHER: { EUR: 0.3 } });
    expect(res.body.netCashFlowByCurrency).toEqual({ EUR: -0.3 });
  });

  it("une devise où il n'y a que des dépenses, sans loyer, figure au net (en négatif)", async () => {
    const { property, h } = await agence();
    await createExpense(property.id, { amount: 70, currency: "XOF" });

    const res = await synthese(h);

    expect(res.body.netCashFlowByCurrency).toEqual({ XOF: -70 });
  });

  it("une facture partiellement encaissée compte comme argent reçu mais pas comme facture payée", async () => {
    const { manager, property, h } = await agence();
    const locataire = await createTenant(manager.id);
    const contrat = await createContract(property.id, locataire.id);
    await createInvoice(contrat.id, { status: "PAID", amount: 500, paidAt: new Date() });
    await createInvoice(contrat.id, { status: "PENDING", amount: 800, amountPaid: 300, periodMonth: 7 });
    // Une facture en retard qui a reçu un acompte : de l'argent reçu, mais toujours pas une facture payée.
    await createInvoice(contrat.id, { status: "LATE", amount: 600, amountPaid: 200, periodMonth: 8 });

    const res = await synthese(h);

    expect(res.body.paidInvoiceCount).toBe(1);
  });
});

describe("GET /api/expenses/export", () => {
  const MINUIT = (annee: number, mois: number, jour: number) => new Date(annee, mois - 1, jour, 0, 0, 0);

  it("la période inclut son premier instant (00:00:00) et son dernier (23:59:59), et exclut la seconde d'avant et la seconde d'après", async () => {
    const { property, h } = await agence();
    await createExpense(property.id, { title: "Veille", expenseDate: new Date(2026, 1, 28, 23, 59, 59) });
    await createExpense(property.id, { title: "Premier instant", expenseDate: MINUIT(2026, 3, 1) });
    await createExpense(property.id, { title: "Dernier instant", expenseDate: new Date(2026, 2, 31, 23, 59, 59) });
    await createExpense(property.id, { title: "Lendemain", expenseDate: MINUIT(2026, 4, 1) });

    const res = await exporter(h, "?from=2026-03-01&to=2026-03-31");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Premier instant");
    expect(res.text).toContain("Dernier instant");
    expect(res.text).not.toContain("Veille");
    expect(res.text).not.toContain("Lendemain");
  });

  it("ne reprend ni les dépenses ni les loyers d'une autre agence", async () => {
    const { property, h } = await agence();
    await createExpense(property.id, { title: "Ma dépense" });
    const intrus = await createManager();
    const biend = await createProperty(intrus.id, { title: "Bien intrus" });
    await createExpense(biend.id, { title: "Dépense intruse" });
    const contrat = await createContract(biend.id, (await createTenant(intrus.id)).id);
    await createInvoice(contrat.id, { status: "PAID", paidAt: new Date() });

    const res = await exporter(h);

    expect(res.text).toContain("Ma dépense");
    expect(res.text).not.toContain("Dépense intruse");
    expect(res.text).not.toContain("Bien intrus");
  });

  it("le résumé a une ligne par bien ET par devise, triées par titre puis par devise, sans fondre deux biens de même devise", async () => {
    const { manager, property, h } = await agence();
    const beta = await createProperty(manager.id, { title: "Villa Beta" });
    // Insérés dans le désordre : XOF avant EUR sur le même bien.
    await createExpense(property.id, { amount: 1000, currency: "XOF", title: "Alpha en francs" });
    await createExpense(property.id, { amount: 20, currency: "EUR", title: "Alpha en euros" });
    await createExpense(beta.id, { amount: 30, currency: "EUR", title: "Beta en euros" });

    const res = await exporter(h);
    const apresResume = lignes(res).slice(lignes(res).indexOf("--- Résumé par bien ---") + 2).filter((l) => l !== "");

    expect(apresResume).toEqual([
      '"Villa Alpha";0,00;20,00;-20,00;EUR',
      '"Villa Alpha";0,00;1000,00;-1000,00;XOF',
      '"Villa Beta";0,00;30,00;-30,00;EUR',
    ]);
  });

  it("se télécharge : type CSV UTF-8, pièce jointe datée du jour, BOM en tête", async () => {
    const { h } = await agence();

    const res = await exporter(h);

    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="rapport-financier-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
  });
});
