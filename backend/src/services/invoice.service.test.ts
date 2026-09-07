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
});
