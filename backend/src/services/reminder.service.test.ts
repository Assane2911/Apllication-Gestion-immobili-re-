import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoices } from "../db/schema";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { runRentDueReminders, runUpcomingRentDueReminders } from "./reminder.service";

describe("runRentDueReminders", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 1)); // 1er août 2026
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Régression du bug corrigé précédemment ("Corriger le doublon possible
  // des avis d'échéance du 1er du mois") : sans le filtre
  // isNull(invoices.reminderSentAt), un second déclenchement le même mois
  // (cron + clic manuel du gestionnaire, ou double invocation du cron)
  // renvoyait l'avis à tous les locataires impayés une deuxième fois.
  it("envoie un avis d'échéance puis n'en renvoie aucun au second appel du même mois", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    // Le contrat démarre CE mois-ci (août) : generateInvoicesForContract,
    // appelé en interne par runRentDueReminders, ne crée alors qu'une seule
    // facture (celle du mois courant) — un démarrage antérieur créerait
    // aussi les factures des mois précédents, qui ne seraient jamais
    // sélectionnées par le filtre periodMonth/periodYear du mois courant et
    // fausseraient la lecture ci-dessous (plusieurs lignes en base).
    await createContract(property.id, tenant.id, {
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2027, 7, 1),
    });

    const firstRun = await runRentDueReminders();
    expect(firstRun.sent).toBe(1);

    const [invoice] = await testDb.select().from(invoices);
    expect(invoice.reminderSentAt).not.toBeNull();

    const secondRun = await runRentDueReminders();
    expect(secondRun.sent).toBe(0);
  });
});

describe("runUpcomingRentDueReminders", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 1)); // 1er août 2026
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("envoie le rappel 'avant échéance' (J-3) pour une facture qui arrive à échéance dans 3 jours, puis n'en renvoie aucun au second appel", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, {
      periodMonth: 8,
      periodYear: 2026,
      dueDate: new Date(2026, 7, 4), // dans exactement 3 jours (RENT_DUE_SOON_DAYS par défaut)
      status: "PENDING",
    });

    const firstRun = await runUpcomingRentDueReminders();
    expect(firstRun.sent).toBe(1);

    const [invoice] = await testDb.select().from(invoices);
    expect(invoice.dueSoonReminderSentAt).not.toBeNull();

    const secondRun = await runUpcomingRentDueReminders();
    expect(secondRun.sent).toBe(0);
  });

  it("ne renvoie aucun rappel pour une facture dont l'échéance est trop lointaine", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, {
      periodMonth: 8,
      periodYear: 2026,
      dueDate: new Date(2026, 7, 20), // bien au-delà de la fenêtre J-3
      status: "PENDING",
    });

    const result = await runUpcomingRentDueReminders();
    expect(result.sent).toBe(0);
  });

  it("bascule automatiquement en retard (LATE) les factures PENDING dont l'échéance est déjà dépassée", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const overdueInvoice = await createInvoice(contract.id, {
      periodMonth: 7,
      periodYear: 2026,
      dueDate: new Date(2026, 6, 20), // échéance déjà passée (12 jours avant "aujourd'hui")
      status: "PENDING",
    });

    await runUpcomingRentDueReminders();

    const [updated] = await testDb.select().from(invoices).where(eq(invoices.id, overdueInvoice.id));
    expect(updated.status).toBe("LATE");
  });
});
