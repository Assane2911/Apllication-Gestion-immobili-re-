import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoices } from "../db/schema";
import * as emailService from "./email.service";
import * as whatsappService from "./whatsapp.service";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { runRentDueReminders, runUpcomingRentDueReminders, sendSingleInvoiceReminder } from "./reminder.service";

describe("runRentDueReminders", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 1)); // 1er aoÃ»t 2026
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // RÃ©gression du bug corrigÃ© prÃ©cÃ©demment ("Corriger le doublon possible
  // des avis d'Ã©chÃ©ance du 1er du mois") : sans le filtre
  // isNull(invoices.reminderSentAt), un second dÃ©clenchement le mÃªme mois
  // (cron + clic manuel du gestionnaire, ou double invocation du cron)
  // renvoyait l'avis Ã  tous les locataires impayÃ©s une deuxiÃ¨me fois.
  it("envoie un avis d'Ã©chÃ©ance puis n'en renvoie aucun au second appel du mÃªme mois", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    // Le contrat dÃ©marre CE mois-ci (aoÃ»t) : generateInvoicesForContract,
    // appelÃ© en interne par runRentDueReminders, ne crÃ©e alors qu'une seule
    // facture (celle du mois courant) â€” un dÃ©marrage antÃ©rieur crÃ©erait
    // aussi les factures des mois prÃ©cÃ©dents, qui ne seraient jamais
    // sÃ©lectionnÃ©es par le filtre periodMonth/periodYear du mois courant et
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

  // Le WhatsApp s'ajoute Ã  l'email (voir whatsapp.service.ts) : ce test vÃ©rifie
  // qu'il est bien invoquÃ© avec le numÃ©ro et un message cohÃ©rents, et que son
  // rÃ©sultat (simulated) remonte dans `details` sous `whatsappSimulated`.
  it("envoie aussi un message WhatsApp en complÃ©ment de l'email et reporte son statut dans details", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id, {
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2027, 7, 1),
    });

    const whatsappSpy = vi.spyOn(whatsappService, "envoyerMessageWhatsapp");

    const result = await runRentDueReminders();

    expect(result.sent).toBe(1);
    expect(whatsappSpy).toHaveBeenCalledTimes(1);
    expect(whatsappSpy).toHaveBeenCalledWith(
      tenant.phone,
      expect.any(String),
      expect.objectContaining({ "1": expect.stringContaining(tenant.firstName) })
    );
    // API Meta WhatsApp non configurÃ©e dans l'environnement de test => simulation, comme sendEmail sans SMTP.
    expect(result.details[0].whatsappSimulated).toBe(true);

    whatsappSpy.mockRestore();
  });

  // RÃ©silience : un Ã©chec du canal WhatsApp (numÃ©ro invalide, panne API Meta...)
  // ne doit ni interrompre la boucle ni empÃªcher l'email â€” dÃ©jÃ  envoyÃ©
  // sÃ©parÃ©ment â€” d'Ãªtre comptabilisÃ©.
  it("continue d'envoyer l'email et de compter le rappel mÃªme si l'envoi WhatsApp Ã©choue", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id, {
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2027, 7, 1),
    });

    const sendEmailSpy = vi.spyOn(emailService, "sendEmail");
    const whatsappSpy = vi
      .spyOn(whatsappService, "envoyerMessageWhatsapp")
      .mockResolvedValue({ simulated: false, error: true, raison: "erreur_api" });

    const result = await runRentDueReminders();

    expect(result.sent).toBe(1);
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(result.details[0].whatsappSimulated).toBe(false);

    whatsappSpy.mockRestore();
    sendEmailSpy.mockRestore();
  });

  /**
   * RÃ©gression : le SELECT initial chargeait toutes les factures sans
   * rappel envoyÃ© AVANT que la boucle n'Ã©crive `reminderSentAt` sur
   * chacune. Deux exÃ©cutions concurrentes (le cron du 1er du mois et un
   * gestionnaire cliquant "Envoyer les avis" au mÃªme moment, ou une double
   * invocation du cron) chargeaient donc le MÃŠME instantanÃ© et envoyaient
   * chacune leur propre email pour la mÃªme facture â€” le locataire recevait
   * l'avis en double. Le dÃ©lai artificiel sur sendEmail laisse le temps Ã 
   * la seconde exÃ©cution d'atteindre sa propre tentative de rÃ©clamation
   * avant que la premiÃ¨re n'ait terminÃ© â€” la fenÃªtre qui, avant ce
   * correctif, laissait passer les deux envois.
   */
  it("deux exÃ©cutions concurrentes n'envoient qu'un seul avis par facture", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, {
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2027, 7, 1),
    });
    // Facture crÃ©Ã©e directement (plutÃ´t que via generateInvoicesForContract,
    // appelÃ© en interne par runRentDueReminders) : ce test cible la course
    // sur la RÃ‰CLAMATION du rappel, pas sur la gÃ©nÃ©ration de facture elle-mÃªme
    // â€” un contrat dÃ©marrÃ© ce mois-ci aurait fait tourner la gÃ©nÃ©ration
    // automatique en concurrence dans les deux appels, avec son propre lot de
    // problÃ¨mes hors sujet ici.
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
   * RÃ©gression : sendSingleInvoiceReminder envoyait l'email PUIS marquait
   * reminderSentAt, sans aucune rÃ©clamation prÃ©alable â€” un double-clic du
   * gestionnaire sur "Envoyer un rappel" (ou deux requÃªtes API quasi
   * simultanÃ©es) dÃ©clenchait deux envois pour la mÃªme facture.
   */
  it("deux envois manuels quasi simultanÃ©s sur la mÃªme facture n'envoient qu'un seul rappel", async () => {
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

  it("envoie aussi un message WhatsApp et reporte son statut sous whatsappSimulated dans le rÃ©sultat", async () => {
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

    const whatsappSpy = vi.spyOn(whatsappService, "envoyerMessageWhatsapp");

    const result = await sendSingleInvoiceReminder(invoice.id, manager.id);

    expect(result.success).toBe(true);
    expect(whatsappSpy).toHaveBeenCalledTimes(1);
    expect(whatsappSpy).toHaveBeenCalledWith(
      tenant.phone,
      expect.any(String),
      expect.objectContaining({ "1": expect.stringContaining(tenant.firstName) })
    );
    expect(result.whatsappSimulated).toBe(true);

    whatsappSpy.mockRestore();
  });
});

describe("runUpcomingRentDueReminders", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 1)); // 1er aoÃ»t 2026
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("envoie le rappel 'avant Ã©chÃ©ance' (J-3) pour une facture qui arrive Ã  Ã©chÃ©ance dans 3 jours, puis n'en renvoie aucun au second appel", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, {
      periodMonth: 8,
      periodYear: 2026,
      dueDate: new Date(2026, 7, 4), // dans exactement 3 jours (RENT_DUE_SOON_DAYS par dÃ©faut)
      status: "PENDING",
    });

    const firstRun = await runUpcomingRentDueReminders();
    expect(firstRun.sent).toBe(1);

    const [invoice] = await testDb.select().from(invoices);
    expect(invoice.dueSoonReminderSentAt).not.toBeNull();

    const secondRun = await runUpcomingRentDueReminders();
    expect(secondRun.sent).toBe(0);
  });

  it("ne renvoie aucun rappel pour une facture dont l'Ã©chÃ©ance est trop lointaine", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, {
      periodMonth: 8,
      periodYear: 2026,
      dueDate: new Date(2026, 7, 20), // bien au-delÃ  de la fenÃªtre J-3
      status: "PENDING",
    });

    const result = await runUpcomingRentDueReminders();
    expect(result.sent).toBe(0);
  });

  it("envoie aussi un message WhatsApp 'avant Ã©chÃ©ance' et reporte son statut dans details", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, {
      periodMonth: 8,
      periodYear: 2026,
      dueDate: new Date(2026, 7, 4),
      status: "PENDING",
    });

    const whatsappSpy = vi.spyOn(whatsappService, "envoyerMessageWhatsapp");

    const result = await runUpcomingRentDueReminders();

    expect(result.sent).toBe(1);
    expect(whatsappSpy).toHaveBeenCalledTimes(1);
    expect(whatsappSpy).toHaveBeenCalledWith(
      tenant.phone,
      expect.any(String),
      expect.objectContaining({ "1": expect.stringContaining(tenant.firstName) })
    );
    expect(result.details[0].whatsappSimulated).toBe(true);

    whatsappSpy.mockRestore();
  });

  it("bascule automatiquement en retard (LATE) les factures PENDING dont l'Ã©chÃ©ance est dÃ©jÃ  dÃ©passÃ©e", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    const overdueInvoice = await createInvoice(contract.id, {
      periodMonth: 7,
      periodYear: 2026,
      dueDate: new Date(2026, 6, 20), // Ã©chÃ©ance dÃ©jÃ  passÃ©e (12 jours avant "aujourd'hui")
      status: "PENDING",
    });

    await runUpcomingRentDueReminders();

    const [updated] = await testDb.select().from(invoices).where(eq(invoices.id, overdueInvoice.id));
    expect(updated.status).toBe("LATE");
  });
});