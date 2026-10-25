import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { agencySettings, contractCotenants, contractGuarantors, expenses, insurancePolicies, issueReports, tenants, users } from "../db/schema";
import { authHeader, createContract, createInvoice, createManager, createOwner, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { hashToken } from "../utils/token";
import * as emailService from "./email.service";
import { REFERRAL_REWARD_DAYS } from "./referral.service";
import { runOverdueReminders } from "./relances.service";
import { runContractEndingReminders, runInsurancePolicyExpiryReminders } from "./reminder.service";

/**
 * Lot 2B : les e-mails restants (hors mise en demeure et caution, laissées en français) suivent la langue de leur
 * destinataire — enregistrée sur la fiche du locataire ou du propriétaire, sur le compte du gestionnaire.
 * Horloge figée au 12 octobre 2026.
 */
let envoi: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 12, 10));
  envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const messagesVers = (adresse: string) =>
  envoi.mock.calls.filter((c: unknown[]) => c[0] === adresse).map((c: unknown[]) => ({ sujet: c[1] as string, html: c[2] as string }));
const langueDu = (table: typeof tenants | typeof users) => async (id: string, langue: string | null) => {
  await testDb.update(table as typeof tenants).set({ language: langue }).where(eq((table as typeof tenants).id, id));
};
const langueLocataire = langueDu(tenants);
const langueGestionnaire = langueDu(users as unknown as typeof tenants);

describe("au locataire — signalement, message, révision de loyer", () => {
  async function bail(langue: string | null) {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });
    const property = await createProperty(manager.id, { title: "Studio A" });
    const tenant = await createTenant(manager.id, { email: "awa@test.local", firstName: "Awa", lastName: "Sow" });
    await langueLocataire(tenant.id, langue);
    const contract = await createContract(property.id, tenant.id, { rent: 500, startDate: new Date("2026-01-01T00:00:00Z"), endDate: new Date("2027-12-31T00:00:00Z") });
    return { manager, property, tenant, contract, h: authHeader(tokenFor(manager)) };
  }

  it("le statut d'un signalement part dans la langue de son auteur", async () => {
    const { contract, tenant, h } = await bail("en");
    const [signalement] = await testDb
      .insert(issueReports)
      .values({ contractId: contract.id, tenantId: tenant.id, title: "Fuite", description: "Sous l'évier", photoUrl: "issues/x.jpg" })
      .returning();

    const res = await request(app).put(`/api/issues/${signalement.id}/status`).set(h).send({ status: "RESOLVED", managerNote: "C'est réparé" });

    expect(res.status).toBe(200);
    const [message] = messagesVers("awa@test.local");
    expect(message.sujet).toBe("✅ Update on your report — Fuite");
    expect(message.html).toContain("Resolved");
    expect(message.html).toContain("Message from your agency:");
  });

  it("le nouveau message de l'agence part dans la langue du locataire de ce fil", async () => {
    const { contract, h } = await bail("pt");

    const res = await request(app).post(`/api/messages/${contract.id}`).set(h).send({ content: "Bonjour, une question" });

    expect(res.status).toBe(201);
    expect(messagesVers("awa@test.local")[0].sujet).toBe("💬 Nova mensagem da sua imobiliária — Studio A");
  });

  it("la révision de loyer part dans la langue du locataire, motif compris, et chaque occupant reçoit la sienne", async () => {
    const { manager, contract, h } = await bail("en");
    const coloc = await createTenant(manager.id, { email: "moussa@test.local", firstName: "Moussa", lastName: "Fall" });
    await langueLocataire(coloc.id, "es");
    await testDb.insert(contractCotenants).values({ contractId: contract.id, tenantId: coloc.id });

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/rent-revisions`)
      .set(h)
      .send({ mode: "PERCENT", percent: 3.5, effectiveDate: "2026-12-01", notifyTenant: true });

    expect(res.status).toBe(201);
    const [pourTitulaire] = messagesVers("awa@test.local");
    expect(pourTitulaire.sujet).toBe("Your rent is being revised as of December 1, 2026");
    expect(pourTitulaire.html).toContain("+3.5%");
    const [pourColoc] = messagesVers("moussa@test.local");
    expect(pourColoc.sujet).toBe("Revisión de su alquiler a partir del 1 de diciembre de 2026");
    expect(pourColoc.html).toContain("+3,5 %");
  });

  it("sans langue sur la fiche (d'avant), tout reste en français", async () => {
    const { contract, h } = await bail(null);
    await request(app).post(`/api/messages/${contract.id}`).set(h).send({ content: "Bonjour" });
    expect(messagesVers("awa@test.local")[0].sujet).toBe("💬 Nouveau message de votre agence — Studio A");
  });
});

describe("au garant — dans la langue du locataire qu'il garantit", () => {
  it("l'avis d'impayé de la dernière relance part dans la langue du locataire", async () => {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "Agence Teranga", overdueRemindersEnabled: true, overdueNotifyGuarantors: true });
    const property = await createProperty(manager.id, { title: "Studio A" });
    const tenant = await createTenant(manager.id, { email: "awa@example.com", firstName: "Awa", lastName: "Sow" });
    await langueLocataire(tenant.id, "es");
    const contract = await createContract(property.id, tenant.id, { status: "ACTIVE" });
    await testDb.insert(contractGuarantors).values({ contractId: contract.id, firstName: "Ibrahima", lastName: "Fall", phone: "+221771234567", email: "garant@example.com" });
    await createInvoice(contract.id, { periodMonth: 10, periodYear: 2026, amount: 500, status: "LATE", dueDate: new Date(2026, 9, 5) });
    vi.setSystemTime(new Date(2026, 9, 30, 9)); // niveau 3

    await runOverdueReminders();

    expect(messagesVers("garant@example.com")[0].sujet).toBe("Aviso: alquiler impagado de Awa Sow — octubre 2026");
  });
});

describe("au propriétaire — reversement", () => {
  async function agence(langue: string | null) {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    const owner = await createOwner(manager.id, { managementFeeRate: 10, iban: "FR7630006000011234567890189", email: "proprio@test.local" });
    await testDb.update((await import("../db/schema")).owners).set({ language: langue }).where(eq((await import("../db/schema")).owners.id, owner.id));
    const property = await createProperty(manager.id, { title: "Villa Ngor", ownerId: owner.id });
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await createInvoice(contract.id, { periodMonth: 9, amount: 1000, status: "PAID", paidAt: new Date(2026, 8, 5) });
    await testDb.insert(expenses).values({ propertyId: property.id, category: "MAINTENANCE", title: "Plomberie", amount: 100, expenseDate: new Date(2026, 8, 10) });
    return { owner, h: authHeader(tokenFor(manager)) };
  }
  const reverser = (h: Record<string, string>, ownerId: string) =>
    request(app).post(`/api/crg/${ownerId}/payouts`).set(h).send({ month: 9, year: 2026, currency: "EUR", method: "BANK_TRANSFER", paidAt: "2026-10-05", amount: 800, notifyOwner: true });

  it("l'annonce du reversement part dans la langue du propriétaire, moyen de paiement compris", async () => {
    const { owner, h } = await agence("en");
    const res = await reverser(h, owner.id);
    expect(res.status).toBe(201);
    const [message] = messagesVers("proprio@test.local");
    expect(message.sujet).toBe("Payment of your rents — September 2026");
    expect(message.html).toContain("(bank transfer)");
  });

  it("sans langue sur la fiche (d'avant), en français comme avant", async () => {
    const { owner, h } = await agence(null);
    await reverser(h, owner.id);
    const [message] = messagesVers("proprio@test.local");
    expect(message.sujet).toBe("Reversement de vos loyers — septembre 2026");
    expect(message.html).toContain("(virement)");
  });
});

describe("au gestionnaire — fin de contrat, assurance, parrainage", () => {
  it("le rappel de fin de contrat part dans la langue du gestionnaire", async () => {
    const manager = await createManager({ email: "gestionnaire@test.local" });
    await langueGestionnaire(manager.id, "pt");
    const property = await createProperty(manager.id, { title: "Studio A" });
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id, { startDate: new Date(2025, 9, 15), endDate: new Date(2026, 9, 17), status: "ACTIVE" });

    const { sent } = await runContractEndingReminders();

    expect(sent).toBe(1);
    expect(messagesVers("gestionnaire@test.local")[0].sujet).toBe("Lembrete: o contrato termina em 5 dias — Studio A");
  });

  it("le rappel d'assurance part dans la langue du gestionnaire", async () => {
    const manager = await createManager({ email: "gestionnaire@test.local" });
    await langueGestionnaire(manager.id, "en");
    const property = await createProperty(manager.id, { title: "Studio A" });
    await testDb.insert(insurancePolicies).values({ propertyId: property.id, insurerName: "AXA", policyNumber: "POL-1", expiryDate: new Date(2026, 9, 22) });

    const { sent } = await runInsurancePolicyExpiryReminders();

    expect(sent).toBe(1);
    expect(messagesVers("gestionnaire@test.local")[0].sujet).toBe("Reminder: insurance policy to renew in 10 days — Studio A");
  });

  it("un gestionnaire sans langue (compte d'avant) reçoit le français", async () => {
    const manager = await createManager({ email: "gestionnaire@test.local" });
    const property = await createProperty(manager.id, { title: "Studio A" });
    await testDb.insert(insurancePolicies).values({ propertyId: property.id, insurerName: "AXA", policyNumber: "POL-1", expiryDate: new Date(2026, 9, 22) });

    await runInsurancePolicyExpiryReminders();

    expect(messagesVers("gestionnaire@test.local")[0].sujet).toBe("Rappel : police d'assurance à renouveler dans 10 jours — Studio A");
  });

  it("la récompense de parrainage part dans la langue du parrain", async () => {
    const parrain = await createManager({ email: "parrain@test.local", subscriptionStatus: "TRIAL", trialEndsAt: new Date(Date.now() + 10 * 86_400_000) });
    await langueGestionnaire(parrain.id, "es");
    await createManager({
      emailVerifiedAt: null,
      emailVerificationTokenHash: hashToken("jeton-filleul"),
      emailVerificationExpiresAt: new Date(Date.now() + 3_600_000),
      referredByUserId: parrain.id,
    });

    const res = await request(app).post("/api/auth/verify-email").send({ token: "jeton-filleul" });

    expect(res.status).toBe(200);
    expect(messagesVers("parrain@test.local")[0].sujet).toBe(`🎁 +${REFERRAL_REWARD_DAYS} días de regalo — tu referido se ha unido a ImmoPlatform Pro`);
  });
});
