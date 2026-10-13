import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import { activityLogs, agencySettings, contractCotenants, invoices, tenants } from "../db/schema";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import * as emailService from "./email.service";
import { runOverdueReminders } from "./relances.service";
import { runRentDueReminders, runUpcomingRentDueReminders, sendSingleInvoiceReminder } from "./reminder.service";

/**
 * WhatsApp en colocation : chaque colocataire reçoit, sur son propre numéro, le même message que le
 * titulaire (avis d'échéance, rappel avant échéance, relance d'impayé). La relance d'impayé passe
 * désormais aussi par WhatsApp, avec son propre modèle Meta, et reste un avantage de la formule Pro.
 *
 * Les tests vont jusqu'à l'appel réseau (fetch simulé) : on lit ce qui partirait réellement chez Meta.
 */
const original = { ...env.whatsapp };
let fetchMock: ReturnType<typeof vi.fn>;
let email: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 12, 9));
  email = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  env.whatsapp.accessToken = "un_token_permanent_meta";
  env.whatsapp.phoneNumberId = "123456789012345";
  env.whatsapp.templateLanguage = "fr";
  env.whatsapp.templateNameRentDueDated = "avis_echeance_loyer_date";
  env.whatsapp.templateNameRentDueSoon = "rappel_avant_echeance_loyer";
  env.whatsapp.templateNameOverdue = "relance_impaye";
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  Object.assign(env.whatsapp, original);
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Envoi = { to: string; modele: string; nom: string };
const envois = (): Envoi[] =>
  fetchMock.mock.calls.map((c: unknown[]) => {
    const corps = JSON.parse((c[1] as { body: string }).body);
    return { to: corps.to, modele: corps.template.name, nom: corps.template.components[0].parameters[0].text };
  });
const TITULAIRE = "221770000001";
const COLOCATAIRE = "221770000002";

async function colocation(plan: "ENTERPRISE" | "STARTER" = "ENTERPRISE") {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: plan });
  const property = await createProperty(manager.id, { title: "Appartement T3" });
  const titulaire = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow", email: "awa@example.com", phone: "+221770000001" });
  const coloc = await createTenant(manager.id, { firstName: "Binta", lastName: "Kane", email: "binta@example.com", phone: "+221770000002" });
  const contract = await createContract(property.id, titulaire.id, {
    status: "ACTIVE",
    startDate: new Date(2026, 0, 1),
    endDate: new Date(2027, 11, 31),
  });
  await testDb.insert(contractCotenants).values({ contractId: contract.id, tenantId: coloc.id });
  return { manager, titulaire, coloc, contract };
}

describe("avis d'échéance et rappel avant échéance", () => {
  it("l'avis d'échéance du mois part sur WhatsApp au titulaire et au colocataire, chacun à son nom", async () => {
    const { manager, contract } = await colocation();
    await createInvoice(contract.id, { periodMonth: 10, periodYear: 2026, amount: 600, status: "PENDING", dueDate: new Date(2026, 9, 20) });

    await runRentDueReminders(manager.id);

    expect(envois().sort((a, b) => a.to.localeCompare(b.to))).toEqual([
      { to: TITULAIRE, modele: "avis_echeance_loyer_date", nom: "Awa Sow" },
      { to: COLOCATAIRE, modele: "avis_echeance_loyer_date", nom: "Binta Kane" },
    ]);
  });

  it("le rappel avant échéance part aussi au colocataire, avec son modèle", async () => {
    const { contract } = await colocation();
    await createInvoice(contract.id, { periodMonth: 10, periodYear: 2026, amount: 600, status: "PENDING", dueDate: new Date(2026, 9, 15) });

    const resultat = await runUpcomingRentDueReminders();

    expect(resultat.sent).toBe(1);
    expect(envois().map((e) => [e.to, e.modele]).sort()).toEqual([
      [TITULAIRE, "rappel_avant_echeance_loyer"],
      [COLOCATAIRE, "rappel_avant_echeance_loyer"],
    ]);
  });

  it("le rappel manuel part aussi au colocataire", async () => {
    const { manager, contract } = await colocation();
    const facture = await createInvoice(contract.id, { periodMonth: 10, periodYear: 2026, amount: 600, status: "PENDING", dueDate: new Date(2026, 9, 20) });

    await sendSingleInvoiceReminder(facture.id, manager.id);

    expect(envois().map((e) => e.to).sort()).toEqual([TITULAIRE, COLOCATAIRE]);
  });

  it("formule Starter : aucun WhatsApp, ni au titulaire ni au colocataire (l'email part)", async () => {
    const { manager, contract } = await colocation("STARTER");
    await createInvoice(contract.id, { periodMonth: 10, periodYear: 2026, amount: 600, status: "PENDING", dueDate: new Date(2026, 9, 20) });

    await runRentDueReminders(manager.id);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(email.mock.calls.map((c: unknown[]) => c[0]).sort()).toEqual(["awa@example.com", "binta@example.com"]);
  });

  it("un colocataire anonymisé ne reçoit rien", async () => {
    const { manager, contract, coloc } = await colocation();
    await createInvoice(contract.id, { periodMonth: 10, periodYear: 2026, amount: 600, status: "PENDING", dueDate: new Date(2026, 9, 20) });
    await testDb.update(tenants).set({ anonymizedAt: new Date() }).where(eq(tenants.id, coloc.id));

    await runRentDueReminders(manager.id);

    expect(envois().map((e) => e.to)).toEqual([TITULAIRE]);
  });

  it("un colocataire sans numéro est ignoré : ni envoi, ni faux échec dans le journal", async () => {
    const { manager, contract, coloc } = await colocation();
    await createInvoice(contract.id, { periodMonth: 10, periodYear: 2026, amount: 600, status: "PENDING", dueDate: new Date(2026, 9, 20) });
    await testDb.update(tenants).set({ phone: "" }).where(eq(tenants.id, coloc.id));

    const resultat = await runRentDueReminders(manager.id);

    expect(envois().map((e) => e.to)).toEqual([TITULAIRE]);
    expect(resultat.whatsappEchecs).toBe(0);
    expect(await testDb.select().from(activityLogs).where(eq(activityLogs.action, "reminder.whatsapp_failed"))).toHaveLength(0);
  });

  it("l'échec WhatsApp d'un colocataire est tracé pour le gestionnaire, sans empêcher le reste", async () => {
    const { manager, contract } = await colocation();
    await createInvoice(contract.id, { periodMonth: 10, periodYear: 2026, amount: 600, status: "PENDING", dueDate: new Date(2026, 9, 20) });
    fetchMock.mockImplementation(async (_url: string, options: { body: string }) =>
      JSON.parse(options.body).to === COLOCATAIRE
        ? { ok: false, status: 400, text: async () => "numéro invalide" }
        : { ok: true, status: 200, json: async () => ({}) }
    );

    const resultat = await runRentDueReminders(manager.id);

    expect(resultat.sent).toBe(1);
    expect(resultat.whatsappEchecs).toBe(1);
    const traces = await testDb.select().from(activityLogs).where(eq(activityLogs.action, "reminder.whatsapp_failed"));
    expect(traces).toHaveLength(1);
    expect(email.mock.calls.map((c: unknown[]) => c[0]).sort()).toEqual(["awa@example.com", "binta@example.com"]);
  });
});

describe("relance d'impayé sur WhatsApp", () => {
  async function impaye(plan: "ENTERPRISE" | "STARTER" = "ENTERPRISE") {
    const agence = await colocation(plan);
    await testDb.insert(agencySettings).values({ userId: agence.manager.id, agencyName: "Agence Teranga", overdueRemindersEnabled: true });
    // Échue le 5 octobre : 7 jours de retard le 12, après le délai de grâce de 5 jours.
    const facture = await createInvoice(agence.contract.id, { periodMonth: 10, periodYear: 2026, amount: 500, status: "LATE", dueDate: new Date(2026, 9, 5) });
    return { ...agence, facture };
  }

  it("part au titulaire et au colocataire avec le modèle de relance, le montant et le retard", async () => {
    await impaye();

    const resultat = await runOverdueReminders();

    expect(resultat).toMatchObject({ sent: 1, echecs: 0 });
    expect(envois().sort((a, b) => a.to.localeCompare(b.to))).toEqual([
      { to: TITULAIRE, modele: "relance_impaye", nom: "Awa Sow" },
      { to: COLOCATAIRE, modele: "relance_impaye", nom: "Binta Kane" },
    ]);
    const variables = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body).template.components[0].parameters.map((p: { text: string }) => p.text);
    expect(variables.slice(1, 5)).toEqual(["octobre 2026", "Appartement T3", "500 €", "7"]);
    expect(variables[5]).toContain("/portail/paiements");
  });

  it("modèle non configuré : l'email part seul, rien chez Meta", async () => {
    env.whatsapp.templateNameOverdue = "";
    const { facture } = await impaye();

    const resultat = await runOverdueReminders();

    expect(resultat).toMatchObject({ sent: 1, echecs: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    // Aucune tentative, donc aucun avertissement « modèle non configuré » dans les journaux.
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining("Modèle de message"));
    expect(email.mock.calls.map((c: unknown[]) => c[0]).sort()).toEqual(["awa@example.com", "binta@example.com"]);
    expect((await testDb.select().from(invoices).where(eq(invoices.id, facture.id)))[0].overdueReminderLevel).toBe(1);
  });

  it("formule Starter : l'email part seul", async () => {
    await impaye("STARTER");

    const resultat = await runOverdueReminders();

    expect(resultat.sent).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("l'email du titulaire en échec mais WhatsApp délivré : la relance est tenue pour envoyée (un canal suffit)", async () => {
    const { facture } = await impaye();
    email.mockResolvedValue({ simulated: false, error: true } as never);

    const resultat = await runOverdueReminders();

    expect(resultat).toMatchObject({ sent: 1, echecs: 0 });
    expect((await testDb.select().from(invoices).where(eq(invoices.id, facture.id)))[0].overdueReminderLevel).toBe(1);
  });

  it("l'email en échec et WhatsApp en échec aussi : la relance est relâchée pour demain", async () => {
    const { facture } = await impaye();
    email.mockResolvedValue({ simulated: false, error: true } as never);
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => "refusé" });

    const resultat = await runOverdueReminders();

    expect(resultat).toMatchObject({ sent: 0, echecs: 1 });
    expect((await testDb.select().from(invoices).where(eq(invoices.id, facture.id)))[0].overdueReminderLevel).toBe(0);
  });

  it("un échec WhatsApp, l'email étant parti, est tracé pour le gestionnaire", async () => {
    await impaye();
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => "refusé" });

    const resultat = await runOverdueReminders();

    expect(resultat).toMatchObject({ sent: 1, echecs: 0 });
    const traces = await testDb.select().from(activityLogs).where(eq(activityLogs.action, "reminder.whatsapp_failed"));
    expect(traces).toHaveLength(1);
    // Le titulaire et le colocataire : deux messages non délivrés.
    expect(traces[0].details).toContain("2 messages");
  });
});
