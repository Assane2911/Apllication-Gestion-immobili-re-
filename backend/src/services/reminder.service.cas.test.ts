import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activityLogs, contractCotenants, invoices } from "../db/schema";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import * as emailService from "./email.service";
import { runRentDueReminders, runUpcomingRentDueReminders, sendSingleInvoiceReminder } from "./reminder.service";
import * as whatsappService from "./whatsapp.service";

/**
 * Rappels de loyer : cas limites des trois chemins d'envoi (avis du mois, rappel avant échéance, rappel manuel).
 * Un rappel manuel ne vise que les factures de SON agence ; une devise vide retombe sur l'euro ; un échec WhatsApp
 * sans motif connu est consigné sous « erreur_api » plutôt qu'avec une valeur vide.
 */

let courriel: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 7, 1)); // 1er août 2026
  courriel = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false } as never);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const sansEspaces = (s: string) => s.split(" ").join("").split(" ").join("").split(" ").join("");
const journal = (managerId: string) => testDb.select().from(activityLogs).where(and(eq(activityLogs.managerId, managerId), eq(activityLogs.action, "reminder.whatsapp_failed")));
const echecSansMotif = () => vi.spyOn(whatsappService, "envoyerMessageWhatsapp").mockResolvedValue({ simulated: false, error: true } as never);

async function agence(plan: "ENTERPRISE" | "STARTER" = "ENTERPRISE") {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: plan });
  const property = await createProperty(manager.id, { title: "Villa Ngor" });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow", phone: "+221770000001" });
  const contract = await createContract(property.id, tenant.id, { startDate: new Date(2026, 7, 1), endDate: new Date(2027, 7, 1) });
  return { manager, property, tenant, contract };
}

describe("sendSingleInvoiceReminder : qui peut déclencher un rappel", () => {
  it("une facture inconnue est refusée (INVOICE_NOT_FOUND), rien n'est envoyé", async () => {
    const { manager } = await agence();

    await expect(sendSingleInvoiceReminder("facture-inexistante", manager.id)).rejects.toMatchObject({ statusCode: 404, code: "INVOICE_NOT_FOUND" });
    expect(courriel).not.toHaveBeenCalled();
  });

  it("la facture d'une AUTRE agence est refusée comme inconnue : pas d'envoi, facture non marquée", async () => {
    const { contract } = await agence();
    const intrus = await createManager();
    const facture = await createInvoice(contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING", dueDate: new Date(2026, 7, 20) });

    await expect(sendSingleInvoiceReminder(facture.id, intrus.id)).rejects.toMatchObject({ statusCode: 404, code: "INVOICE_NOT_FOUND" });

    expect(courriel).not.toHaveBeenCalled();
    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, facture.id));
    expect(apres.reminderSentAt).toBeNull();
  });
});

describe("devise vide : le montant est annoncé en euros", () => {
  const html = () => sansEspaces(String(courriel.mock.calls[0][2]));

  it("rappel manuel", async () => {
    const { manager, contract } = await agence();
    const facture = await createInvoice(contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING", amount: 500, dueDate: new Date(2026, 7, 20), currency: "" });

    const res = await sendSingleInvoiceReminder(facture.id, manager.id);

    expect(res.success).toBe(true);
    expect(html()).toContain("500€");
  });

  it("avis d'échéance du mois", async () => {
    const { contract } = await agence();
    await createInvoice(contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING", amount: 500, dueDate: new Date(2026, 7, 20), currency: "" });

    const res = await runRentDueReminders();

    expect(res.sent).toBe(1);
    expect(html()).toContain("500€");
  });

  it("rappel avant échéance", async () => {
    const { contract } = await agence();
    await createInvoice(contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING", amount: 500, dueDate: new Date(2026, 7, 4), currency: "" });

    const res = await runUpcomingRentDueReminders();

    expect(res.sent).toBe(1);
    expect(html()).toContain("500€");
  });
});

describe("échec WhatsApp sans motif connu : consigné sous « erreur_api »", () => {
  it("rappel manuel : l'email part, le journal dit que WhatsApp n'a pas été délivré", async () => {
    const { manager, contract } = await agence();
    const facture = await createInvoice(contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING", dueDate: new Date(2026, 7, 20) });
    echecSansMotif();

    const res = await sendSingleInvoiceReminder(facture.id, manager.id);

    expect(res.success).toBe(true);
    expect(res.whatsappError).toBe(true);
    const lignes = await journal(manager.id);
    expect(lignes).toHaveLength(1);
    expect(lignes[0].details).toContain("(erreur_api)");
    expect(lignes[0].details).toContain("l'email, lui, est bien parti");
  });

  it("avis d'échéance du mois", async () => {
    const { manager, contract } = await agence();
    await createInvoice(contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING", dueDate: new Date(2026, 7, 20) });
    echecSansMotif();

    const res = await runRentDueReminders();

    expect(res.sent).toBe(1);
    const lignes = await journal(manager.id);
    expect(lignes).toHaveLength(1);
    expect(lignes[0].details).toContain("dernier motif : erreur_api");
  });

  it("rappel avant échéance", async () => {
    const { manager, contract } = await agence();
    await createInvoice(contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING", dueDate: new Date(2026, 7, 4) });
    echecSansMotif();

    const res = await runUpcomingRentDueReminders();

    expect(res.sent).toBe(1);
    const lignes = await journal(manager.id);
    expect(lignes).toHaveLength(1);
    expect(lignes[0].details).toContain("dernier motif : erreur_api");
  });

  it("copies aux colocataires du rappel manuel", async () => {
    const { manager, contract } = await agence();
    const coloc = await createTenant(manager.id, { firstName: "Binta", lastName: "Kane", phone: "+221770000002" });
    await testDb.insert(contractCotenants).values({ contractId: contract.id, tenantId: coloc.id });
    const facture = await createInvoice(contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING", dueDate: new Date(2026, 7, 20) });
    echecSansMotif();

    await sendSingleInvoiceReminder(facture.id, manager.id);

    const details = (await journal(manager.id)).map((l: { details: string | null }) => l.details ?? "");
    expect(details.some((d: string) => d.includes("copie(s) WhatsApp aux colocataires non délivrée(s) (erreur_api)"))).toBe(true);
  });

  it("sous la formule Starter, aucun échec WhatsApp n'est consigné (WhatsApp n'est pas tenté)", async () => {
    const { manager, contract } = await agence("STARTER");
    const facture = await createInvoice(contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING", dueDate: new Date(2026, 7, 20) });
    const whatsapp = echecSansMotif();

    const res = await sendSingleInvoiceReminder(facture.id, manager.id);

    expect(res.success).toBe(true);
    expect(whatsapp).not.toHaveBeenCalled();
    expect(await journal(manager.id)).toEqual([]);
  });
});
