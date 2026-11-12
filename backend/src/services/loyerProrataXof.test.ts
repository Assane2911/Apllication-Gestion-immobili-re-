import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contracts, invoices } from "../db/schema";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { arrondirPourDevise, estDeviseSansDecimale } from "../utils/montants";
import { generateInvoicesForContract } from "./invoice.service";
import { calculerNouveauLoyer, creerRevision } from "./rentRevision.service";
import { calculerSolde } from "./soldeDeToutCompte.service";

/**
 * Le franc CFA ne se divise pas : une facture au prorata ne doit pas porter de centimes (54 838,71 FCFA), que ni l'affichage ni
 * le prestataire de paiement ne savent traiter. Les loyers en euros gardent le centime.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 5, 15)); // 15 juin 2026
});

afterEach(() => {
  vi.useRealTimers();
});

async function bail(devise: "XOF" | "EUR", overrides: Partial<typeof contracts.$inferInsert> = {}) {
  const manager = await createManager();
  const property = await createProperty(manager.id, { currency: devise });
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id, { currency: devise, rent: 100000, ...overrides });
  return { manager, property, tenant, contract };
}

describe("arrondirPourDevise", () => {
  it("arrondit au franc pour le franc CFA et au centime pour l'euro", () => {
    expect(estDeviseSansDecimale("XOF")).toBe(true);
    expect(estDeviseSansDecimale("xof")).toBe(true);
    expect(estDeviseSansDecimale("EUR")).toBe(false);
    expect(arrondirPourDevise(54838.709677, "XOF")).toBe(54839);
    expect(arrondirPourDevise(54838.709677, "EUR")).toBe(54838.71);
    expect(arrondirPourDevise(54838.709677, undefined)).toBe(54838.71);
  });
});

describe("Génération des factures — le premier mois au prorata", () => {
  it("en francs CFA : 17 jours sur 31 d'un loyer de 100 000 donnent 54 839, sans centimes", async () => {
    // Bail du 15 mai : 17 jours (15 à 31) sur les 31 de mai = 100 000 × 17 / 31 = 54 838,709…
    const { contract } = await bail("XOF", { startDate: new Date(2026, 4, 15), endDate: new Date(2027, 4, 14) });

    await generateInvoicesForContract(contract, testDb);

    const factures = await testDb.select().from(invoices).where(eq(invoices.contractId, contract.id));
    const mai = factures.find((f: typeof invoices.$inferSelect) => f.periodMonth === 5);
    const juin = factures.find((f: typeof invoices.$inferSelect) => f.periodMonth === 6);
    expect(mai!.amount).toBe(54839);
    expect(juin!.amount).toBe(100000);
  });

  it("en euros : le même prorata garde son centime (54 838,71)", async () => {
    const { contract } = await bail("EUR", { startDate: new Date(2026, 4, 15), endDate: new Date(2027, 4, 14) });

    await generateInvoicesForContract(contract, testDb);

    const [mai] = (await testDb.select().from(invoices).where(eq(invoices.contractId, contract.id))).filter((f: typeof invoices.$inferSelect) => f.periodMonth === 5);
    expect(mai.amount).toBe(54838.71);
  });
});

describe("Solde de tout compte — le dernier mois au prorata", () => {
  it("en francs CFA : 17 jours sur 30 d'un loyer de 100 000 donnent 56 667, sans centimes", async () => {
    const { contract } = await bail("XOF", { startDate: new Date(2026, 0, 1), endDate: new Date(2026, 11, 31) });
    await createInvoice(contract.id, { periodMonth: 6, periodYear: 2026, amount: 100000, currency: "XOF", status: "PENDING", dueDate: new Date(2026, 5, 5) });

    const solde = await calculerSolde(contract, { exitDate: new Date(2026, 5, 17), lastMonthMode: "PRORATA" });

    const juin = solde.lignes.find((l: { periodMonth: number }) => l.periodMonth === 6)!;
    expect(juin.retenu).toBe(56667);
  });

  it("en euros : le même calcul garde son centime (56 666,67)", async () => {
    const { contract } = await bail("EUR", { startDate: new Date(2026, 0, 1), endDate: new Date(2026, 11, 31) });
    await createInvoice(contract.id, { periodMonth: 6, periodYear: 2026, amount: 100000, currency: "EUR", status: "PENDING", dueDate: new Date(2026, 5, 5) });

    const solde = await calculerSolde(contract, { exitDate: new Date(2026, 5, 17), lastMonthMode: "PRORATA" });

    expect(solde.lignes.find((l: { periodMonth: number }) => l.periodMonth === 6)!.retenu).toBe(56666.67);
  });
});

describe("Révision de loyer — le nouveau loyer et les factures recalculées", () => {
  it("le nouveau loyer calculé en pourcentage est un franc entier en francs CFA, au centime en euros", () => {
    expect(calculerNouveauLoyer(100001, { mode: "PERCENT", percent: 3.3 }, "XOF")).toBe(103301);
    expect(calculerNouveauLoyer(100001, { mode: "PERCENT", percent: 3.3 }, "EUR")).toBe(103301.03);
    expect(calculerNouveauLoyer(100001, { mode: "PERCENT", percent: 3.3 })).toBe(103301.03);
  });

  it("une facture impayée recalculée reste un franc entier en francs CFA", async () => {
    const { manager, contract } = await bail("XOF", { startDate: new Date(2026, 0, 1), endDate: new Date(2027, 0, 1), status: "ACTIVE" });
    // Facture de juin déjà au prorata (54 839) : 54 839 × 105 500 / 100 000 = 57 855,145.
    const facture = await createInvoice(contract.id, { periodMonth: 6, periodYear: 2026, amount: 54839, currency: "XOF", status: "PENDING", dueDate: new Date(2026, 5, 20) });

    await creerRevision({
      contractId: contract.id,
      managerId: manager.id,
      entree: { mode: "AMOUNT", newRent: 105500 },
      effectiveDate: new Date(Date.UTC(2026, 5, 1)),
      prevenirLocataire: false,
      maintenant: new Date(2026, 5, 15),
    });

    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, facture.id));
    expect(apres.amount).toBe(57855);
  });
});
