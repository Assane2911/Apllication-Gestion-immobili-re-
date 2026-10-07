import { eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contracts, insurancePolicies, invoices } from "../db/schema";
import {
  createContract,
  createInsurancePolicy,
  createInvoice,
  createManager,
  createProperty,
  createTenant,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { budgetTemps } from "../utils/budgetTemps";
import * as emailService from "./email.service";
import { generateInvoicesForContract, markOverdueInvoices } from "./invoice.service";
import {
  runContractEndingReminders,
  runInsurancePolicyExpiryReminders,
  runRentDueReminders,
  runUpcomingRentDueReminders,
} from "./reminder.service";

/**
 * « En retard » est une accusation portée à un locataire : elle doit être
 * exacte au jour près.
 *
 * Une date d'échéance désigne un JOUR, pas un instant. Le locataire dont le
 * loyer est dû le 15 a jusqu'à la fin du 15 pour payer — c'est d'ailleurs ce
 * que lui annonce l'email de rappel, qui n'affiche qu'une date. Or les deux
 * calculs de statut comparaient un instant (`dueDate` à minuit) à l'heure
 * courante :
 *  - generateInvoicesForContract créait la facture en LATE dès lors que la
 *    génération avait lieu après minuit le jour même de l'échéance — le job
 *    planifié tourne à 8h, donc TOUTE facture dont l'échéance tombe le jour
 *    de sa génération naissait en retard ;
 *  - markOverdueInvoices basculait en LATE, dès 00h01, les factures dues
 *    dans la journée.
 * Dans les deux cas le locataire recevait un avis d'impayé pour une somme
 * qu'il avait encore le droit de régler, et le compteur d'impayés du tableau
 * de bord sur-comptait d'une journée.
 */
describe("Statut d'échéance : le jour de l'échéance n'est pas un retard", () => {
  beforeEach(() => {
    // 15 juin 2026 à 8h00 : l'heure exacte à laquelle tourne le cron Vercel
    // (voir vercel.json, "0 8 * * *"). C'est précisément ce décalage de huit
    // heures après minuit qui révèle le défaut.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 15, 8, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function contratMensuel(jourDEcheance: number) {
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
        startDate: new Date(2026, 2, jourDEcheance),
        endDate: new Date(2027, 2, jourDEcheance - 1),
      })
      .returning();
    return contract;
  }

  it("ne crée pas en retard une facture dont l'échéance tombe le jour même", async () => {
    const contract = await contratMensuel(15);

    await generateInvoicesForContract(contract, testDb);

    const rows = await testDb.select().from(invoices).where(eq(invoices.contractId, contract.id));
    const facturesDeJuin = rows.filter((r: typeof invoices.$inferSelect) => r.periodMonth === 6);
    expect(facturesDeJuin).toHaveLength(1);
    // Échéance le 15 juin, nous sommes le 15 juin : la journée n'est pas finie.
    expect(facturesDeJuin[0].status).toBe("PENDING");
  });

  it("marque toujours en retard une facture dont l'échéance est passée d'un jour", async () => {
    // Contre-épreuve : le correctif ne doit pas offrir un jour de grâce
    // supplémentaire à tout le monde.
    const contract = await contratMensuel(14);

    await generateInvoicesForContract(contract, testDb);

    const rows = await testDb.select().from(invoices).where(eq(invoices.contractId, contract.id));
    const juin = rows.find((r: typeof invoices.$inferSelect) => r.periodMonth === 6);
    expect(juin?.status).toBe("LATE");
  });

  it("ne bascule pas en retard, en cours de journée, une facture due aujourd'hui", async () => {
    const contract = await contratMensuel(15);
    await generateInvoicesForContract(contract, testDb);
    // On force le statut PENDING pour isoler le comportement de
    // markOverdueInvoices du statut posé à la création.
    await testDb.update(invoices).set({ status: "PENDING" }).where(eq(invoices.contractId, contract.id));

    await markOverdueInvoices();

    const rows = await testDb.select().from(invoices).where(eq(invoices.contractId, contract.id));
    const juin = rows.find((r: typeof invoices.$inferSelect) => r.periodMonth === 6);
    expect(juin?.status).toBe("PENDING");
    // Les mois antérieurs, eux, sont bien en retard.
    const mai = rows.find((r: typeof invoices.$inferSelect) => r.periodMonth === 5);
    expect(mai?.status).toBe("LATE");
  });
});

/**
 * Une tâche planifiée finit toujours par ne pas tourner un jour : déploiement
 * en cours, fonction serverless en échec, incident de plateforme. Les deux
 * rappels « à J-n » sélectionnaient leur cible sur une fenêtre d'UN SEUL
 * JOUR — l'échéance devait tomber exactement à J+3, la fin de bail
 * exactement à J+14. Une exécution manquée ne se rattrapait donc jamais : le
 * lendemain, la cible était sortie de la fenêtre et le rappel n'était plus
 * jamais envoyé, alors que le champ d'idempotence restait vide.
 *
 * La fenêtre est désormais un INTERVALLE (d'aujourd'hui à J+n) : la cible y
 * reste plusieurs jours, et le nombre de jours restants annoncé est calculé
 * pour chaque destinataire au lieu d'être la constante de configuration.
 */
describe("Rattrapage des rappels après une exécution manquée", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 10, 8, 0, 0)); // 10 août 2026, 8h
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("envoie le rappel avant échéance à une facture due dans 2 jours, pas seulement à J-3", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, {
      periodMonth: 8,
      periodYear: 2026,
      dueDate: new Date(2026, 7, 12), // J+2 : le job de la veille (J-3) n'a pas tourné
      status: "PENDING",
    });

    const result = await runUpcomingRentDueReminders();

    expect(result.sent).toBe(1);
  });

  it("annonce au locataire le nombre de jours réellement restants, pas la valeur de configuration", async () => {
    const espion = vi.spyOn(emailService, "rentDueSoonReminderEmail");
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, {
      periodMonth: 8,
      periodYear: 2026,
      dueDate: new Date(2026, 7, 11), // demain
      status: "PENDING",
    });

    await runUpcomingRentDueReminders();

    expect(espion).toHaveBeenCalledWith(expect.objectContaining({ daysLeft: 1 }));
  });

  it("n'envoie pas de rappel « avant échéance » pour une facture dont l'échéance est passée", async () => {
    // Contre-épreuve : élargir la fenêtre vers l'avant ne doit pas la faire
    // déborder vers l'arrière et annoncer « il vous reste 3 jours » sur un
    // impayé vieux de deux semaines.
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, {
      periodMonth: 7,
      periodYear: 2026,
      dueDate: new Date(2026, 6, 25),
      status: "LATE",
    });

    const result = await runUpcomingRentDueReminders();

    expect(result.sent).toBe(0);
  });

  it("envoie le rappel de fin de bail à un contrat s'achevant dans 5 jours, pas seulement à J-14", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id, {
      startDate: new Date(2025, 7, 15),
      endDate: new Date(2026, 7, 15), // J+5
      status: "ACTIVE",
    });

    const { sent } = await runContractEndingReminders();

    expect(sent).toBe(1);
  });

  it("n'envoie pas deux fois le rappel de fin de bail pendant la fenêtre élargie", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id, {
      startDate: new Date(2025, 7, 15),
      endDate: new Date(2026, 7, 15),
      status: "ACTIVE",
    });

    expect((await runContractEndingReminders()).sent).toBe(1);
    // Le lendemain, le contrat est toujours dans la fenêtre : c'est
    // reminderSentAt, et lui seul, qui doit empêcher le second envoi.
    vi.setSystemTime(new Date(2026, 7, 11, 8, 0, 0));
    expect((await runContractEndingReminders()).sent).toBe(0);
  });

  it("ignore un bail déjà expiré", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id, {
      startDate: new Date(2024, 7, 1),
      endDate: new Date(2026, 6, 31), // terminé depuis 10 jours
      status: "ACTIVE",
    });

    expect((await runContractEndingReminders()).sent).toBe(0);
  });

  /**
   * Cloisonnement par formule (page tarifs : "Alertes de fin de bail &
   * renouvellement" est un avantage Pro) : contrairement au rappel d'échéance
   * de loyer (email toujours envoyé), il n'existe ici aucune version réduite
   * pour Starter — le rappel ne part tout simplement pas.
   */
  it("n'envoie aucun rappel de fin de bail pour un gestionnaire sous la formule Starter (hors essai)", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "STARTER" });
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id, {
      startDate: new Date(2025, 7, 15),
      endDate: new Date(2026, 7, 15), // J+5
      status: "ACTIVE",
    });

    const envois = vi.spyOn(emailService, "sendEmail");
    const { sent } = await runContractEndingReminders();

    expect(sent).toBe(0);
    expect(envois).not.toHaveBeenCalled();

    const [apres] = await testDb.select().from(contracts).where(eq(contracts.propertyId, property.id));
    // Non marqué : si le gestionnaire passe à Pro avant la fin de la fenêtre
    // glissante, le rappel doit encore pouvoir partir.
    expect(apres.reminderSentAt).toBeNull();
  });
});

/**
 * Le rappel de fin de bail partait vers `env.smtp.user` — l'adresse du compte
 * SMTP qui ENVOIE les messages, c'est-à-dire la boîte de l'exploitant de la
 * plateforme, et non celle du gestionnaire concerné.
 *
 * Sur une plateforme mono-utilisateur, la confusion passait inaperçue. Dès le
 * deuxième gestionnaire, elle a deux conséquences : aucun gestionnaire ne
 * reçoit jamais le rappel de ses propres baux, et l'exploitant les reçoit
 * tous — avec le nom du locataire et l'intitulé du bien à l'intérieur, soit
 * une divulgation de données d'une agence vers un tiers.
 *
 * Le destinataire correct est l'adresse du COMPTE du gestionnaire
 * (users.email) : celle que la plateforme utilise déjà pour tout ce qui
 * concerne son compte, et la seule qui soit vérifiée.
 */
describe("Destinataire du rappel de fin de bail", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 10, 8, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function bailQuiSAcheve(emailDuGestionnaire: string) {
    const manager = await createManager({ email: emailDuGestionnaire });
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id, {
      startDate: new Date(2025, 7, 20),
      endDate: new Date(2026, 7, 20),
      status: "ACTIVE",
    });
    return manager;
  }

  it("écrit au gestionnaire propriétaire du bien, pas à la boîte d'envoi de la plateforme", async () => {
    const envois = vi.spyOn(emailService, "sendEmail");
    await bailQuiSAcheve("agence-nord@test.local");

    const { sent } = await runContractEndingReminders();

    expect(sent).toBe(1);
    const destinataires = envois.mock.calls.map((appel) => appel[0]);
    expect(destinataires).toEqual(["agence-nord@test.local"]);
    // SMTP_USER vaut "test-manager@example.com" (voir setupTestDb.ts) :
    // c'est l'adresse qui recevait le rappel avant correction.
    expect(destinataires).not.toContain(process.env.SMTP_USER);
  });

  it("n'envoie à chaque gestionnaire que le rappel de ses propres baux", async () => {
    const envois = vi.spyOn(emailService, "sendEmail");
    await bailQuiSAcheve("agence-nord@test.local");
    await bailQuiSAcheve("agence-sud@test.local");

    const { sent } = await runContractEndingReminders();

    expect(sent).toBe(2);
    const destinataires = envois.mock.calls.map((appel) => appel[0]).sort();
    expect(destinataires).toEqual(["agence-nord@test.local", "agence-sud@test.local"]);
  });
});

/**
 * Une fonction serverless est tuée net à 300 secondes. Les tâches planifiées
 * parcourent toute la plateforme — générer les factures, puis un email et un
 * message WhatsApp par locataire — et finiront par franchir ce mur à mesure
 * que le nombre de locataires augmente.
 *
 * Être tué est bien pire que s'arrêter : l'exécution est coupée au milieu
 * d'un envoi, une partie des locataires est prévenue, l'autre ne l'est pas,
 * et rien n'en garde trace. Le budget de temps transforme cette coupure
 * subie en arrêt choisi, et la reprise est assurée sans mécanisme nouveau :
 * un élément non traité n'a pas été réclamé, donc l'exécution suivante le
 * retrouve.
 */
describe("Budget de temps des tâches planifiées", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 10, 8, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function deuxBauxQuiSAchevent() {
    for (const suffixe of ["a", "b"]) {
      const manager = await createManager({ email: `agence-${suffixe}@test.local` });
      const property = await createProperty(manager.id);
      const tenant = await createTenant(manager.id);
      await createContract(property.id, tenant.id, {
        startDate: new Date(2025, 7, 20),
        endDate: new Date(2026, 7, 20),
        status: "ACTIVE",
      });
    }
  }

  it("s'arrête sans rien envoyer quand le temps est déjà écoulé, et le signale", async () => {
    const envois = vi.spyOn(emailService, "sendEmail");
    await deuxBauxQuiSAchevent();

    const resultat = await runContractEndingReminders(budgetTemps(0));

    expect(resultat.sent).toBe(0);
    expect(resultat.interrompu).toBe(true);
    expect(envois).not.toHaveBeenCalled();
  });

  it("laisse les contrats non traités reprenables par l'exécution suivante", async () => {
    await deuxBauxQuiSAchevent();

    const interrompue = await runContractEndingReminders(budgetTemps(0));
    expect(interrompue.sent).toBe(0);

    // Aucun contrat n'a été réclamé : rien n'est marqué, donc tout est repris.
    const restants = await testDb.select().from(contracts).where(isNull(contracts.reminderSentAt));
    expect(restants).toHaveLength(2);

    const reprise = await runContractEndingReminders();
    expect(reprise.sent).toBe(2);
    expect(reprise.interrompu).toBe(false);
  });

  it("n'interrompt rien quand aucun budget n'est imposé", async () => {
    await deuxBauxQuiSAchevent();

    const resultat = await runContractEndingReminders();

    expect(resultat.sent).toBe(2);
    expect(resultat.interrompu).toBe(false);
  });

  it("interrompt aussi l'avis d'échéance du mois, en laissant les factures non réclamées", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id, {
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2027, 7, 1),
    });

    const interrompue = await runRentDueReminders(undefined, budgetTemps(0));
    expect(interrompue.sent).toBe(0);
    expect(interrompue.interrompu).toBe(true);

    const reprise = await runRentDueReminders();
    expect(reprise.sent).toBe(1);
    expect(reprise.interrompu).toBe(false);
  });
});

/**
 * Même principe de fenêtre glissante et de réclamation atomique que les
 * rappels de fin de bail ci-dessus, appliqué aux polices d'assurance
 * (INSURANCE_REMINDER_DAYS = 30 jours par défaut, voir config/env.ts).
 */
describe("runInsurancePolicyExpiryReminders", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 10, 8, 0, 0)); // 10 août 2026, 8h
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("envoie le rappel pour une police expirant dans 10 jours (fenêtre à 30 jours)", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    await createInsurancePolicy(property.id, { expiryDate: new Date(2026, 7, 20) });

    const result = await runInsurancePolicyExpiryReminders();

    expect(result.sent).toBe(1);
  });

  it("envoie le rappel pour une police expirant dans 29 jours, pas seulement à J-30", async () => {
    // Même rattrapage qu'un rappel manqué la veille : la fenêtre glissante
    // couvre tout l'intervalle [aujourd'hui, J+30], pas le seul jour J+30.
    const manager = await createManager();
    const property = await createProperty(manager.id);
    await createInsurancePolicy(property.id, { expiryDate: new Date(2026, 8, 8) });

    const result = await runInsurancePolicyExpiryReminders();

    expect(result.sent).toBe(1);
  });

  it("n'envoie aucun rappel pour une police dont l'échéance est hors fenêtre (dans 60 jours)", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    await createInsurancePolicy(property.id, { expiryDate: new Date(2026, 9, 9) });

    const result = await runInsurancePolicyExpiryReminders();

    expect(result.sent).toBe(0);
  });

  it("n'envoie aucun rappel pour une police déjà expirée", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    await createInsurancePolicy(property.id, { expiryDate: new Date(2026, 6, 1) });

    const result = await runInsurancePolicyExpiryReminders();

    expect(result.sent).toBe(0);
  });

  it("n'envoie pas deux fois le rappel pour la même police", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    await createInsurancePolicy(property.id, { expiryDate: new Date(2026, 7, 20) });

    expect((await runInsurancePolicyExpiryReminders()).sent).toBe(1);
    expect((await runInsurancePolicyExpiryReminders()).sent).toBe(0);
  });

  it("écrit au gestionnaire propriétaire du bien, à l'adresse de son compte", async () => {
    const envois = vi.spyOn(emailService, "sendEmail");
    const manager = await createManager({ email: "agence-nord@test.local" });
    const property = await createProperty(manager.id);
    await createInsurancePolicy(property.id, { expiryDate: new Date(2026, 7, 20) });

    const { sent } = await runInsurancePolicyExpiryReminders();

    expect(sent).toBe(1);
    expect(envois.mock.calls.map((appel) => appel[0])).toEqual(["agence-nord@test.local"]);
  });

  it("libère le marqueur quand l'envoi échoue, pour que le rappel reparte au prochain passage", async () => {
    const email = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false, error: true });
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const policy = await createInsurancePolicy(property.id, { expiryDate: new Date(2026, 7, 20) });

    const result = await runInsurancePolicyExpiryReminders();

    expect(result.sent).toBe(0);
    expect(result.echecs).toBe(1);
    const [enBase] = await testDb.select().from(insurancePolicies).where(eq(insurancePolicies.id, policy.id));
    expect(enBase.reminderSentAt).toBeNull();

    email.mockRestore();
  });

  it("laisse les polices non traitées reprenables par l'exécution suivante (budget de temps)", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    await createInsurancePolicy(property.id, { expiryDate: new Date(2026, 7, 20) });

    const interrompue = await runInsurancePolicyExpiryReminders(budgetTemps(0));
    expect(interrompue.sent).toBe(0);
    expect(interrompue.interrompu).toBe(true);

    const restantes = await testDb.select().from(insurancePolicies).where(isNull(insurancePolicies.reminderSentAt));
    expect(restantes).toHaveLength(1);

    const reprise = await runInsurancePolicyExpiryReminders();
    expect(reprise.sent).toBe(1);
    expect(reprise.interrompu).toBe(false);
  });
});
