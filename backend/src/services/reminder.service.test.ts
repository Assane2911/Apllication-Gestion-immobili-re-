import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activityLogs, invoices } from "../db/schema";
import * as emailService from "./email.service";
import * as whatsappService from "./whatsapp.service";
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

  // Le WhatsApp s'ajoute à l'email (voir whatsapp.service.ts) : ce test vérifie
  // qu'il est bien invoqué avec le numéro et un message cohérents, et que son
  // résultat (simulated) remonte dans `details` sous `whatsappSimulated`.
  it("envoie aussi un message WhatsApp en complément de l'email et reporte son statut dans details", async () => {
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
    // API Meta WhatsApp non configurée dans l'environnement de test => simulation, comme sendEmail sans SMTP.
    expect(result.details[0].whatsappSimulated).toBe(true);

    whatsappSpy.mockRestore();
  });

  // Résilience : un échec du canal WhatsApp (numéro invalide, panne API Meta...)
  // ne doit ni interrompre la boucle ni empêcher l'email — déjà envoyé
  // séparément — d'être comptabilisé.
  it("continue d'envoyer l'email et de compter le rappel même si l'envoi WhatsApp échoue", async () => {
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
   * Régression : `aEteJoint` ne compte un rappel en échec que si l'email
   * l'est AUSSI (un seul canal suffit). Un vrai échec WhatsApp alors que
   * l'email est bien parti passait donc entièrement sous silence — ni
   * `echecs`, ni `whatsappSimulated` (qui vaut `false` aussi bien pour "vrai
   * échec" que pour "vraiment envoyé") ne le distinguait. Le gestionnaire
   * lisait "N avis envoyés avec succès" sans savoir qu'une partie de ses
   * locataires n'avait rien reçu sur WhatsApp.
   */
  it("signale un vrai échec WhatsApp (whatsappEchecs, details.whatsappError) même quand l'email a réussi, et le journalise", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id, {
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2027, 7, 1),
    });

    const whatsappSpy = vi
      .spyOn(whatsappService, "envoyerMessageWhatsapp")
      .mockResolvedValue({ simulated: false, error: true, raison: "numero_invalide" });

    const result = await runRentDueReminders();

    expect(result.sent).toBe(1);
    expect(result.echecs).toBe(0);
    expect(result.whatsappEchecs).toBe(1);
    expect(result.details[0].whatsappError).toBe(true);

    const [logEntry] = await testDb
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.managerId, manager.id));
    expect(logEntry).toBeDefined();
    expect(logEntry.action).toBe("reminder.whatsapp_failed");

    whatsappSpy.mockRestore();
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

  /**
   * Régression : pour éviter une requête par contrat (N+1) quand elle génère
   * les factures du mois, runRentDueReminders précharge en une seule requête
   * les factures existantes des biens qui n'ont, dans le lot traité, qu'UN
   * SEUL contrat actif — et laisse volontairement les autres (plusieurs
   * contrats actifs sur le même bien, cas d'un renouvellement créé sans
   * clôturer l'ancien) faire leur propre requête fraîche par contrat. Ce
   * test couvre justement ce second cas : deux contrats ACTIFS et non
   * chevauchants sur le même bien doivent continuer à se partager le mois de
   * transition au prorata, sans double facturation, exactement comme avant
   * ce correctif de performance.
   */
  it("un bien avec deux contrats ACTIFS non chevauchants ne facture pas deux fois le mois de transition", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenantA = await createTenant(manager.id, { firstName: "Ancien" });
    const tenantB = await createTenant(manager.id, { firstName: "Nouveau" });

    const ancienContrat = await createContract(property.id, tenantA.id, {
      rent: 500,
      startDate: new Date(2026, 0, 1),
      endDate: new Date(2026, 7, 15), // se termine le 15 août
    });
    const nouveauContrat = await createContract(property.id, tenantB.id, {
      rent: 550,
      startDate: new Date(2026, 7, 16), // démarre le lendemain, toujours ACTIVE (pas de renewContract ici)
      endDate: new Date(2027, 7, 15),
    });

    await runRentDueReminders();

    const facturesAncien = await testDb.select().from(invoices).where(eq(invoices.contractId, ancienContrat.id));
    const facturesNouveau = await testDb.select().from(invoices).where(eq(invoices.contractId, nouveauContrat.id));

    const aoutAncien = facturesAncien.find(
      (f: typeof invoices.$inferSelect) => f.periodMonth === 8 && f.periodYear === 2026
    );
    const aoutNouveau = facturesNouveau.find(
      (f: typeof invoices.$inferSelect) => f.periodMonth === 8 && f.periodYear === 2026
    );

    expect(aoutAncien).toBeDefined();
    expect(aoutNouveau).toBeDefined();
    // Chacun facture ses propres jours (15 sur 31 pour l'ancien, 16 sur 31
    // pour le nouveau) : ni mois plein en double, ni mois manquant.
    expect(aoutAncien!.amount).toBeLessThan(500);
    expect(aoutNouveau!.amount).toBeLessThan(550);
    expect(aoutAncien!.amount / 500 + aoutNouveau!.amount / 550).toBeCloseTo(1, 3);
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

  it("envoie aussi un message WhatsApp et reporte son statut sous whatsappSimulated dans le résultat", async () => {
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

  it("envoie aussi un message WhatsApp 'avant échéance' et reporte son statut dans details", async () => {
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

  /**
   * Régression : contrairement à runRentDueReminders, cette fonction ne
   * vérifiait jamais `aEteJoint` avant ce correctif — `sent += 1` était
   * inconditionnel et `dueSoonReminderSentAt` restait posé même quand RIEN
   * n'était parti. Une panne SMTP pendant le cron privait alors
   * définitivement le locataire de son rappel "avant échéance" (le filtre
   * `isNull(dueSoonReminderSentAt)` l'excluait dès le lendemain), tout en
   * laissant croire que l'envoi avait réussi.
   */
  it("relâche le marqueur et ne compte rien comme envoyé quand ni l'email ni WhatsApp ne sont partis, puis retente avec succès", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id, { phone: "+221778422993" });
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, {
      periodMonth: 8,
      periodYear: 2026,
      dueDate: new Date(2026, 7, 4),
      status: "PENDING",
    });

    const email = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false, error: true });
    const whatsapp = vi
      .spyOn(whatsappService, "envoyerMessageWhatsapp")
      .mockResolvedValue({ simulated: false, error: true, raison: "erreur_api" });

    const premier = await runUpcomingRentDueReminders();
    expect(premier.sent).toBe(0);
    expect(premier.echecs).toBe(1);
    const [apres] = await testDb.select().from(invoices);
    expect(apres.dueSoonReminderSentAt).toBeNull();

    // Le lendemain, une fois les canaux rétablis, le rappel part pour de bon.
    email.mockResolvedValue({ simulated: false });
    whatsapp.mockResolvedValue({ simulated: false });
    const second = await runUpcomingRentDueReminders();
    expect(second.sent).toBe(1);

    email.mockRestore();
    whatsapp.mockRestore();
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

describe("Un rappel qui n'est pas parti ne doit pas être compté comme envoyé", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 1));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Le marqueur `reminderSentAt` est posé AVANT l'envoi pour empêcher le
   * doublon. Mais `sendEmail` ne lève jamais : il journalise et renvoie
   * `{ error: true }`. Sans relâcher le marqueur, une panne SMTP de quelques
   * minutes pendant le cron marque toutes les factures du jour comme
   * relancées sans qu'un seul message ne parte, et le filtre
   * `isNull(reminderSentAt)` les exclut définitivement le lendemain. Le
   * locataire n'apprend jamais que son loyer est dû, et le journal annonce
   * « 40 avis envoyés ».
   */
  async function facture() {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id, { phone: "+221778422993" });
    const contract = await createContract(property.id, tenant.id, {
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2027, 6, 31),
    });
    return { manager, contract };
  }

  it("relâche le marqueur quand ni l'email ni WhatsApp ne sont partis", async () => {
    const { manager } = await facture();
    const email = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false, error: true });
    const whatsapp = vi
      .spyOn(whatsappService, "envoyerMessageWhatsapp")
      .mockResolvedValue({ simulated: false, error: true, raison: "erreur_api" });

    const premier = await runRentDueReminders(manager.id);

    expect(premier.sent).toBe(0);
    const [apres] = await testDb.select().from(invoices);
    expect(apres.reminderSentAt).toBeNull();

    // Et surtout : le lendemain, l'avis part pour de bon.
    email.mockResolvedValue({ simulated: false });
    whatsapp.mockResolvedValue({ simulated: false });
    const second = await runRentDueReminders(manager.id);
    expect(second.sent).toBe(1);

    email.mockRestore();
    whatsapp.mockRestore();
  });

  it("garde le marqueur si WhatsApp a livré, même quand l'email a échoué", async () => {
    // Contre-épreuve : relâcher ici renverrait le lendemain un WhatsApp que
    // le locataire a déjà reçu. Il a été joint, c'est ce qui compte.
    const { manager } = await facture();
    const email = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false, error: true });
    const whatsapp = vi.spyOn(whatsappService, "envoyerMessageWhatsapp").mockResolvedValue({ simulated: false });

    const resultat = await runRentDueReminders(manager.id);

    expect(resultat.sent).toBe(1);
    const [apres] = await testDb.select().from(invoices);
    expect(apres.reminderSentAt).not.toBeNull();

    email.mockRestore();
    whatsapp.mockRestore();
  });

  it("compte les échecs et les annonce, au lieu de les taire", async () => {
    const { manager } = await facture();
    const email = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false, error: true });
    const whatsapp = vi
      .spyOn(whatsappService, "envoyerMessageWhatsapp")
      .mockResolvedValue({ simulated: false, error: true, raison: "erreur_api" });

    const resultat = await runRentDueReminders(manager.id);

    expect(resultat.echecs).toBe(1);

    email.mockRestore();
    whatsapp.mockRestore();
  });

  it("n'affirme pas qu'un rappel manuel est parti quand il a échoué", async () => {
    const { manager, contract } = await facture();
    const inv = await createInvoice(contract.id, { status: "PENDING" });
    const email = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false, error: true });
    const whatsapp = vi
      .spyOn(whatsappService, "envoyerMessageWhatsapp")
      .mockResolvedValue({ simulated: false, error: true, raison: "erreur_api" });

    const resultat = await sendSingleInvoiceReminder(inv.id, manager.id);

    expect(resultat.success).toBe(false);
    const [apres] = await testDb.select().from(invoices);
    expect(apres.reminderSentAt).toBeNull();

    email.mockRestore();
    whatsapp.mockRestore();
  });
});
