import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { activityLogs, agencySettings, contractCotenants, contractGuarantors, formalNotices, invoices, tenants } from "../db/schema";
import * as emailService from "../services/email.service";
import { factureMure, SEUIL_SANS_RELANCES_JOURS } from "../services/miseEnDemeure.service";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createProperty,
  createTeamMember,
  createTenant,
  tokenFor,
  tokenLocataire,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Mise en demeure de payer : préparée automatiquement pour les impayés qui ont épuisé les relances
 * (ou, relances désactivées, au-delà d'un mois de retard), émise par le gestionnaire, figée au moment
 * de l'émission, téléchargeable et envoyable par email.
 */
const JOUR = 86_400_000;
const ilYa = (jours: number) => new Date(Date.now() - jours * JOUR);

afterEach(() => {
  vi.restoreAllMocks();
});

async function agence() {
  const manager = await createManager();
  const property = await createProperty(manager.id, { title: "Appartement Plateau", address: "12 rue Carnot, Dakar" });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Diop", email: "awa@test.local" });
  const contract = await createContract(property.id, tenant.id, { status: "ACTIVE", startDate: new Date(2025, 0, 1), endDate: new Date(2028, 0, 1) });
  return { manager, property, tenant, contract, h: authHeader(tokenFor(manager)) };
}

/** Antidate les mises en demeure déjà émises : une réémission identique n'est refusée que dans les 24 h. */
const vieillir = (jours = 2) => testDb.update(formalNotices).set({ createdAt: ilYa(jours) });
const dues = (h: Record<string, string>) => request(app).get("/api/contracts/formal-notices-due").set(h);
const emettre = (h: Record<string, string>, contractId: string, body: object = {}) =>
  request(app).post(`/api/contracts/${contractId}/formal-notices`).set(h).send(body);

describe("factureMure — quand un impayé appelle une mise en demeure", () => {
  const facture = (retard: number, niveau = 0, relanceIlYa?: number) =>
    ({
      dueDate: ilYa(retard),
      overdueReminderLevel: niveau,
      overdueReminderSentAt: relanceIlYa === undefined ? null : ilYa(relanceIlYa),
    }) as unknown as typeof invoices.$inferSelect;

  it("relances désactivées : après un mois de retard", () => {
    expect(factureMure(facture(SEUIL_SANS_RELANCES_JOURS - 1), undefined)).toBe(false);
    expect(factureMure(facture(SEUIL_SANS_RELANCES_JOURS), undefined)).toBe(true);
    expect(factureMure(facture(45), { overdueRemindersEnabled: false, overdueGraceDays: 5, overdueIntervalDays: 10 })).toBe(true);
  });

  it("relances activées : un intervalle après la dernière relance, pas avant", () => {
    const reglages = { overdueRemindersEnabled: true, overdueGraceDays: 5, overdueIntervalDays: 10 };
    expect(factureMure(facture(26, 3, 1), reglages)).toBe(false);
    expect(factureMure(facture(28, 3, 10), reglages)).toBe(true);
    // Jamais relancée (relances activées après coup) : le retard équivalent suffit (5 + 3 × 10).
    expect(factureMure(facture(34, 0), reglages)).toBe(false);
    expect(factureMure(facture(35, 0), reglages)).toBe(true);
  });
});

describe("GET /api/contracts/formal-notices-due", () => {
  it("liste le bail dont un loyer est impayé depuis plus d'un mois, avec le total de TOUS ses impayés", async () => {
    const { contract, h } = await agence();
    await createInvoice(contract.id, { periodMonth: 7, periodYear: 2026, amount: 500, amountPaid: 100, status: "LATE", dueDate: ilYa(40) });
    await createInvoice(contract.id, { periodMonth: 8, periodYear: 2026, amount: 500, status: "LATE", dueDate: ilYa(10) });
    await createInvoice(contract.id, { periodMonth: 6, periodYear: 2026, amount: 500, status: "PAID", dueDate: ilYa(70) });

    const res = await dues(h);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      contractId: contract.id,
      propertyTitle: "Appartement Plateau",
      tenantName: "Awa Diop",
      unpaidCount: 2,
      alreadyClaimedCount: 0,
      totalDue: 900,
      daysLate: 40,
    });
  });

  it("ignore un retard récent, le bail d'une autre agence et un locataire anonymisé", async () => {
    const { contract, h } = await agence();
    await createInvoice(contract.id, { status: "LATE", dueDate: ilYa(10) });
    const autre = await agence();
    await createInvoice(autre.contract.id, { status: "LATE", dueDate: ilYa(60) });
    expect((await dues(h)).body).toEqual([]);
    expect((await dues(autre.h)).body).toHaveLength(1);

    await testDb.update(tenants).set({ anonymizedAt: new Date() }).where(eq(tenants.id, autre.tenant.id));
    expect((await dues(autre.h)).body).toEqual([]);
  });

  it("suit le calendrier des relances quand l'agence les a activées", async () => {
    const { manager, contract, h } = await agence();
    await testDb.insert(agencySettings).values({ userId: manager.id, overdueRemindersEnabled: true, overdueGraceDays: 5, overdueIntervalDays: 10 });
    // Relance 3/3 envoyée il y a 2 jours : trop tôt.
    const facture = await createInvoice(contract.id, { status: "LATE", dueDate: ilYa(31), overdueReminderLevel: 3, overdueReminderSentAt: ilYa(2) });
    expect((await dues(h)).body).toEqual([]);

    await testDb.update(invoices).set({ overdueReminderSentAt: ilYa(10) }).where(eq(invoices.id, facture.id));
    expect((await dues(h)).body).toHaveLength(1);
  });
});

describe("POST /api/contracts/:id/formal-notices", () => {
  it("fige les factures échues impayées et le montant, puis sort le bail de la liste", async () => {
    const { manager, contract, h } = await agence();
    const ancienne = await createInvoice(contract.id, { periodMonth: 7, periodYear: 2026, amount: 500, amountPaid: 100, status: "LATE", dueDate: ilYa(40) });
    const recente = await createInvoice(contract.id, { periodMonth: 8, periodYear: 2026, amount: 500, status: "LATE", dueDate: ilYa(10) });
    // Pas encore échue : rien à réclamer.
    await createInvoice(contract.id, { periodMonth: 9, periodYear: 2026, amount: 500, status: "PENDING", dueDate: new Date(Date.now() + 5 * JOUR) });

    const res = await emettre(h, contract.id, { deadlineDays: 15 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ totalDue: 900, deadlineDays: 15, emailEnvoye: false, emailSentAt: null });
    expect(res.body.reference).toMatch(/^MED-\d{4}-[A-Z0-9]{6}$/);
    expect(res.body.invoicesSnapshot).toBeUndefined();
    const [enBase] = await testDb.select().from(formalNotices).where(eq(formalNotices.id, res.body.id));
    expect(JSON.parse(enBase.invoicesSnapshot).map((f: { invoiceId: string; resteDu: number }) => [f.invoiceId, f.resteDu])).toEqual([
      [ancienne.id, 400],
      [recente.id, 500],
    ]);
    expect(enBase.managerId).toBe(manager.id);

    expect((await dues(h)).body).toEqual([]);
    const [trace] = await testDb.select().from(activityLogs).where(eq(activityLogs.action, "contract.formal_notice"));
    expect(trace.details).toContain("sans envoi par email");

    const liste = await request(app).get(`/api/contracts/${contract.id}/formal-notices`).set(h);
    expect(liste.body).toHaveLength(1);
    expect(liste.body[0].invoices).toHaveLength(2);
    expect(liste.body[0].invoicesSnapshot).toBeUndefined();
  });

  it("un nouvel impayé mûr, non encore réclamé, fait revenir le bail dans la liste", async () => {
    const { contract, h } = await agence();
    await createInvoice(contract.id, { periodMonth: 7, periodYear: 2026, status: "LATE", dueDate: ilYa(70) });
    await emettre(h, contract.id);
    const nouvelle = await createInvoice(contract.id, { periodMonth: 8, periodYear: 2026, status: "LATE", dueDate: ilYa(35) });

    const res = await dues(h);

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ unpaidCount: 2, alreadyClaimedCount: 1, totalDue: 1000 });
    expect(nouvelle).toBeDefined();
  });

  it("refuse quand rien n'est dû, un délai hors bornes, et le bail d'une autre agence", async () => {
    const { contract, h } = await agence();
    expect((await emettre(h, contract.id)).status).toBe(409);

    await createInvoice(contract.id, { status: "LATE", dueDate: ilYa(40) });
    expect((await emettre(h, contract.id, { deadlineDays: 0 })).status).toBe(400);
    expect((await emettre(h, contract.id, { deadlineDays: 61 })).status).toBe(400);
    expect((await emettre(authHeader(tokenFor(await createManager())), contract.id)).status).toBe(404);
    expect(await testDb.select().from(formalNotices)).toHaveLength(0);
  });

  it("refuse une mise en demeure identique à la précédente (double envoi), sans rien écrire au locataire", async () => {
    const { contract, h } = await agence();
    await createInvoice(contract.id, { status: "LATE", dueDate: ilYa(40) });
    const envoi = vi.spyOn(emailService, "sendEmail");
    const premiere = await emettre(h, contract.id, { sendEmail: true });
    envoi.mockClear();

    const doublon = await emettre(h, contract.id, { sendEmail: true });

    expect(doublon.status).toBe(409);
    expect(doublon.body.error).toContain(`réf. ${premiere.body.reference}`);
    expect(doublon.body.error).toContain("rien de nouveau à réclamer");
    expect(envoi).not.toHaveBeenCalled();
    expect(await testDb.select().from(formalNotices)).toHaveLength(1);
  });

  it("deux requêtes simultanées n'émettent qu'une seule mise en demeure", async () => {
    const { contract, h } = await agence();
    await createInvoice(contract.id, { status: "LATE", dueDate: ilYa(40) });

    const [a, b] = await Promise.all([emettre(h, contract.id), emettre(h, contract.id)]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await testDb.select().from(formalNotices)).toHaveLength(1);
  });

  it("une réémission est permise quand le contenu change (nouvelle facture, paiement partiel) ou après 24 h", async () => {
    const { contract, h } = await agence();
    const premiere = await createInvoice(contract.id, { periodMonth: 7, periodYear: 2026, amount: 500, status: "LATE", dueDate: ilYa(70) });
    expect((await emettre(h, contract.id)).status).toBe(201);

    // Une nouvelle facture échue : le contenu change.
    await createInvoice(contract.id, { periodMonth: 8, periodYear: 2026, amount: 500, status: "LATE", dueDate: ilYa(40) });
    expect((await emettre(h, contract.id)).status).toBe(201);

    // Un paiement partiel : le reste dû change.
    await testDb.update(invoices).set({ amountPaid: 100 }).where(eq(invoices.id, premiere.id));
    expect((await emettre(h, contract.id)).status).toBe(201);

    // Identique à la précédente, mais plus de 24 h après.
    expect((await emettre(h, contract.id)).status).toBe(409);
    await vieillir(2);
    expect((await emettre(h, contract.id)).status).toBe(201);
    expect(await testDb.select().from(formalNotices)).toHaveLength(4);
  });

  it("envoie le courrier en PDF au locataire et aux colocataires, et aux garants seulement si demandé", async () => {
    const { manager, contract, h } = await agence();
    const coloc = await createTenant(manager.id, { email: "coloc@test.local" });
    await testDb.insert(contractCotenants).values({ contractId: contract.id, tenantId: coloc.id });
    await testDb.insert(contractGuarantors).values({ contractId: contract.id, firstName: "Moussa", lastName: "Sow", phone: "+221770000000", email: "garant@test.local" });
    await createInvoice(contract.id, { status: "LATE", dueDate: ilYa(40) });
    const envoi = vi.spyOn(emailService, "sendEmail");

    const sans = await emettre(h, contract.id, { sendEmail: true });

    expect(sans.status).toBe(201);
    expect(sans.body).toMatchObject({ colocatairesPrevenus: 1, garantsPrevenus: 0 });
    expect(sans.body.emailSentAt).not.toBeNull();
    const destinataires = envoi.mock.calls.map((c) => c[0]);
    expect(destinataires).toEqual(["awa@test.local", "coloc@test.local"]);
    const [, sujet, , pieces] = envoi.mock.calls[0];
    expect(sujet).toContain("Mise en demeure de payer");
    expect(pieces?.[0].contentType).toBe("application/pdf");
    expect(pieces?.[0].content.subarray(0, 4).toString()).toBe("%PDF");

    envoi.mockClear();
    await vieillir();
    const avec = await emettre(h, contract.id, { sendEmail: true, notifyGuarantors: true });
    expect(avec.body.garantsPrevenus).toBe(1);
    expect(envoi.mock.calls.map((c) => c[0])).toContain("garant@test.local");
  });

  it("n'écrit à personne sans demande d'envoi, même avec des garants", async () => {
    const { contract, h } = await agence();
    await testDb.insert(contractGuarantors).values({ contractId: contract.id, firstName: "Moussa", lastName: "Sow", phone: "+221770000000", email: "garant@test.local" });
    await createInvoice(contract.id, { status: "LATE", dueDate: ilYa(40) });
    const envoi = vi.spyOn(emailService, "sendEmail");

    const res = await emettre(h, contract.id, { notifyGuarantors: true });

    expect(res.status).toBe(201);
    expect(envoi).not.toHaveBeenCalled();
  });

  it("équipe : l'agent et le comptable émettent, la lecture seule non", async () => {
    const { manager, contract } = await agence();
    await createInvoice(contract.id, { status: "LATE", dueDate: ilYa(40) });
    const jeton = async (teamRole: string) =>
      authHeader(tokenFor({ id: manager.id, role: "MANAGER" }, null, null, (await createTeamMember(manager.id, { teamRole })).id));

    expect((await emettre(await jeton("READ_ONLY"), contract.id)).status).toBe(403);
    expect((await emettre(await jeton("AGENT"), contract.id)).status).toBe(201);
    await vieillir();
    expect((await emettre(await jeton("ACCOUNTANT"), contract.id)).status).toBe(201);
  });
});

describe("GET /api/documents/formal-notice/:noticeId", () => {
  it("rend le courrier figé : un paiement ultérieur ne change pas la somme réclamée", async () => {
    const { contract, h } = await agence();
    const facture = await createInvoice(contract.id, { periodMonth: 7, periodYear: 2026, amount: 650, status: "LATE", dueDate: ilYa(40) });
    const { body: notice } = await emettre(h, contract.id, { deadlineDays: 8 });
    await testDb.update(invoices).set({ status: "PAID", amountPaid: 650 }).where(eq(invoices.id, facture.id));

    const res = await request(app).get(`/api/documents/formal-notice/${notice.id}`).set(h);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("MISE EN DEMEURE DE PAYER");
    expect(res.text).toContain(notice.reference);
    expect(res.text).toContain("Awa Diop");
    expect(res.text).toContain("juillet 2026");
    expect(res.text).toMatch(/650[\s ]?€/);
    expect(res.text).toContain("dans un délai de 8 jours");
  });

  it("s'ouvre pour le locataire du bail, pas pour une autre agence ni un autre locataire", async () => {
    const { manager, tenant, contract, h } = await agence();
    await createInvoice(contract.id, { status: "LATE", dueDate: ilYa(40) });
    const { body: notice } = await emettre(h, contract.id);
    const url = `/api/documents/formal-notice/${notice.id}`;

    expect((await request(app).get(url).set(authHeader(await tokenLocataire(tenant.id)))).status).toBe(200);
    expect((await request(app).get(url).set(authHeader(tokenFor(await createManager())))).status).toBe(403);
    const intrus = await createTenant(manager.id);
    expect((await request(app).get(url).set(authHeader(await tokenLocataire(intrus.id)))).status).toBe(403);
  });
});

describe("export RGPD du locataire", () => {
  it("inclut ses mises en demeure et les factures réclamées", async () => {
    const { tenant, contract, h } = await agence();
    await createInvoice(contract.id, { status: "LATE", dueDate: ilYa(40) });
    const { body: notice } = await emettre(h, contract.id);

    const res = await request(app).get(`/api/tenants/${tenant.id}/export`).set(h);

    expect(res.status).toBe(200);
    expect(res.body.misesEnDemeure).toHaveLength(1);
    expect(res.body.misesEnDemeure[0]).toMatchObject({ reference: notice.reference, totalDue: 500 });
    expect(res.body.misesEnDemeure[0].facturesReclamees).toHaveLength(1);
  });
});
