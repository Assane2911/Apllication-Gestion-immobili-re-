import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contracts, insurancePolicies, invoices, users } from "../db/schema";
import {
  createContract,
  createInsurancePolicy,
  createInvoice,
  createManager,
  createProperty,
  createTenant,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import * as emailService from "./email.service";
import {
  runContractEndingReminders,
  runInsurancePolicyExpiryReminders,
  runRentDueReminders,
  runUpcomingRentDueReminders,
} from "./reminder.service";

/**
 * Une agence suspendue par l'administration n'émet ni ne reçoit plus aucun
 * rappel automatique. L'élément écarté doit rester « non envoyé » (marqueur
 * vide) pour que le rappel parte à la réactivation.
 */
async function suspendre(managerId: string) {
  await testDb.update(users).set({ suspendedAt: new Date(), suspensionReason: "Impayé" }).where(eq(users.id, managerId));
}

async function reactiver(managerId: string) {
  await testDb.update(users).set({ suspendedAt: null, suspensionReason: null }).where(eq(users.id, managerId));
}

describe("rappels automatiques et suspension d'agence", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 1, 8, 0, 0)); // 1er août 2026, 8h
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fin de bail : rien n'est envoyé ni marqué tant que l'agence est suspendue, puis le rappel part à la réactivation", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contrat = await createContract(property.id, tenant.id, {
      startDate: new Date(2026, 0, 1),
      endDate: new Date(2026, 7, 10), // dans 9 jours, dans la fenêtre de 14 jours
    });
    await suspendre(manager.id);
    const envoi = vi.spyOn(emailService, "sendEmail");

    const suspendue = await runContractEndingReminders();

    expect(suspendue.sent).toBe(0);
    expect(envoi).not.toHaveBeenCalled();
    const [apres] = await testDb.select().from(contracts).where(eq(contracts.id, contrat.id));
    expect(apres.reminderSentAt).toBeNull();

    await reactiver(manager.id);
    expect((await runContractEndingReminders()).sent).toBe(1);
  });

  it("assurance : rien n'est envoyé ni marqué tant que l'agence est suspendue, puis le rappel part à la réactivation", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const police = await createInsurancePolicy(property.id, { expiryDate: new Date(2026, 7, 20) });
    await suspendre(manager.id);
    const envoi = vi.spyOn(emailService, "sendEmail");

    const suspendue = await runInsurancePolicyExpiryReminders();

    expect(suspendue.sent).toBe(0);
    expect(envoi).not.toHaveBeenCalled();
    const [apres] = await testDb.select().from(insurancePolicies).where(eq(insurancePolicies.id, police.id));
    expect(apres.reminderSentAt).toBeNull();

    await reactiver(manager.id);
    expect((await runInsurancePolicyExpiryReminders()).sent).toBe(1);
  });

  it("avis d'échéance : les factures sont toujours générées, mais aucun avis n'est envoyé ; il part à la réactivation", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id, { startDate: new Date(2026, 7, 1), endDate: new Date(2027, 7, 1) });
    await suspendre(manager.id);
    const envoi = vi.spyOn(emailService, "sendEmail");

    const suspendue = await runRentDueReminders();

    expect(suspendue.sent).toBe(0);
    expect(envoi).not.toHaveBeenCalled();
    // La comptabilité continue : la facture du mois existe, simplement non annoncée.
    const factures = await testDb.select().from(invoices);
    expect(factures).toHaveLength(1);
    expect(factures[0].reminderSentAt).toBeNull();

    await reactiver(manager.id);
    expect((await runRentDueReminders()).sent).toBe(1);
    expect(await testDb.select().from(invoices)).toHaveLength(1); // pas de doublon de facture
  });

  it("rappel avant échéance : rien n'est envoyé ni marqué tant que l'agence est suspendue, puis il part à la réactivation", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contrat = await createContract(property.id, tenant.id);
    const facture = await createInvoice(contrat.id, {
      periodMonth: 8,
      periodYear: 2026,
      dueDate: new Date(2026, 7, 4),
      status: "PENDING",
    });
    await suspendre(manager.id);
    const envoi = vi.spyOn(emailService, "sendEmail");

    const suspendue = await runUpcomingRentDueReminders();

    expect(suspendue.sent).toBe(0);
    expect(envoi).not.toHaveBeenCalled();
    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, facture.id));
    expect(apres.dueSoonReminderSentAt).toBeNull();

    await reactiver(manager.id);
    expect((await runUpcomingRentDueReminders()).sent).toBe(1);
  });

  it("n'écarte QUE l'agence suspendue : une autre agence reçoit ses rappels dans la même exécution", async () => {
    const suspendu = await createManager();
    const actif = await createManager();
    for (const m of [suspendu, actif]) {
      const property = await createProperty(m.id);
      await createInsurancePolicy(property.id, { expiryDate: new Date(2026, 7, 20) });
    }
    await suspendre(suspendu.id);

    const resultat = await runInsurancePolicyExpiryReminders();

    expect(resultat.sent).toBe(1);
    const lignes = await testDb.select().from(insurancePolicies);
    const marquees = lignes.filter((l: { reminderSentAt: Date | null }) => l.reminderSentAt !== null);
    expect(marquees).toHaveLength(1);
  });
});
