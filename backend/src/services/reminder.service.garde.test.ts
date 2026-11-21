import cron from "node-cron";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import { activityLogs, contractCotenants, contracts, insurancePolicies, invoices } from "../db/schema";
import { createContract, createInsurancePolicy, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { budgetTemps } from "../utils/budgetTemps";
import * as emailService from "./email.service";
import * as rentRevisionService from "./rentRevision.service";
import * as whatsappService from "./whatsapp.service";
import {
  runContractEndingReminders,
  runInsurancePolicyExpiryReminders,
  runRentDueReminders,
  runUpcomingRentDueReminders,
  scheduleContractEndingReminders,
  sendSingleInvoiceReminder,
} from "./reminder.service";

/**
 * Les chemins d'échec de `reminder.service` que ses autres tests n'exerçaient pas : un e-mail qui ne part pas, un
 * WhatsApp qui échoue alors que l'e-mail est parti, une copie à un colocataire non délivrée, un budget de temps épuisé,
 * deux exécutions simultanées, la planification des tâches. Ce sont des cas où le code répond « tout va bien » : sans ces
 * tests, un marqueur non relâché ou un échec tu passerait inaperçu.
 */

const TELEPHONE_COLOCATAIRE = "+221770000002";

async function ajouterColocataire(managerId: string, contractId: string) {
  const colocataire = await createTenant(managerId, { phone: TELEPHONE_COLOCATAIRE, email: "colocataire@test.local" });
  await testDb.insert(contractCotenants).values({ contractId, tenantId: colocataire.id });
  return colocataire;
}

/** Une facture « avant échéance » (J+3) pour un locataire joignable, un colocataire en option. */
async function factureAvantEcheance(options: { colocataire?: boolean } = {}) {
  const manager = await createManager();
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id, { phone: "+221770000001" });
  const contract = await createContract(property.id, tenant.id);
  if (options.colocataire) await ajouterColocataire(manager.id, contract.id);
  const invoice = await createInvoice(contract.id, {
    periodMonth: 8,
    periodYear: 2026,
    dueDate: new Date(2026, 7, 13),
    status: "PENDING",
  });
  return { manager, tenant, contract, invoice };
}

async function journalWhatsapp(managerId: string) {
  const lignes = await testDb.select().from(activityLogs).where(eq(activityLogs.managerId, managerId));
  return lignes.filter((l: typeof activityLogs.$inferSelect) => l.action === "reminder.whatsapp_failed");
}

describe("Rappel de fin de bail : un e-mail non parti", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 10, 8, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("relâche le marqueur et compte un échec, puis le rappel repart au passage suivant", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contrat = await createContract(property.id, tenant.id, {
      startDate: new Date(2025, 7, 15),
      endDate: new Date(2026, 7, 15),
      status: "ACTIVE",
    });
    const email = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false, error: true });

    const premier = await runContractEndingReminders();

    expect(premier.sent).toBe(0);
    expect(premier.echecs).toBe(1);
    const [apres] = await testDb.select().from(contracts).where(eq(contracts.id, contrat.id));
    expect(apres.reminderSentAt).toBeNull(); // sinon le bail serait perdu : le filtre l'exclurait dès le lendemain

    email.mockResolvedValue({ simulated: false });
    const second = await runContractEndingReminders();
    expect(second.sent).toBe(1);
    expect(second.echecs).toBe(0);
  });
});

describe("Rappel « avant échéance » : WhatsApp, colocataires, budget et concurrence", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 10, 8, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("signale un vrai échec WhatsApp quand l'e-mail est bien parti : compté, détaillé et journalisé", async () => {
    const { manager } = await factureAvantEcheance();
    vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false });
    vi.spyOn(whatsappService, "envoyerMessageWhatsapp").mockResolvedValue({ simulated: false, error: true, raison: "numero_invalide" });

    const resultat = await runUpcomingRentDueReminders();

    expect(resultat.sent).toBe(1);
    expect(resultat.echecs).toBe(0);
    expect(resultat.whatsappEchecs).toBe(1);
    const journal = await journalWhatsapp(manager.id);
    expect(journal).toHaveLength(1);
    expect(journal[0].details).toContain("numero_invalide");
  });

  it("compte la copie WhatsApp non délivrée à un colocataire, sans empêcher l'envoi au titulaire", async () => {
    const { manager } = await factureAvantEcheance({ colocataire: true });
    vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false });
    vi.spyOn(whatsappService, "envoyerMessageWhatsapp").mockImplementation(async (telephone) =>
      telephone === TELEPHONE_COLOCATAIRE ? { simulated: false, error: true, raison: "numero_invalide" } : { simulated: false }
    );

    const resultat = await runUpcomingRentDueReminders();

    expect(resultat.sent).toBe(1);
    expect(resultat.whatsappEchecs).toBe(1);
    const journal = await journalWhatsapp(manager.id);
    expect(journal).toHaveLength(1);
    expect(journal[0].details).toContain("numero_invalide");
  });

  it("s'arrête quand le budget de temps est épuisé, signale l'interruption et laisse les factures reprenables", async () => {
    const { invoice } = await factureAvantEcheance();
    const envois = vi.spyOn(emailService, "sendEmail");
    const avertissement = vi.spyOn(console, "warn").mockImplementation(() => {});

    const interrompue = await runUpcomingRentDueReminders(budgetTemps(0));

    expect(interrompue.sent).toBe(0);
    expect(interrompue.interrompu).toBe(true);
    expect(envois).not.toHaveBeenCalled();
    expect(avertissement.mock.calls.flat().join(" ")).toContain("Budget de temps épuisé");
    const [intacte] = await testDb.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(intacte.dueSoonReminderSentAt).toBeNull();

    const reprise = await runUpcomingRentDueReminders();
    expect(reprise.sent).toBe(1);
  });

  it("deux exécutions simultanées n'envoient qu'un seul rappel pour la même facture", async () => {
    await factureAvantEcheance();

    const [a, b] = await Promise.all([runUpcomingRentDueReminders(), runUpcomingRentDueReminders()]);

    expect(a.sent + b.sent).toBe(1);
  });
});

describe("Deux exécutions simultanées : un seul envoi par bail et par police", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 10, 8, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("rappel de fin de bail", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id, { startDate: new Date(2025, 7, 15), endDate: new Date(2026, 7, 15), status: "ACTIVE" });

    const [a, b] = await Promise.all([runContractEndingReminders(), runContractEndingReminders()]);

    expect(a.sent + b.sent).toBe(1);
  });

  it("rappel d'échéance d'assurance", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const police = await createInsurancePolicy(property.id, { expiryDate: new Date(2026, 7, 20) });

    const [a, b] = await Promise.all([runInsurancePolicyExpiryReminders(), runInsurancePolicyExpiryReminders()]);

    expect(a.sent + b.sent).toBe(1);
    const [enBase] = await testDb.select().from(insurancePolicies).where(eq(insurancePolicies.id, police.id));
    expect(enBase.reminderSentAt).not.toBeNull();
  });
});

describe("Avis d'échéance du mois : échec de l'application des révisions de loyer", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 1));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("n'empêche pas l'envoi des avis : l'erreur est journalisée, le reste continue", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id, { startDate: new Date(2026, 7, 1), endDate: new Date(2027, 7, 1) });
    vi.spyOn(rentRevisionService, "appliquerRevisionsDues").mockRejectedValue(new Error("Panne simulée"));
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});

    const resultat = await runRentDueReminders();

    expect(resultat.sent).toBe(1);
    expect(erreur.mock.calls.flat().join(" ")).toContain("Échec de l'application des révisions de loyer");
  });

  it("compte et journalise la copie WhatsApp non délivrée à un colocataire, sans empêcher l'avis du titulaire", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id, { phone: "+221770000001" });
    const contrat = await createContract(property.id, tenant.id, { startDate: new Date(2026, 7, 1), endDate: new Date(2027, 7, 1) });
    await ajouterColocataire(manager.id, contrat.id);
    vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false });
    vi.spyOn(whatsappService, "envoyerMessageWhatsapp").mockImplementation(async (telephone) =>
      telephone === TELEPHONE_COLOCATAIRE ? { simulated: false, error: true, raison: "numero_invalide" } : { simulated: false }
    );

    const resultat = await runRentDueReminders();

    expect(resultat.sent).toBe(1);
    expect(resultat.whatsappEchecs).toBe(1);
    const journal = await journalWhatsapp(manager.id);
    expect(journal).toHaveLength(1);
    expect(journal[0].details).toContain("numero_invalide");
  });
});

describe("Rappel manuel d'une facture : WhatsApp non délivré", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 1));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function factureDuMois(options: { colocataire?: boolean } = {}) {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id, { phone: "+221770000001" });
    const contract = await createContract(property.id, tenant.id);
    if (options.colocataire) await ajouterColocataire(manager.id, contract.id);
    const invoice = await createInvoice(contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING", dueDate: new Date(2026, 7, 20) });
    return { manager, invoice };
  }

  it("signale au gestionnaire (whatsappError) et journalise un échec WhatsApp quand l'e-mail est bien parti", async () => {
    const { manager, invoice } = await factureDuMois();
    vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false });
    vi.spyOn(whatsappService, "envoyerMessageWhatsapp").mockResolvedValue({ simulated: false, error: true, raison: "erreur_api" });

    const resultat = await sendSingleInvoiceReminder(invoice.id, manager.id);

    expect(resultat.success).toBe(true); // l'e-mail, lui, est parti
    expect(resultat.whatsappError).toBe(true);
    const journal = await journalWhatsapp(manager.id);
    expect(journal).toHaveLength(1);
    expect(journal[0].details).toContain("Le rappel WhatsApp n'a pas été délivré");
  });

  it("journalise aussi les copies WhatsApp non délivrées aux colocataires", async () => {
    const { manager, invoice } = await factureDuMois({ colocataire: true });
    vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false });
    vi.spyOn(whatsappService, "envoyerMessageWhatsapp").mockImplementation(async (telephone) =>
      telephone === TELEPHONE_COLOCATAIRE ? { simulated: false, error: true, raison: "numero_invalide" } : { simulated: false }
    );

    const resultat = await sendSingleInvoiceReminder(invoice.id, manager.id);

    expect(resultat.whatsappError).toBe(false); // le titulaire, lui, a bien reçu le sien
    const journal = await journalWhatsapp(manager.id);
    expect(journal).toHaveLength(1);
    expect(journal[0].details).toContain("copie(s) WhatsApp aux colocataires non délivrée(s)");
    expect(journal[0].details).toContain("numero_invalide");
  });
});

describe("scheduleContractEndingReminders : les six tâches planifiées", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("planifie les six tâches aux bonnes heures, chacune avec une fonction qui ne laisse jamais une erreur remonter", async () => {
    const planifiees: Array<{ expression: string; tache: () => void }> = [];
    vi.spyOn(cron, "schedule").mockImplementation(((expression: string, tache: () => void) => {
      planifiees.push({ expression, tache });
      return { stop() {}, start() {} };
    }) as unknown as typeof cron.schedule);
    vi.spyOn(console, "log").mockImplementation(() => {});

    scheduleContractEndingReminders();

    expect(planifiees.map((p) => p.expression)).toEqual([
      env.reminder.cron, // fin de bail
      "0 8 * * *", // factures du mois et avis d'échéance
      "0 9 * * *", // rappel « avant échéance »
      "30 8 * * *", // assurances
      "35 8 * * *", // documents
      "40 8 * * *", // fin d'essai et fin d'abonnement
    ]);

    // Chaque tâche s'exécute sur une base vide sans lever d'erreur ni de rejet non traité.
    const erreurs = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const { tache } of planifiees) tache();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(erreurs).not.toHaveBeenCalled();
  });
});
