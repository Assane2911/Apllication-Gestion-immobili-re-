import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import {
  authHeader,
  createContract,
  createExpense,
  createInvoice,
  createManager,
  createOwner,
  createProperty,
  createTenant,
  tokenFor,
  tokenProprietaire,
} from "./authHelpers";

/**
 * NON-RÉGRESSION des bilans.
 *
 * Les bilans (fiscal, grand livre, FEC, SYSCOHADA, résumé et export des
 * dépenses, compte-rendu de gestion, tableaux de bord) reposaient sur
 * `invoice.amount` des factures payées. Ils comptent désormais chaque
 * ENCAISSEMENT à sa propre date (paiements partiels). Ce jeu de données ne
 * contient que des factures réglées d'un coup, comme toutes celles qui existent
 * déjà : les chiffres doivent rester IDENTIQUES à ceux d'avant. Les instantanés
 * ont été pris sur le code d'avant le changement.
 *
 * Jeu de données : horloge figée au 12/10/2026, deux devises, un propriétaire
 * avec commission, une facture en retard, une facture payée sans date de
 * paiement (repli sur l'échéance), des dépenses.
 */
const ANNEES = [2025, 2026];

/** Les références de pièce (FEC, SYSCOHADA) reprennent l'identifiant aléatoire de la facture. */
const sansRefAleatoire = (texte: string) => texte.replace(/\b[a-z0-9]{24,25}\b/g, "<id>");

function sansIdentifiants(corps: unknown): unknown {
  return JSON.parse(
    JSON.stringify(corps, (cle, valeur) => (cle === "id" || /Id$/.test(cle) || /At$/.test(cle) ? undefined : valeur))
  );
}

async function jeuDeDonnees() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
  const proprietaire = await createOwner(manager.id, { managementFeeRate: 8 });
  const studio = await createProperty(manager.id, { title: "Studio A", ownerId: proprietaire.id, currency: "EUR" });
  const villa = await createProperty(manager.id, { title: "Villa B", ownerId: proprietaire.id, currency: "XOF", rent: 250000 });
  const awa = await createTenant(manager.id, { firstName: "Awa", lastName: "Diallo" });
  const moussa = await createTenant(manager.id, { firstName: "Moussa", lastName: "Sy" });
  const c1 = await createContract(studio.id, awa.id, { status: "ACTIVE", startDate: new Date(2025, 0, 1), endDate: new Date(2027, 0, 1) });
  const c2 = await createContract(villa.id, moussa.id, { status: "ACTIVE", startDate: new Date(2025, 0, 1), endDate: new Date(2027, 0, 1) });

  const paye = (contractId: string, annee: number, mois: number, montant: number, devise: string, methode: "BANK_TRANSFER" | "CASH" = "BANK_TRANSFER") =>
    createInvoice(contractId, {
      status: "PAID",
      periodMonth: mois,
      periodYear: annee,
      amount: montant,
      currency: devise,
      dueDate: new Date(Date.UTC(annee, mois - 1, 5)),
      paidAt: new Date(Date.UTC(annee, mois - 1, 6, 12)),
      paymentMethod: methode,
    });

  await paye(c1.id, 2025, 11, 500, "EUR");
  await paye(c1.id, 2025, 12, 500, "EUR", "CASH");
  await paye(c1.id, 2026, 7, 550, "EUR");
  await paye(c1.id, 2026, 8, 550, "EUR");
  await paye(c1.id, 2026, 9, 550, "EUR");
  await paye(c1.id, 2026, 10, 550, "EUR");
  await paye(c2.id, 2026, 9, 250000, "XOF");
  await paye(c2.id, 2026, 10, 250000, "XOF");
  // Payée sans date de paiement : repli sur l'échéance.
  await createInvoice(c1.id, {
    status: "PAID", periodMonth: 5, periodYear: 2026, amount: 500, currency: "EUR",
    dueDate: new Date(Date.UTC(2026, 4, 5)), paidAt: null, paymentMethod: "BANK_TRANSFER",
  });
  // En retard (non encaissée) : ne doit figurer dans aucun revenu.
  await createInvoice(c1.id, {
    status: "LATE", periodMonth: 6, periodYear: 2026, amount: 650, currency: "EUR", dueDate: new Date(Date.UTC(2026, 5, 5)),
  });
  // En attente du mois courant, sur l'autre bien.
  await createInvoice(c2.id, {
    status: "PENDING", periodMonth: 11, periodYear: 2026, amount: 250000, currency: "XOF", dueDate: new Date(Date.UTC(2026, 10, 5)),
  });

  await createExpense(studio.id, { category: "MAINTENANCE", title: "Plomberie", amount: 120, currency: "EUR", expenseDate: new Date(Date.UTC(2026, 8, 12)) });
  await createExpense(studio.id, { category: "INSURANCE", title: "Assurance", amount: 300, currency: "EUR", expenseDate: new Date(Date.UTC(2025, 10, 20)) });
  await createExpense(villa.id, { category: "MAINTENANCE", title: "Peinture", amount: 80000, currency: "XOF", expenseDate: new Date(Date.UTC(2026, 9, 3)) });

  return { manager, proprietaire };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T10:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("bilans — chiffres inchangés pour des factures réglées d'un coup", () => {
  it.each(ANNEES)("bilan fiscal %i : synthèse, grand livre, FEC, SYSCOHADA", async (annee) => {
    const { manager } = await jeuDeDonnees();
    const h = authHeader(tokenFor(manager));
    const lire = async (chemin: string) => {
      const res = await request(app).get(`/api/fiscal/${chemin}?year=${annee}`).set(h);
      expect(res.status, chemin).toBe(200);
      return res.type.includes("json") ? sansIdentifiants(res.body) : sansRefAleatoire(res.text);
    };
    expect({
      synthese: await lire("synthese"),
      grandLivre: await lire("grand-livre"),
      fec: await lire("fec"),
      syscohada: await lire("syscohada"),
    }).toMatchSnapshot();
  });

  it("résumé et export des dépenses", async () => {
    const { manager } = await jeuDeDonnees();
    const h = authHeader(tokenFor(manager));
    const resume = await request(app).get("/api/expenses/summary").set(h);
    const export1 = await request(app).get("/api/expenses/export").set(h);
    const export2 = await request(app).get("/api/expenses/export?from=2026-09-01&to=2026-10-31").set(h);
    expect({ resume: sansIdentifiants(resume.body), exportComplet: sansRefAleatoire(export1.text), exportPartiel: sansRefAleatoire(export2.text) }).toMatchSnapshot();
  });

  it.each([9, 10])("compte-rendu de gestion du propriétaire, mois %i/2026", async (mois) => {
    const { manager, proprietaire } = await jeuDeDonnees();
    const res = await request(app).get(`/api/crg/${proprietaire.id}?month=${mois}&year=2026`).set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(200);
    expect(sansIdentifiants(res.body)).toMatchSnapshot();
  });

  it("tableau de bord du gestionnaire", async () => {
    const { manager } = await jeuDeDonnees();
    const res = await request(app).get("/api/dashboard/stats").set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(200);
    expect(sansIdentifiants(res.body)).toMatchSnapshot();
  });

  it("tableau de bord du propriétaire", async () => {
    const { proprietaire } = await jeuDeDonnees();
    const jeton = await tokenProprietaire(proprietaire);
    const res = await request(app).get("/api/owners/mine/dashboard").set(authHeader(jeton));
    expect(res.status).toBe(200);
    expect(sansIdentifiants(res.body)).toMatchSnapshot();
  });
});
