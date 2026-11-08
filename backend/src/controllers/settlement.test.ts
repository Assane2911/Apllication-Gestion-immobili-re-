import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { activityLogs, contracts, invoices, leaseNotices, leaseSettlements } from "../db/schema";
import * as emailService from "../services/email.service";
import { generateSettlementHtml } from "../services/pdf.service";
import {
  authHeader,
  createContract,
  createInspection,
  createInvoice,
  createManager,
  createProperty,
  createTenant,
  tokenFor,
  tokenLocataire,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Solde de tout compte : loyers encore dus jusqu'au mois de la sortie, dépôt de garantie, retenues et trop-perçu, en un solde
 * signé (positif : à restituer ; négatif : reste dû). Le calcul reprend les règles existantes (paiements partiels, prorata
 * des jours occupés, restitution du dépôt) ; l'émission fige le résultat comme une mise en demeure.
 */
afterEach(() => {
  vi.restoreAllMocks();
});

const MARS = new Date(Date.UTC(2025, 2, 15));

/** Un bail terminé : loyer 500, dépôt 1000, commencé le 1er janvier 2025. Janvier réglé, février réglé en partie, mars impayé. */
async function agence(statut: "ENDED" | "ACTIVE" | "TERMINATED" = "ENDED") {
  const manager = await createManager();
  const property = await createProperty(manager.id, { title: "Studio Plateau", address: "12 rue Carnot, Dakar" });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Diop", email: "awa@test.local" });
  const contract = await createContract(property.id, tenant.id, {
    status: statut,
    startDate: new Date(2025, 0, 1),
    endDate: new Date(2028, 0, 1),
    deposit: 1000,
    rent: 500,
    currency: "XOF",
  });
  await createInvoice(contract.id, { periodMonth: 1, periodYear: 2025, amount: 500, status: "PAID", paidAt: new Date(2025, 0, 5), dueDate: new Date(2025, 0, 5) });
  await createInvoice(contract.id, { periodMonth: 2, periodYear: 2025, amount: 500, status: "PENDING", amountPaid: 200, dueDate: new Date(2025, 1, 5) });
  await createInvoice(contract.id, { periodMonth: 3, periodYear: 2025, amount: 500, status: "LATE", amountPaid: 0, dueDate: new Date(2025, 2, 5) });
  return { manager, property, tenant, contract, h: authHeader(tokenFor(manager)) };
}

const apercu = (h: Record<string, string>, contractId: string, requete: Record<string, string> = {}) =>
  request(app).get(`/api/contracts/${contractId}/settlement/preview`).query({ exitDate: "2025-03-15", ...requete }).set(h);
const emettre = (h: Record<string, string>, contractId: string, corps: object = {}) =>
  request(app).post(`/api/contracts/${contractId}/settlements`).set(h).send({ exitDate: "2025-03-15", ...corps });

describe("calcul du solde (aperçu)", () => {
  it("mois de sortie dû en entier : dépôt moins les loyers restant dus", async () => {
    const { contract, h } = await agence();
    const res = await apercu(h, contract.id);
    expect(res.status).toBe(200);
    // Février : 300 restant ; mars : 500 en entier ; janvier réglé.
    expect(res.body.unpaidTotal).toBe(800);
    expect(res.body.creditTotal).toBe(0);
    expect(res.body.balance).toBe(200);
    expect(res.body.lignes.map((l: { periodMonth: number; due: number }) => [l.periodMonth, l.due])).toEqual([
      [1, 0],
      [2, 300],
      [3, 500],
    ]);
  });

  it("mois de sortie au prorata des jours occupés", async () => {
    const { contract, h } = await agence();
    const res = await apercu(h, contract.id, { lastMonth: "PRORATA" });
    // 15 jours sur 31 : 500 × 15 / 31 = 241,94.
    expect(res.body.lignes[2]).toMatchObject({ amount: 500, retenu: 241.94, due: 241.94 });
    expect(res.body.unpaidTotal).toBe(541.94);
    expect(res.body.balance).toBe(458.06);
  });

  it("prorata : un mois de sortie déjà payé en entier rend un trop-perçu au locataire", async () => {
    const { contract, h } = await agence();
    await testDb.update(invoices).set({ status: "PAID", amountPaid: 500 }).where(eq(invoices.contractId, contract.id));
    const res = await apercu(h, contract.id, { lastMonth: "PRORATA" });
    expect(res.body.unpaidTotal).toBe(0);
    expect(res.body.creditTotal).toBe(258.06);
    expect(res.body.balance).toBe(1258.06);
  });

  it("ignore les factures postérieures au mois de la sortie et celles qui sont annulées", async () => {
    const { contract, h } = await agence();
    await createInvoice(contract.id, { periodMonth: 4, periodYear: 2025, amount: 500, status: "PENDING", dueDate: new Date(2025, 3, 5) });
    await createInvoice(contract.id, { periodMonth: 5, periodYear: 2025, amount: 500, status: "CANCELLED", dueDate: new Date(2025, 4, 5) });
    const res = await apercu(h, contract.id);
    expect(res.body.facturesApresSortie).toBe(1);
    expect(res.body.unpaidTotal).toBe(800);
    expect(res.body.lignes).toHaveLength(3);
  });

  it("retenues sur le dépôt : comptées seulement une fois la restitution enregistrée, qui est alors déduite", async () => {
    const { contract, h } = await agence();
    const avant = await apercu(h, contract.id);
    expect(avant.body.restitutionEnregistree).toBe(false);
    expect(avant.body.deductions).toEqual([]);

    await testDb
      .update(contracts)
      .set({ depositDeductions: JSON.stringify([{ label: "Peinture", amount: 150 }]), depositRefundedAt: new Date() })
      .where(eq(contracts.id, contract.id));
    const apres = await apercu(h, contract.id);
    expect(apres.body.restitutionEnregistree).toBe(true);
    expect(apres.body.deductionsTotal).toBe(150);
    // 850 déjà rendus au locataire : il reste devoir les 800 de loyers.
    expect(apres.body.depositRefunded).toBe(850);
    expect(apres.body.balance).toBe(-800);
  });

  it("sans date demandée : la sortie du congé en cours", async () => {
    const { contract, manager, h } = await agence();
    await testDb.insert(leaseNotices).values({
      contractId: contract.id,
      managerId: manager.id,
      givenBy: "TENANT",
      deliveryMode: "REGISTERED_MAIL",
      servedAt: new Date(Date.UTC(2025, 0, 10)),
      periodValue: 2,
      periodUnit: "MONTHS",
      exitDate: new Date(Date.UTC(2025, 1, 28)),
    });
    const res = await request(app).get(`/api/contracts/${contract.id}/settlement/preview`).set(h);
    expect(res.body.exitDate.slice(0, 10)).toBe("2025-02-28");
    expect(res.body.lignes).toHaveLength(2);
    expect(res.body.facturesApresSortie).toBe(1);
  });

  it("signale si un état des lieux de sortie a été finalisé", async () => {
    const { contract, manager, h } = await agence();
    expect((await apercu(h, contract.id)).body.etatDesLieuxDeSortie).toBe(false);
    await createInspection(contract, manager.id, { type: "EXIT", status: "COMPLETED" });
    expect((await apercu(h, contract.id)).body.etatDesLieuxDeSortie).toBe(true);
  });

  it("refuse un mode du dernier mois inconnu, répond 404 pour le bail d'une autre agence", async () => {
    const { contract, h } = await agence();
    expect((await apercu(h, contract.id, { lastMonth: "AUTRE" })).status).toBe(400);
    const autre = authHeader(tokenFor(await createManager()));
    expect((await apercu(autre, contract.id)).status).toBe(404);
  });
});

describe("émission du solde de tout compte", () => {
  it("fige le calcul : le document reste celui qui a été émis, même si les factures changent ensuite", async () => {
    const { contract, h } = await agence();
    const res = await emettre(h, contract.id, { lastMonthMode: "PRORATA" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ balance: 458.06, unpaidTotal: 541.94, lastMonthMode: "PRORATA", emailEnvoye: false });
    expect(res.body.reference).toMatch(/^SOLDE-\d{4}-[A-Z0-9]{8}$/);

    await testDb.update(invoices).set({ status: "PAID", amountPaid: 500 }).where(eq(invoices.contractId, contract.id));
    const [enBase] = await testDb.select().from(leaseSettlements).where(eq(leaseSettlements.id, res.body.id));
    expect(enBase.balance).toBe(458.06);
    const [trace] = await testDb.select().from(activityLogs).where(eq(activityLogs.action, "contract.settlement"));
    expect(trace.details).toContain("à restituer");
  });

  it("envoie le document par e-mail, en pièce jointe, au locataire et à ses colocataires", async () => {
    const { contract, h } = await agence();
    const envoi = vi.spyOn(emailService, "sendEmail");
    const res = await emettre(h, contract.id, { sendEmail: true });
    expect(res.status).toBe(201);
    expect(res.body.emailEnvoye).toBe(true);
    expect(envoi).toHaveBeenCalledTimes(1);
    const [destinataire, sujet, , pieces] = envoi.mock.calls[0];
    expect(destinataire).toBe("awa@test.local");
    expect(sujet).toContain("Solde de tout compte");
    expect(pieces?.[0]).toMatchObject({ contentType: "application/pdf" });
    expect((pieces?.[0].content as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    const [enBase] = await testDb.select().from(leaseSettlements).where(eq(leaseSettlements.id, res.body.id));
    expect(enBase.emailSentAt).not.toBeNull();
  });

  it("n'envoie aucun e-mail sans la demande explicite", async () => {
    const { contract, h } = await agence();
    const envoi = vi.spyOn(emailService, "sendEmail");
    await emettre(h, contract.id).expect(201);
    expect(envoi).not.toHaveBeenCalled();
  });

  it("refuse un bail encore en cours sans congé enregistré, l'accepte avec un congé", async () => {
    const { contract, manager, h } = await agence("ACTIVE");
    const refus = await emettre(h, contract.id);
    expect(refus.status).toBe(409);
    expect(refus.body.code).toBe("SETTLEMENT_CONTRACT_STILL_ACTIVE");

    await testDb.insert(leaseNotices).values({
      contractId: contract.id,
      managerId: manager.id,
      givenBy: "LANDLORD",
      deliveryMode: "BAILIFF",
      servedAt: new Date(Date.UTC(2025, 0, 10)),
      periodValue: 2,
      periodUnit: "MONTHS",
      exitDate: new Date(Date.UTC(2025, 2, 15)),
    });
    expect((await emettre(h, contract.id)).status).toBe(201);
  });

  it("refuse un locataire anonymisé", async () => {
    const { contract, tenant, h } = await agence();
    const { tenants } = await import("../db/schema");
    await testDb.update(tenants).set({ anonymizedAt: new Date() }).where(eq(tenants.id, tenant.id));
    const res = await emettre(h, contract.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SETTLEMENT_TENANT_ANONYMIZED");
  });

  it("liste l'historique des soldes d'un bail, sans le détail", async () => {
    const { contract, h } = await agence();
    await emettre(h, contract.id).expect(201);
    await emettre(h, contract.id, { lastMonthMode: "PRORATA" }).expect(201);
    const liste = await request(app).get(`/api/contracts/${contract.id}/settlements`).set(h);
    expect(liste.status).toBe(200);
    expect(liste.body).toHaveLength(2);
    expect(liste.body[0].details).toBeUndefined();
    expect(liste.body[0].reference).toMatch(/^SOLDE-/);
  });

  it("n'agit que sur les baux de l'agence", async () => {
    const { contract } = await agence();
    const autre = authHeader(tokenFor(await createManager()));
    expect((await emettre(autre, contract.id)).status).toBe(404);
    expect((await request(app).get(`/api/contracts/${contract.id}/settlements`).set(autre)).status).toBe(404);
  });
});

describe("marquer le solde comme réglé", () => {
  it("une seule fois", async () => {
    const { contract, h } = await agence();
    const { body } = await emettre(h, contract.id);
    const premier = await request(app).post(`/api/contracts/${contract.id}/settlements/${body.id}/settle`).set(h);
    expect(premier.status).toBe(200);
    expect(premier.body.settledAt).not.toBeNull();
    const second = await request(app).post(`/api/contracts/${contract.id}/settlements/${body.id}/settle`).set(h);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("SETTLEMENT_ALREADY_SETTLED");
  });

  it("ne règle pas le solde d'un autre bail", async () => {
    const a = await agence();
    const b = await agence();
    const { body } = await emettre(a.h, a.contract.id);
    const res = await request(app).post(`/api/contracts/${b.contract.id}/settlements/${body.id}/settle`).set(b.h);
    expect(res.status).toBe(404);
  });
});

describe("document du solde de tout compte", () => {
  it("est accessible au gestionnaire et au locataire du bail, pas à une autre agence ni à un autre locataire", async () => {
    const { contract, tenant, h } = await agence();
    const { body } = await emettre(h, contract.id);
    const url = `/api/documents/settlement/${body.id}`;

    const gestionnaire = await request(app).get(url).set(h);
    expect(gestionnaire.status).toBe(200);
    expect(gestionnaire.headers["content-type"]).toContain("text/html");
    expect(gestionnaire.text).toContain("SOLDE DE TOUT COMPTE");
    expect(gestionnaire.text).toContain("Studio Plateau");

    const locataire = await request(app).get(url).set(authHeader(await tokenLocataire(tenant.id)));
    expect(locataire.status).toBe(200);

    const autreAgence = await request(app).get(url).set(authHeader(tokenFor(await createManager())));
    expect(autreAgence.status).toBe(404);
    const autreAgenceTenant = await createTenant((await createManager()).id);
    const autreLocataire = await request(app).get(url).set(authHeader(await tokenLocataire(autreAgenceTenant.id)));
    expect(autreLocataire.status).toBe(404);
  });

  it("dit clairement le sens du solde", async () => {
    const base = {
      reference: "SOLDE-2025-TEST0001",
      createdAt: new Date(Date.UTC(2025, 2, 20)),
      exitDate: new Date(Date.UTC(2025, 2, 15)),
      lastMonthMode: "FULL" as const,
      currency: "XOF",
      depositAmount: 1000,
      deductions: [{ label: "Peinture", amount: 150 }],
      deductionsTotal: 150,
      depositRefunded: 0,
      lignes: [{ periodMonth: 3, periodYear: 2025, amount: 500, retenu: 500, paid: 0, due: 500, credit: 0 }],
      unpaidTotal: 500,
      creditTotal: 0,
      destinataires: "Awa Diop",
      adresse: "12 rue Carnot",
      propertyTitle: "Studio Plateau",
      contractStartDate: new Date(Date.UTC(2025, 0, 1)),
      agency: { name: "Agence Baobab", address: null, phone: null, email: null, siretOrId: null },
    };
    const restituer = generateSettlementHtml({ ...base, balance: 350 });
    expect(restituer).toContain("Somme à restituer au locataire");
    expect(restituer).toContain("Peinture");
    expect(restituer).toContain("Le loyer du mois de la sortie est dû en entier.");

    const devoir = generateSettlementHtml({ ...base, balance: -120 });
    expect(devoir).toContain("Reste dû par le locataire");

    const solde = generateSettlementHtml({ ...base, balance: 0, lastMonthMode: "PRORATA" });
    expect(solde).toContain("Compte soldé");
    expect(solde).toContain("au prorata des jours occupés");
  });
});
