import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { invoices, leaseSettlements } from "../db/schema";
import * as emailService from "../services/email.service";
import { authHeader, createContract, createInvoice, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Solde de tout compte : comme la mise en demeure, un solde IDENTIQUE au précédent (même sortie, même mode, mêmes montants)
 * émis dans les 24 heures est refusé — un double clic ou un appel rejoué ne doit ni écrire deux soldes, ni envoyer deux e-mails
 * au locataire. Dès que le contenu change, ou passé le délai, une nouvelle émission est permise.
 */
afterEach(() => {
  vi.restoreAllMocks();
});

async function agence() {
  const manager = await createManager();
  const property = await createProperty(manager.id, { title: "Studio Plateau", address: "12 rue Carnot, Dakar" });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Diop", email: "awa@test.local" });
  const contract = await createContract(property.id, tenant.id, {
    status: "ENDED",
    startDate: new Date(2025, 0, 1),
    endDate: new Date(2028, 0, 1),
    deposit: 1000,
    rent: 500,
    currency: "XOF",
  });
  await createInvoice(contract.id, { periodMonth: 1, periodYear: 2025, amount: 500, status: "PAID", paidAt: new Date(2025, 0, 5), dueDate: new Date(2025, 0, 5) });
  await createInvoice(contract.id, { periodMonth: 2, periodYear: 2025, amount: 500, status: "PENDING", amountPaid: 200, dueDate: new Date(2025, 1, 5) });
  await createInvoice(contract.id, { periodMonth: 3, periodYear: 2025, amount: 500, status: "LATE", amountPaid: 0, dueDate: new Date(2025, 2, 5) });
  return { contract, h: authHeader(tokenFor(manager)) };
}

const emettre = (h: Record<string, string>, contractId: string, corps: object = {}) =>
  request(app).post(`/api/contracts/${contractId}/settlements`).set(h).send({ exitDate: "2025-03-15", ...corps });

describe("émission du solde de tout compte — doublons", () => {
  it("refuse un solde identique au précédent, sans second enregistrement ni second e-mail", async () => {
    const { contract, h } = await agence();
    const envoi = vi.spyOn(emailService, "sendEmail");
    const premier = await emettre(h, contract.id, { sendEmail: true });
    expect(premier.status).toBe(201);
    expect(envoi).toHaveBeenCalledTimes(1);

    const doublon = await emettre(h, contract.id, { sendEmail: true });

    expect(doublon.status).toBe(409);
    expect(doublon.body.code).toBe("SETTLEMENT_DUPLICATE");
    expect(doublon.body.error).toContain(`réf. ${premier.body.reference}`);
    expect(envoi).toHaveBeenCalledTimes(1);
    expect(await testDb.select().from(leaseSettlements).where(eq(leaseSettlements.contractId, contract.id))).toHaveLength(1);
  });

  it("deux requêtes simultanées n'émettent qu'un seul solde", async () => {
    const { contract, h } = await agence();

    const [a, b] = await Promise.all([emettre(h, contract.id), emettre(h, contract.id)]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await testDb.select().from(leaseSettlements).where(eq(leaseSettlements.contractId, contract.id))).toHaveLength(1);
  });

  it("permet une nouvelle émission quand le mode du dernier mois, la date de sortie ou les montants changent", async () => {
    const { contract, h } = await agence();
    expect((await emettre(h, contract.id)).status).toBe(201);

    expect((await emettre(h, contract.id, { lastMonthMode: "PRORATA" })).status).toBe(201);
    expect((await emettre(h, contract.id, { exitDate: "2025-02-20" })).status).toBe(201);

    await testDb.update(invoices).set({ status: "PAID", amountPaid: 500 }).where(eq(invoices.contractId, contract.id));
    expect((await emettre(h, contract.id)).status).toBe(201);
    expect(await testDb.select().from(leaseSettlements).where(eq(leaseSettlements.contractId, contract.id))).toHaveLength(4);
  });

  it("permet de réémettre un solde identique passé 24 heures", async () => {
    const { contract, h } = await agence();
    const premier = await emettre(h, contract.id);
    expect(premier.status).toBe(201);
    await testDb
      .update(leaseSettlements)
      .set({ createdAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(eq(leaseSettlements.id, premier.body.id));

    expect((await emettre(h, contract.id)).status).toBe(201);
  });

  it("ne compare pas avec le solde d'un autre bail", async () => {
    const a = await agence();
    const b = await agence();
    expect((await emettre(a.h, a.contract.id)).status).toBe(201);
    expect((await emettre(b.h, b.contract.id)).status).toBe(201);
  });
});
