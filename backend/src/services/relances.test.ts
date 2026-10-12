import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { activityLogs, agencySettings, contractCotenants, contractGuarantors, invoices, tenants } from "../db/schema";
import * as emailService from "./email.service";
import { niveauAttendu, runOverdueReminders } from "./relances.service";
import { authHeader, createContract, createInvoice, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/** Relances graduées : délai de grâce de 5 jours, puis tous les 10 jours, trois niveaux au plus. */
let envoi: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 12, 9));
  envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function agence(reglages: Partial<typeof agencySettings.$inferInsert> = { overdueRemindersEnabled: true }) {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
  await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "Agence Teranga", ...reglages });
  const property = await createProperty(manager.id, { title: "Studio A" });
  const tenant = await createTenant(manager.id, { email: "awa@example.com", firstName: "Awa", lastName: "Sow" });
  const contract = await createContract(property.id, tenant.id, { status: "ACTIVE" });
  return { manager, property, tenant, contract };
}

/** Facture échue le `jour` octobre 2026. */
const facture = (contractId: string, jour: number, extra: Partial<typeof invoices.$inferInsert> = {}) =>
  createInvoice(contractId, { periodMonth: 10, periodYear: 2026, amount: 500, status: "LATE", dueDate: new Date(2026, 9, jour), ...extra });
const niveauDe = async (id: string) => (await testDb.select().from(invoices).where(eq(invoices.id, id)))[0].overdueReminderLevel as number;
const destinataires = () => envoi.mock.calls.map((c: unknown[]) => c[0] as string).sort();
const aLaDate = (annee: number, mois0: number, jour: number) => vi.setSystemTime(new Date(annee, mois0, jour, 9));

describe("niveauAttendu", () => {
  it("rien pendant le délai de grâce, puis un niveau par intervalle, trois au plus", () => {
    expect([4, 5, 14, 15, 24, 25, 80].map((j) => niveauAttendu(j, 5, 10))).toEqual([0, 1, 1, 2, 2, 3, 3]);
    // Délai de grâce nul : la 1re relance part dès le lendemain de l'échéance, jamais le jour même.
    expect([0, 1].map((j) => niveauAttendu(j, 0, 10))).toEqual([0, 1]);
  });
});

describe("relances graduées", () => {
  it("désactivées par défaut : rien ne part", async () => {
    const { contract } = await agence({ overdueRemindersEnabled: false });
    await facture(contract.id, 1);
    expect(await runOverdueReminders()).toMatchObject({ sent: 0 });
    expect(envoi).not.toHaveBeenCalled();
  });

  it("suit le calendrier : 1re relance après le délai de grâce, puis tous les 10 jours, une seule fois chacune", async () => {
    const { manager, contract } = await agence();
    const f = await facture(contract.id, 5); // 7 jours de retard le 12/10

    await runOverdueReminders();
    expect(await niveauDe(f.id)).toBe(1);
    expect(envoi).toHaveBeenCalledTimes(1);
    expect(envoi.mock.calls[0][1]).toContain("Rappel : loyer non réglé");
    expect(envoi.mock.calls[0][2]).toContain("dépassée de 7 jour(s)");

    await runOverdueReminders(); // même jour : rien de plus
    aLaDate(2026, 9, 19); // 14 jours : toujours niveau 1
    await runOverdueReminders();
    expect(envoi).toHaveBeenCalledTimes(1);

    aLaDate(2026, 9, 20); // 15 jours : niveau 2
    await runOverdueReminders();
    expect(await niveauDe(f.id)).toBe(2);
    expect(envoi.mock.calls[1][1]).toContain("Deuxième relance");

    aLaDate(2026, 9, 30); // 25 jours : niveau 3
    await runOverdueReminders();
    expect(await niveauDe(f.id)).toBe(3);
    expect(envoi.mock.calls[2][1]).toContain("Dernière relance");

    aLaDate(2026, 10, 20); // au-delà : plus rien
    await runOverdueReminders();
    expect(envoi).toHaveBeenCalledTimes(3);

    const journal = await testDb.select().from(activityLogs).where(eq(activityLogs.managerId, manager.id));
    expect(journal.filter((l: { action: string }) => l.action === "invoice.overdue_reminder")).toHaveLength(3);
  });

  it("un impayé déjà ancien ne reçoit que le niveau atteint, pas toutes les relances d'un coup", async () => {
    const { contract } = await agence();
    const f = await facture(contract.id, 1, { dueDate: new Date(2026, 8, 1) }); // 41 jours
    await runOverdueReminders();
    expect(envoi).toHaveBeenCalledTimes(1);
    expect(envoi.mock.calls[0][1]).toContain("Dernière relance");
    expect(await niveauDe(f.id)).toBe(3);
  });

  it("au-delà de 90 jours de retard, plus de relance automatique", async () => {
    const { contract } = await agence();
    await facture(contract.id, 1, { dueDate: new Date(2026, 6, 1) }); // 103 jours
    await runOverdueReminders();
    expect(envoi).not.toHaveBeenCalled();
  });

  it("réclame le reste dû, et ignore une facture payée, annulée ou dans le délai de grâce", async () => {
    const { contract, property, manager } = await agence();
    await facture(contract.id, 5, { amountPaid: 200 });
    const autreBail = await createContract(property.id, (await createTenant(manager.id, { email: "b@example.com" })).id, { status: "ACTIVE" });
    await facture(autreBail.id, 5, { status: "PAID", amountPaid: 500 });
    await facture(autreBail.id, 5, { status: "CANCELLED", periodMonth: 9 });
    await facture(autreBail.id, 10, { periodMonth: 8, status: "PENDING" }); // 2 jours : délai de grâce

    await runOverdueReminders();
    expect(destinataires()).toEqual(["awa@example.com"]);
    expect(envoi.mock.calls[0][2]).toMatch(/300/);
  });

  it("un email en échec relâche le niveau : la relance repart à l'exécution suivante", async () => {
    const { contract } = await agence();
    const f = await facture(contract.id, 5);
    envoi.mockResolvedValueOnce({ simulated: false, error: true } as never);
    expect(await runOverdueReminders()).toMatchObject({ sent: 0, echecs: 1 });
    expect(await niveauDe(f.id)).toBe(0);
    expect(await runOverdueReminders()).toMatchObject({ sent: 1 });
    expect(await niveauDe(f.id)).toBe(1);
  });

  it("deux exécutions simultanées n'envoient qu'une relance", async () => {
    const { contract } = await agence();
    await facture(contract.id, 5);
    await Promise.all([runOverdueReminders(), runOverdueReminders()]);
    expect(envoi).toHaveBeenCalledTimes(1);
  });

  it("copie aux colocataires ; garants prévenus à la dernière relance seulement si l'agence le veut", async () => {
    const { manager, contract } = await agence({ overdueRemindersEnabled: true, overdueNotifyGuarantors: true });
    const coloc = await createTenant(manager.id, { email: "binta@example.com" });
    await testDb.insert(contractCotenants).values({ contractId: contract.id, tenantId: coloc.id });
    await testDb.insert(contractGuarantors).values({ contractId: contract.id, firstName: "Ibrahima", lastName: "Fall", phone: "+221771234567", email: "garant@example.com" });
    await facture(contract.id, 5);

    await runOverdueReminders(); // niveau 1 : pas le garant
    expect(destinataires()).toEqual(["awa@example.com", "binta@example.com"]);

    envoi.mockClear();
    aLaDate(2026, 9, 30); // niveau 3
    await runOverdueReminders();
    expect(destinataires()).toEqual(["awa@example.com", "binta@example.com", "garant@example.com"]);
    const avisGarant = envoi.mock.calls.find((c: unknown[]) => c[0] === "garant@example.com")!;
    expect(avisGarant[1]).toContain("loyer impayé de Awa Sow");
  });

  it("sans l'option, le garant n'est jamais prévenu", async () => {
    const { contract } = await agence();
    await testDb.insert(contractGuarantors).values({ contractId: contract.id, firstName: "I", lastName: "F", phone: "+221771234567", email: "garant@example.com" });
    await facture(contract.id, 1, { dueDate: new Date(2026, 8, 1) });
    await runOverdueReminders();
    expect(destinataires()).toEqual(["awa@example.com"]);
  });

  it("un locataire anonymisé ne reçoit rien ; l'agence d'à côté non plus si elle n'a rien activé", async () => {
    const { tenant, contract } = await agence();
    await testDb.update(tenants).set({ anonymizedAt: new Date() }).where(eq(tenants.id, tenant.id));
    await facture(contract.id, 5);
    const voisine = await agence({ overdueRemindersEnabled: false });
    await facture(voisine.contract.id, 5);
    await runOverdueReminders();
    expect(envoi).not.toHaveBeenCalled();
  });
});

describe("réglages de l'agence", () => {
  it("enregistre l'activation, le délai de grâce, l'intervalle et l'option garants ; valide les bornes", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    const h = authHeader(tokenFor(manager));
    const ok = await request(app)
      .put("/api/agency")
      .set(h)
      .send({ agencyName: "Agence", overdueRemindersEnabled: true, overdueGraceDays: 3, overdueIntervalDays: 7, overdueNotifyGuarantors: true });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ overdueRemindersEnabled: true, overdueGraceDays: 3, overdueIntervalDays: 7, overdueNotifyGuarantors: true });

    // Un enregistrement qui n'envoie pas ces champs ne les remet pas à zéro.
    const sans = await request(app).put("/api/agency").set(h).send({ agencyName: "Agence renommée" });
    expect(sans.body).toMatchObject({ agencyName: "Agence renommée", overdueRemindersEnabled: true, overdueGraceDays: 3 });

    expect((await request(app).put("/api/agency").set(h).send({ agencyName: "A", overdueGraceDays: 31 })).status).toBe(400);
    expect((await request(app).put("/api/agency").set(h).send({ agencyName: "A", overdueIntervalDays: 2 })).status).toBe(400);
  });
});
