import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { runRentDueReminders } from "../services/reminder.service";
import * as emailService from "../services/email.service";
import { authHeader, createContract, createInvoice, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";

/**
 * Audit du compte gestionnaire, défaut n°4 : le jour d'échéance était
 * incohérent. La facture est due le jour du début du bail, mais les emails et
 * le bail disaient « avant le 5 » : un locataire dont le bail démarre le 24
 * lisait « payez avant le 5 » pour un loyer dû le 24.
 */
let envoi: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T08:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function bailAuJour(jour: number) {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO" });
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id, { email: "awa@test.local" });
  const contract = await createContract(property.id, tenant.id, {
    status: "ACTIVE",
    startDate: new Date(2026, 0, jour),
    endDate: new Date(2027, 11, 31),
  });
  return { manager, contract };
}

describe("avis d'échéance par email", () => {
  it.each([5, 24, 29])("annonce la vraie date limite d'un bail démarré le %i", async (jour) => {
    const { contract } = await bailAuJour(jour);
    await createInvoice(contract.id, {
      status: "PENDING", periodMonth: 10, periodYear: 2026, amount: 500,
      dueDate: new Date(2026, 9, jour),
    });

    await runRentDueReminders();

    const mail = envoi.mock.calls.find((c: unknown[]) => c[0] === "awa@test.local") as [string, string, string] | undefined;
    expect(mail).toBeDefined();
    const attendu = `${jour} octobre 2026`;
    expect(mail![1]).toContain(`au plus tard le ${attendu}`);
    expect(mail![2]).toContain(`au plus tard le ${attendu}`);
    if (jour !== 5) {
      expect(mail![1]).not.toMatch(/avant le 5\b/);
      expect(mail![2]).not.toMatch(/le 5 octobre/);
    }
  });
});

describe("bail PDF", () => {
  it.each([
    [24, "payable mensuellement au plus tard le 24 de chaque mois"],
    [5, "payable mensuellement au plus tard le 5 de chaque mois"],
    [31, "ou le dernier jour du mois lorsque celui-ci est plus court"],
  ])("un bail démarré le %i dit « %s »", async (jour, phrase) => {
    const { manager, contract } = await bailAuJour(jour);
    const res = await request(app).get(`/api/documents/lease/${contract.id}`).set(authHeader(tokenFor(manager)));
    expect(res.status).toBe(200);
    expect(res.text).toContain(phrase);
    expect(res.text).not.toContain("avant le 5)");
  });
});
