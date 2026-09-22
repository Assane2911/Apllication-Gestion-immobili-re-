import { and, eq } from "drizzle-orm";
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

    // Le bail démarre le 20 janvier : ce premier mois est facturé au prorata
    // des 12 jours occupés (20 au 31 janvier), 500 × 12/31 = 193,55. Les mois
    // entiers qui suivent valent le loyer exact du bail.
    expect(byMonth.get(1)?.amount).toBe(193.55);
    for (let month = 2; month <= 6; month++) {
      expect(byMonth.get(month)?.amount).toBe(500);
    }
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
  it("facture au prorata le premier mois d'un bail démarrant en cours de mois", async () => {
    // Un bail démarrant le 25 juin coûtait un mois plein. Il doit coûter les
    // 6 jours réellement occupés (25 au 30 juin) : 500 × 6/30 = 100.
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
        startDate: new Date(2026, 5, 25),
        endDate: new Date(2027, 5, 24),
      })
      .returning();

    await generateInvoicesForContract(contract, testDb);

    const rows = await testDb.select().from(invoices).where(eq(invoices.contractId, contract.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].periodMonth).toBe(6);
    expect(rows[0].amount).toBe(100);
  });

  it("facture au prorata le dernier mois d'un bail se terminant en cours de mois", async () => {
    // Bail du 1er avril au 10 juin : avril et mai pleins, juin au prorata
    // (10 jours sur 30) — 600 × 10/30 = 200.
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);

    const [contract] = await testDb
      .insert(contracts)
      .values({
        propertyId: property.id,
        tenantId: tenant.id,
        rent: 600,
        deposit: 1200,
        status: "ENDED",
        startDate: new Date(2026, 3, 1),
        endDate: new Date(2026, 5, 10),
      })
      .returning();

    await generateInvoicesForContract(contract, testDb);

    const rows = await testDb.select().from(invoices).where(eq(invoices.contractId, contract.id));
    const parMois = new Map<number, typeof invoices.$inferSelect>(
      rows.map((r: typeof invoices.$inferSelect) => [r.periodMonth, r])
    );
    expect(parMois.get(4)?.amount).toBe(600);
    expect(parMois.get(5)?.amount).toBe(600);
    expect(parMois.get(6)?.amount).toBe(200);
  });

  it("laisse les mois entiers au loyer exact, sans dérive d'arrondi", async () => {
    // Un loyer qui tombe mal en division (1000 / 31) ne doit pas être
    // recalculé sur un mois complet : le bail dit 1000, la facture dit 1000.
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);

    const [contract] = await testDb
      .insert(contracts)
      .values({
        propertyId: property.id,
        tenantId: tenant.id,
        rent: 1000,
        deposit: 2000,
        startDate: new Date(2026, 2, 1), // mars, 31 jours
        endDate: new Date(2027, 1, 28),
      })
      .returning();

    await generateInvoicesForContract(contract, testDb);

    const rows = await testDb.select().from(invoices).where(eq(invoices.contractId, contract.id));
    expect(rows.every((r: typeof invoices.$inferSelect) => r.amount === 1000)).toBe(true);
  });

  it("partage le mois de transition entre les deux locataires, chacun pour ses jours", async () => {
    // Ancien bail jusqu'au 15 février, nouveau à partir du 16 : février se
    // partage 15/28 et 13/28 au lieu de revenir en entier au premier.
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const ancienLocataire = await createTenant(manager.id);
    const nouveauLocataire = await createTenant(manager.id);

    const [ancienContrat] = await testDb
      .insert(contracts)
      .values({
        propertyId: property.id,
        tenantId: ancienLocataire.id,
        rent: 560, // 560 / 28 = 20 par jour, des montants ronds pour la lecture
        deposit: 1000,
        status: "ENDED",
        startDate: new Date(2026, 0, 1),
        endDate: new Date(2026, 1, 15),
      })
      .returning();
    await generateInvoicesForContract(ancienContrat, testDb);

    const [nouveauContrat] = await testDb
      .insert(contracts)
      .values({
        propertyId: property.id,
        tenantId: nouveauLocataire.id,
        rent: 560,
        deposit: 1000,
        startDate: new Date(2026, 1, 16),
        endDate: new Date(2027, 1, 15),
      })
      .returning();
    await generateInvoicesForContract(nouveauContrat, testDb);

    const fevrierAncien = (
      await testDb.select().from(invoices).where(eq(invoices.contractId, ancienContrat.id))
    ).find((f: typeof invoices.$inferSelect) => f.periodMonth === 2);
    const fevrierNouveau = (
      await testDb.select().from(invoices).where(eq(invoices.contractId, nouveauContrat.id))
    ).find((f: typeof invoices.$inferSelect) => f.periodMonth === 2);

    expect(fevrierAncien?.amount).toBe(300); // 15 jours × 20
    expect(fevrierNouveau?.amount).toBe(260); // 13 jours × 20
    // Ensemble, les deux locataires règlent exactement un mois de loyer.
    expect((fevrierAncien?.amount ?? 0) + (fevrierNouveau?.amount ?? 0)).toBe(560);
  });

  it("ne facture rien à un contrat dont les jours sont déjà couverts par un autre contrat du bien", async () => {
    // Deux contrats qui se chevauchent est une anomalie de dates : on
    // s'abstient plutôt que de facturer deux fois les mêmes jours.
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const locataireA = await createTenant(manager.id);
    const locataireB = await createTenant(manager.id);

    const [contratA] = await testDb
      .insert(contracts)
      .values({
        propertyId: property.id,
        tenantId: locataireA.id,
        rent: 500,
        deposit: 1000,
        startDate: new Date(2026, 4, 1),
        endDate: new Date(2027, 3, 30),
      })
      .returning();
    await generateInvoicesForContract(contratA, testDb);

    const [contratB] = await testDb
      .insert(contracts)
      .values({
        propertyId: property.id,
        tenantId: locataireB.id,
        rent: 500,
        deposit: 1000,
        startDate: new Date(2026, 4, 10), // chevauche le contrat A
        endDate: new Date(2027, 3, 30),
      })
      .returning();
    const creees = await generateInvoicesForContract(contratB, testDb);

    expect(creees).toHaveLength(0);
  });

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
    const fevrierNouveau = facturesNouveau.find(
      (f: typeof invoices.$inferSelect) => f.periodMonth === 2 && f.periodYear === 2026
    );
    const fevrierAncien = (
      await testDb.select().from(invoices).where(eq(invoices.contractId, ancienContrat.id))
    ).find((f: typeof invoices.$inferSelect) => f.periodMonth === 2 && f.periodYear === 2026);

    // Ce test protégeait à l'origine contre une DOUBLE facturation PLEINE du
    // mois de transition (l'ancien ET le nouveau contrat réclamant chacun un
    // mois entier). Depuis le passage au prorata, l'invariant s'exprime
    // autrement : chacun facture ses propres jours, et les deux ensemble ne
    // dépassent jamais un mois de loyer. Le nouveau contrat facture donc bien
    // février — pour ses 13 jours seulement, et non plus zéro.
    expect(fevrierNouveau).toBeDefined();
    expect(fevrierAncien!.amount).toBeLessThan(500); // 15 jours sur 28, pas un mois plein
    expect(fevrierNouveau!.amount).toBeLessThan(550);
    // Les deux parts, rapportées à leur loyer respectif, couvrent le mois
    // entier — à l'arrondi au centime près de chaque facture.
    expect(fevrierAncien!.amount / 500 + fevrierNouveau!.amount / 550).toBeCloseTo(1, 3);

    // Mars, lui, revient entièrement au nouveau contrat.
    const mars = facturesNouveau.find((f: typeof invoices.$inferSelect) => f.periodMonth === 3);
    expect(mars?.amount).toBe(550);
  });

  it("refacture un mois dont la seule facture, émise par un autre contrat du bien, a été annulée", async () => {
    // Le garde anti-double-facturation ci-dessus ne regardait pas le statut :
    // une facture ANNULÉE gelait donc son mois définitivement. Un gestionnaire
    // qui annulait une facture erronée du contrat précédent ne pouvait plus
    // jamais facturer ce mois-là au nouveau locataire — un loyer perdu, sans
    // aucun message.
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
        endDate: new Date(2026, 1, 15),
      })
      .returning();
    await generateInvoicesForContract(ancienContrat, testDb);

    // Le gestionnaire annule la facture de février de l'ancien contrat.
    await testDb
      .update(invoices)
      .set({ status: "CANCELLED" })
      .where(and(eq(invoices.contractId, ancienContrat.id), eq(invoices.periodMonth, 2)));

    const [nouveauContrat] = await testDb
      .insert(contracts)
      .values({
        propertyId: property.id,
        tenantId: tenant.id,
        rent: 550,
        deposit: 1000,
        startDate: new Date(2026, 1, 16),
        endDate: new Date(2027, 1, 15),
      })
      .returning();

    await generateInvoicesForContract(nouveauContrat, testDb);

    const facturesNouveau = await testDb.select().from(invoices).where(eq(invoices.contractId, nouveauContrat.id));
    expect(
      facturesNouveau.some((f: typeof invoices.$inferSelect) => f.periodMonth === 2 && f.periodYear === 2026)
    ).toBe(true);
  });

  it("ne tente pas de recréer une facture annulée du MÊME contrat (l'index unique l'interdit)", async () => {
    // Pendant du test précédent : autoriser la régénération après annulation
    // ne doit pas faire buter la génération sur l'index unique
    // (contractId, mois, année), qui existe toujours pour le contrat lui-même.
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
        startDate: new Date(2026, 3, 1),
        endDate: new Date(2027, 2, 31),
      })
      .returning();
    await generateInvoicesForContract(contract, testDb);

    await testDb
      .update(invoices)
      .set({ status: "CANCELLED" })
      .where(and(eq(invoices.contractId, contract.id), eq(invoices.periodMonth, 4)));

    await expect(generateInvoicesForContract(contract, testDb)).resolves.toBeDefined();

    const facturesAvril = await testDb
      .select()
      .from(invoices)
      .where(and(eq(invoices.contractId, contract.id), eq(invoices.periodMonth, 4)));
    expect(facturesAvril).toHaveLength(1);
    expect(facturesAvril[0].status).toBe("CANCELLED");
  });
});
