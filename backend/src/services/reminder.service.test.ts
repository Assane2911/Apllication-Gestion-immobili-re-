import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoices } from "../db/schema";
import * as emailService from "./email.service";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { runRentDueReminders, runUpcomingRentDueReminders, sendSingleInvoiceReminder } from "./reminder.service";

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

  /**
   * Régression : le SELECT initial chargeait toutes les factures sans
   * rappel envoyé AVANT que la boucle n'écrive `reminderSentAt` sur
   * chacune. Deux exécutions concurrentes (le cron du 1er du mois et un
   * gestionnaire cliquant "Envoyer les avis" au même moment, ou une double
   * invocation du cron) chargeaient donc le MÊME instantané et envoyaient
   * chacune leur propre email pour la même facture — le locataire recevait
   * l'avis en double. Le délai artificiel sur sendEmail laisse le temps à
   * la seconde exécution d'atteindre sa propre tentative de réclamation
   * avant que la première n'ait terminé — la fenêtre qui, avant ce
   * correctif, laissait passer les deux envois.
   */
  it("deux exécutions concurrentes n'envoient qu'un seul avis par facture", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, {
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2027, 7, 1),
    });
    // Facture créée directement (plutôt que via generateInvoicesForContract,
    // appelé en interne par runRentDueReminders) : ce test cible la course
    // sur la RÉCLAMATION du rappel, pas sur la génération de facture elle-même
    // — un contrat démarré ce mois-ci aurait fait tourner la génération
    // automatique en concurrence dans les deux appels, avec son propre lot de
    // problèmes hors sujet ici.
    await createInvoice(contract.id, {
      periodMonth: 8,
      periodYear: 2026,
      status: "PENDING",
      dueDate: new Date(2026, 7, 5),
    });

    const sendEmailSpy = vi
      .spyOn(emailService, "sendEmail")
      .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ simulated: true }), 40)));

    const [resultA, resultB] = await Promise.all([runRentDueReminders(), runRentDueReminders()]);

    expect(resultA.sent + resultB.sent).toBe(1);
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);

    const [invoice] = await testDb.select().from(invoices);
    expect(invoice.reminderSentAt).not.toBeNull();

    sendEmailSpy.mockRestore();
  });
});

describe("sendSingleInvoiceReminder", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 1));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Régression : sendSingleInvoiceReminder envoyait l'email PUIS marquait
   * reminderSentAt, sans aucune réclamation préalable — un double-clic du
   * gestionnaire sur "Envoyer un rappel" (ou deux requêtes API quasi
   * simultanées) déclenchait deux envois pour la même facture.
   */
  it("deux envois manuels quasi simultanés sur la même facture n'envoient qu'un seul rappel", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const invoice = await createInvoice(contract.id, {
      periodMonth: 8,
      periodYear: 2026,
      status: "PENDING",
      dueDate: new Date(2026, 7, 20),
    });

    const sendEmailSpy = vi
      .spyOn(emailService, "sendEmail")
      .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ simulated: true }), 40)));

    const [resultA, resultB] = await Promise.allSettled([
      sendSingleInvoiceReminder(invoice.id, manager.id),
      sendSingleInvoiceReminder(invoice.id, manager.id),
    ]);

    const statuses = [resultA.status, resultB.status].sort();
    expect(statuses).toEqual(["fulfilled", "rejected"]);
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);

    sendEmailSpy.mockRestore();
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
