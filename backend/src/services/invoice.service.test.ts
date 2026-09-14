import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { contracts, invoices } from "../db/schema";
import { generateInvoicesForContract } from "./invoice.service";

describe("generateInvoicesForContract", () => {
  beforeEach(() => {
    // Horloge figée au 15 juin 2026 pour un calcul de statut LATE/PENDING
    // déterministe (voir le détail du calcul dans les commentaires ci-dessous).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 15));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("génère une facture par mois du début du contrat jusqu'au mois courant, avec le bon statut", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);

    const [contract] = await testDb
      .insert(contracts)
      .values({
        propertyId: property.id,
        tenantId: tenant.id,
        rent: 500,
        deposit: 1000,
        // Échéance le 20 de chaque mois : avec "aujourd'hui" figé au 15 juin,
        // seule la facture de juin (échéance le 20, donc future) doit rester
        // PENDING ; janvier à mai (échéance déjà passée) doivent être LATE.
        startDate: new Date(2026, 0, 20),
        endDate: new Date(2027, 0, 19),
      })
      .returning();

    const createdIds = await generateInvoicesForContract(contract, testDb);
    expect(createdIds).toHaveLength(6); // janvier à juin 2026 inclus

    const rows = await testDb
      .select()
      .from(invoices)
      .where(eq(invoices.contractId, contract.id));
    expect(rows).toHaveLength(6);

    const byMonth = new Map<number, typeof invoices.$inferSelect>(
      rows.map((r: typeof invoices.$inferSelect) => [r.periodMonth, r])
    );
    for (let month = 1; month <= 5; month++) {
      expect(byMonth.get(month)?.status).toBe("LATE");
    }
    expect(byMonth.get(6)?.status).toBe("PENDING");

    // Le montant de chaque facture doit reprendre le loyer du contrat.
    expect(rows.every((r: typeof invoices.$inferSelect) => r.amount === 500)).toBe(true);
  });

  it("est idempotent : un second appel ne recrée aucune facture déjà générée", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);

    const [contract] = await testDb
      .insert(contracts)
      .values({
        propertyId: property.id,
        tenantId: tenant.id,
        rent: 500,
        deposit: 1000,
        startDate: new Date(2026, 0, 20),
        endDate: new Date(2027, 0, 19),
      })
      .returning();

    const firstRun = await generateInvoicesForContract(contract, testDb);
    expect(firstRun).toHaveLength(6);

    const secondRun = await generateInvoicesForContract(contract, testDb);
    expect(secondRun).toHaveLength(0);

    const rows = await testDb.select().from(invoices).where(eq(invoices.contractId, contract.id));
    expect(rows).toHaveLength(6);
  });

  // Régression du bug corrigé précédemment (voir le commentaire détaillé dans
  // generateInvoicesForContract) : `new Date(year, month, day)` déborde
  // silencieusement sur le mois suivant quand `day` dépasse le nombre de
  // jours du mois visé. Un bail démarrant le 31 janvier produisait ainsi
  // une échéance "février" datée du 3 mars au lieu du 28 février.
  it("plafonne l'échéance au dernier jour du mois quand le bail démarre le 31 d'un mois plus court", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);

    const [contract] = await testDb
      .insert(contracts)
      .values({
        propertyId: property.id,
        tenantId: tenant.id,
        rent: 500,
        deposit: 1000,
        // "aujourd'hui" est figé au 15 juin 2026 (voir beforeEach) : ce bail
        // couvre donc janvier à juin, dont février (28 jours en 2026, non
        // bissextile) et mars (31 jours, aucun plafonnement nécessaire).
        startDate: new Date(2026, 0, 31),
        endDate: new Date(2026, 11, 31),
      })
      .returning();

    await generateInvoicesForContract(contract, testDb);

    const rows = await testDb.select().from(invoices).where(eq(invoices.contractId, contract.id));
    const byMonth = new Map<number, typeof invoices.$inferSelect>(
      rows.map((r: typeof invoices.$inferSelect) => [r.periodMonth, r])
    );

    const februaryDueDate = new Date(byMonth.get(2)!.dueDate);
    expect(februaryDueDate.getFullYear()).toBe(2026);
    expect(februaryDueDate.getMonth()).toBe(1); // février (0-indexé), pas mars
    expect(februaryDueDate.getDate()).toBe(28); // dernier jour réel de février 2026, pas le 3 mars

    const januaryDueDate = new Date(byMonth.get(1)!.dueDate);
    expect(januaryDueDate.getDate()).toBe(31); // pas de plafonnement nécessaire, janvier a 31 jours

    const marchDueDate = new Date(byMonth.get(3)!.dueDate);
    expect(marchDueDate.getDate()).toBe(31); // pas de plafonnement nécessaire, mars a 31 jours
  });

  it("s'arrête à la date de fin du contrat si elle est déjà passée", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);

    const [contract] = await testDb
      .insert(contracts)
      .values({
        propertyId: property.id,
        tenantId: tenant.id,
        rent: 500,
        deposit: 1000,
        status: "ENDED",
        startDate: new Date(2026, 0, 20),
        // Contrat déjà terminé fin mars, alors que "aujourd'hui" est le 15 juin.
        endDate: new Date(2026, 2, 31),
      })
      .returning();

    const createdIds = await generateInvoicesForContract(contract, testDb);
    // janvier, février, mars uniquement (pas avril à juin, le contrat est fini avant)
    expect(createdIds).toHaveLength(3);
  });

  it("préserve la devise du contrat sur toutes les factures générées (ex: XOF)", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id, { currency: "XOF" });
    const tenant = await createTenant(manager.id);

    const [contract] = await testDb
      .insert(contracts)
      .values({
        propertyId: property.id,
        tenantId: tenant.id,
        rent: 250000,
        deposit: 500000,
        currency: "XOF",
        startDate: new Date(2026, 4, 1),
        endDate: new Date(2027, 3, 30),
      })
      .returning();

    await generateInvoicesForContract(contract, testDb);

    const rows = await testDb
      .select()
      .from(invoices)
      .where(eq(invoices.contractId, contract.id));

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r: typeof invoices.$inferSelect) => r.currency === "XOF")).toBe(true);
    expect(rows.every((r: typeof invoices.$inferSelect) => r.amount === 250000)).toBe(true);
  });

  /**
   * Régression : un renouvellement (voir renewContract, contract.controller.ts)
   * démarre le nouveau contrat le lendemain de la fin de l'ancien — souvent en
   * milieu de mois — mais le curseur ci-dessus repart toujours du 1er du mois
   * de son startDate. Le mois de transition recevait donc une facture PLEINE
   * de l'ancien contrat (déjà émise avant le renouvellement) ET une facture
   * PLEINE du nouveau (émise aussitôt après) : le double du loyer réellement
   * dû pour ce mois. L'index unique (contractId, mois, année) ne pouvait pas
   * l'empêcher : il ne protège que contre un doublon au sein d'un même
   * contrat, jamais entre deux contrats successifs du même bien.
   */
  it("ne refacture pas un mois déjà facturé par un AUTRE contrat du même bien (renouvellement mi-mois)", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);

    const [ancienContrat] = await testDb
      .insert(contracts)
      .values({
        propertyId: property.id,
        tenantId: tenant.id,
        rent: 500,
        deposit: 1000,
        status: "ENDED",
        startDate: new Date(2026, 0, 1),
        endDate: new Date(2026, 1, 15), // se termine le 15 février, renouvelé le lendemain
      })
      .returning();
    // L'ancien contrat a déjà facturé février (loyer plein) avant son renouvellement.
    await generateInvoicesForContract(ancienContrat, testDb);
    const facturesAncien = await testDb.select().from(invoices).where(eq(invoices.contractId, ancienContrat.id));
    expect(
      facturesAncien.some((f: typeof invoices.$inferSelect) => f.periodMonth === 2 && f.periodYear === 2026)
    ).toBe(true);

    const [nouveauContrat] = await testDb
      .insert(contracts)
      .values({
        propertyId: property.id,
        tenantId: tenant.id,
        rent: 550, // loyer réévalué au renouvellement
        deposit: 1000,
        startDate: new Date(2026, 1, 16), // démarre le lendemain de la fin de l'ancien
        endDate: new Date(2027, 1, 15),
      })
      .returning();

    await generateInvoicesForContract(nouveauContrat, testDb);

    const facturesNouveau = await testDb.select().from(invoices).where(eq(invoices.contractId, nouveauContrat.id));
    // Février est déjà réglé par l'ancien contrat : le nouveau ne doit PAS le refacturer.
    expect(
      facturesNouveau.some((f: typeof invoices.$inferSelect) => f.periodMonth === 2 && f.periodYear === 2026)
    ).toBe(false);
    // Mars, en revanche, n'a jamais été facturé par personne : il doit apparaître.
    expect(
      facturesNouveau.some((f: typeof invoices.$inferSelect) => f.periodMonth === 3 && f.periodYear === 2026)
    ).toBe(true);
  });
});
