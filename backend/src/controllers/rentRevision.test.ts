import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { activityLogs, contractCotenants, contracts, invoices, rentRevisions } from "../db/schema";
import * as emailService from "../services/email.service";
import { runRentDueReminders } from "../services/reminder.service";
import { generateLeaseHtml } from "../services/pdf.service";
import { appliquerRevisionsDues, calculerNouveauLoyer } from "../services/rentRevision.service";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createProperty,
  createTeamMember,
  createTenant,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Révision annuelle du loyer : le gestionnaire fixe un nouveau loyer (montant, pourcentage ou
 * indice) à partir d'un premier de mois. Le contrat et les factures impayées suivent ; un mois
 * déjà encaissé ne se réécrit pas ; le bail PDF garde le loyer signé.
 */
let envoi: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T09:00:00Z"));
  envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function agence() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
  const property = await createProperty(manager.id, { title: "Studio A" });
  const tenant = await createTenant(manager.id, { email: "locataire@example.com", firstName: "Awa", lastName: "Ndiaye" });
  const contract = await createContract(property.id, tenant.id, {
    rent: 500,
    startDate: new Date("2026-01-01T00:00:00Z"),
    endDate: new Date("2027-12-31T00:00:00Z"),
  });
  return { manager, h: authHeader(tokenFor(manager)), property, tenant, contract };
}

const reviser = (h: Record<string, string>, id: string, corps: Record<string, unknown>) => request(app).post(`/api/contracts/${id}/rent-revisions`).set(h).send(corps);
const loyerDe = async (id: string) => (await testDb.select().from(contracts).where(eq(contracts.id, id)))[0].rent as number;
const revisionsDe = (id: string) => testDb.select().from(rentRevisions).where(eq(rentRevisions.contractId, id));

describe("calculerNouveauLoyer", () => {
  it("calcule un montant, un pourcentage et un rapport d'indice, arrondis au centime", () => {
    expect(calculerNouveauLoyer(500, { mode: "AMOUNT", newRent: 520 })).toBe(520);
    expect(calculerNouveauLoyer(500, { mode: "PERCENT", percent: 3 })).toBe(515);
    expect(calculerNouveauLoyer(333.33, { mode: "PERCENT", percent: 2.5 })).toBe(341.66);
    expect(calculerNouveauLoyer(500, { mode: "INDEX", indexOld: 142.06, indexNew: 144 })).toBe(506.83);
    expect(calculerNouveauLoyer(500, { mode: "PERCENT", percent: -10 })).toBe(450);
  });

  it("refuse un loyer identique, nul, un pourcentage absurde et un indice invalide", () => {
    expect(() => calculerNouveauLoyer(500, { mode: "AMOUNT", newRent: 500 })).toThrow("identique");
    expect(() => calculerNouveauLoyer(500, { mode: "PERCENT", percent: 0 })).toThrow("identique");
    expect(() => calculerNouveauLoyer(500, { mode: "PERCENT", percent: 150 })).toThrow("compris entre");
    expect(() => calculerNouveauLoyer(500, { mode: "PERCENT", percent: -60 })).toThrow("compris entre");
    expect(() => calculerNouveauLoyer(500, { mode: "INDEX", indexOld: 0, indexNew: 145 })).toThrow("positives");
    expect(() => calculerNouveauLoyer(500, { mode: "INDEX", indexOld: 142, indexNew: -1 })).toThrow("positives");
  });
});

describe("révision à effet immédiat (mois en cours)", () => {
  it("modifie le loyer du bail, recalcule la facture impayée du mois et journalise", async () => {
    const { manager, h, contract } = await agence();
    const octobre = await createInvoice(contract.id, { periodMonth: 10, periodYear: 2026, amount: 500, status: "PENDING", dueDate: new Date("2026-10-20T00:00:00Z") });
    const septembre = await createInvoice(contract.id, { periodMonth: 9, periodYear: 2026, amount: 500, status: "PAID", dueDate: new Date("2026-09-05T00:00:00Z"), amountPaid: 500 });

    const res = await reviser(h, contract.id, { mode: "PERCENT", percent: 3, effectiveDate: "2026-10-01" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ appliquee: true, facturesRecalculees: 1, previousRent: 500, newRent: 515, status: "APPLIED", method: "PERCENT", percent: 3 });
    expect(await loyerDe(contract.id)).toBe(515);
    const [oct] = await testDb.select().from(invoices).where(eq(invoices.id, octobre.id));
    const [sept] = await testDb.select().from(invoices).where(eq(invoices.id, septembre.id));
    expect(oct.amount).toBe(515);
    // Un mois antérieur à la date d'effet ne bouge jamais.
    expect(sept.amount).toBe(500);
    const journal = await testDb.select().from(activityLogs).where(eq(activityLogs.managerId, manager.id));
    expect(journal.some((l: { action: string; details: string | null }) => l.action === "contract.rent_revision" && l.details?.includes("500"))).toBe(true);
  });

  it("recalcule au prorata un dernier mois partiel", async () => {
    const { h, property, tenant } = await agence();
    const bail = await createContract(property.id, tenant.id, { rent: 600, startDate: new Date("2026-02-01T00:00:00Z"), endDate: new Date("2026-10-15T00:00:00Z"), status: "ACTIVE" });
    // Chevauche le bail du helper : on désactive l'autre pour ce test.
    await testDb.update(contracts).set({ status: "ENDED" }).where(eq(contracts.propertyId, property.id));
    await testDb.update(contracts).set({ status: "ACTIVE" }).where(eq(contracts.id, bail.id));
    const factureOct = await createInvoice(bail.id, { periodMonth: 10, periodYear: 2026, amount: 300, status: "PENDING", dueDate: new Date("2026-10-20T00:00:00Z") });

    await reviser(h, bail.id, { mode: "AMOUNT", newRent: 660, effectiveDate: "2026-10-01" });

    const [f] = await testDb.select().from(invoices).where(eq(invoices.id, factureOct.id));
    expect(f.amount).toBe(330); // 15 jours sur 31 du nouveau loyer, dans la même proportion qu'avant
  });
});

describe("révision programmée", () => {
  it("reste en attente, puis le cron l'applique à sa date et la facture du mois porte le nouveau loyer", async () => {
    const { manager, h, contract } = await agence();
    const res = await reviser(h, contract.id, { mode: "INDEX", indexName: "IRL", indexOld: 142.06, indexNew: 144, effectiveDate: "2026-12-01", note: "Révision annuelle" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ appliquee: false, status: "PENDING", newRent: 506.83, indexName: "IRL" });
    expect(await loyerDe(contract.id)).toBe(500);

    // Avant la date : rien.
    expect(await appliquerRevisionsDues(new Date("2026-11-30T08:00:00Z"))).toEqual({ appliquees: 0, annulees: 0 });
    expect(await loyerDe(contract.id)).toBe(500);

    // Le 1er décembre, le cron applique AVANT de générer les factures du mois.
    vi.setSystemTime(new Date("2026-12-01T08:00:00Z"));
    await runRentDueReminders(manager.id);
    expect(await loyerDe(contract.id)).toBe(506.83);
    const [decembre] = await testDb.select().from(invoices).where(eq(invoices.contractId, contract.id)).then((l: Array<{ periodMonth: number; amount: number }>) => l.filter((f) => f.periodMonth === 12));
    expect(decembre.amount).toBe(506.83);
    const [rev] = await revisionsDe(contract.id);
    expect(rev.status).toBe("APPLIED");
    expect(rev.appliedAt).not.toBeNull();

    // Rejouer le cron ne réapplique rien.
    expect(await appliquerRevisionsDues(new Date("2026-12-02T08:00:00Z"))).toEqual({ appliquees: 0, annulees: 0 });
  });

  it("deux exécutions simultanées du cron n'appliquent la révision qu'une fois", async () => {
    const { h, contract } = await agence();
    await reviser(h, contract.id, { mode: "AMOUNT", newRent: 540, effectiveDate: "2026-11-01" });
    const dates = new Date("2026-11-02T08:00:00Z");
    const [a, b] = await Promise.all([appliquerRevisionsDues(dates), appliquerRevisionsDues(dates)]);
    expect(a.appliquees + b.appliquees).toBe(1);
    expect(await loyerDe(contract.id)).toBe(540);
  });

  it("annule la révision si le bail s'est terminé avant sa date d'effet", async () => {
    const { h, contract } = await agence();
    await reviser(h, contract.id, { mode: "AMOUNT", newRent: 540, effectiveDate: "2026-11-01" });
    await testDb.update(contracts).set({ status: "TERMINATED" }).where(eq(contracts.id, contract.id));

    expect(await appliquerRevisionsDues(new Date("2026-11-02T08:00:00Z"))).toEqual({ appliquees: 0, annulees: 1 });
    expect(await loyerDe(contract.id)).toBe(500);
    expect((await revisionsDe(contract.id))[0].status).toBe("CANCELLED");
  });

  it("le gestionnaire peut annuler une révision programmée, pas une révision déjà appliquée", async () => {
    const { h, contract } = await agence();
    const programmee = await reviser(h, contract.id, { mode: "AMOUNT", newRent: 540, effectiveDate: "2026-11-01" });
    expect((await request(app).delete(`/api/contracts/${contract.id}/rent-revisions/${programmee.body.id}`).set(h)).status).toBe(204);
    expect((await revisionsDe(contract.id))[0].status).toBe("CANCELLED");
    expect((await request(app).delete(`/api/contracts/${contract.id}/rent-revisions/${programmee.body.id}`).set(h)).status).toBe(409);

    const appliquee = await reviser(h, contract.id, { mode: "AMOUNT", newRent: 560, effectiveDate: "2026-10-01" });
    const refus = await request(app).delete(`/api/contracts/${contract.id}/rent-revisions/${appliquee.body.id}`).set(h);
    expect(refus.status).toBe(409);
    expect(refus.body.error).toContain("déjà appliquée");
    expect(await loyerDe(contract.id)).toBe(560);
  });
});

describe("refus", () => {
  it("date d'effet : premier de mois, jamais dans le passé, après le début et avant la fin du bail", async () => {
    const { h, contract } = await agence();
    const cas: Array<[string, string]> = [
      ["2026-11-15", "premier jour"],
      ["2026-09-01", "passé"],
      ["2026-01-01", "passé"],
      ["2028-02-01", "fin du bail"],
    ];
    for (const [date, attendu] of cas) {
      const res = await reviser(h, contract.id, { mode: "AMOUNT", newRent: 540, effectiveDate: date });
      expect(res.status, date).toBe(400);
      expect(res.body.error, date).toContain(attendu);
    }
    expect(await revisionsDe(contract.id)).toHaveLength(0);
  });

  it("un mois déjà encaissé (même en partie) à partir de la date d'effet refuse la révision", async () => {
    const { h, contract } = await agence();
    await createInvoice(contract.id, { periodMonth: 10, periodYear: 2026, amount: 500, status: "PENDING", amountPaid: 200, dueDate: new Date("2026-10-05T00:00:00Z") });
    const res = await reviser(h, contract.id, { mode: "AMOUNT", newRent: 540, effectiveDate: "2026-10-01" });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("10/2026");
    expect(await loyerDe(contract.id)).toBe(500);
    // Le mois suivant, en revanche, est possible.
    expect((await reviser(h, contract.id, { mode: "AMOUNT", newRent: 540, effectiveDate: "2026-11-01" })).status).toBe(201);
  });

  it("une seule révision programmée à la fois, et seulement sur un bail actif", async () => {
    const { h, contract } = await agence();
    expect((await reviser(h, contract.id, { mode: "AMOUNT", newRent: 540, effectiveDate: "2026-11-01" })).status).toBe(201);
    const deuxieme = await reviser(h, contract.id, { mode: "AMOUNT", newRent: 560, effectiveDate: "2026-12-01" });
    expect(deuxieme.status).toBe(409);
    expect(deuxieme.body.error).toContain("déjà programmée");

    await testDb.update(contracts).set({ status: "ENDED" }).where(eq(contracts.id, contract.id));
    expect((await reviser(h, contract.id, { mode: "AMOUNT", newRent: 560, effectiveDate: "2026-12-01" })).status).toBe(409);
  });

  it("deux demandes simultanées : une seule passe", async () => {
    const { h, contract } = await agence();
    const [a, b] = await Promise.all([
      reviser(h, contract.id, { mode: "AMOUNT", newRent: 540, effectiveDate: "2026-11-01" }),
      reviser(h, contract.id, { mode: "AMOUNT", newRent: 560, effectiveDate: "2026-11-01" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await revisionsDe(contract.id)).toHaveLength(1);
  });

  it("valide la saisie : champ du mode manquant, note trop longue", async () => {
    const { h, contract } = await agence();
    expect((await reviser(h, contract.id, { mode: "PERCENT", effectiveDate: "2026-11-01" })).status).toBe(400);
    expect((await reviser(h, contract.id, { mode: "INDEX", indexOld: 140, effectiveDate: "2026-11-01" })).status).toBe(400);
    expect((await reviser(h, contract.id, { mode: "AMOUNT", effectiveDate: "2026-11-01" })).status).toBe(400);
    expect((await reviser(h, contract.id, { mode: "AMOUNT", newRent: 540, effectiveDate: "2026-11-01", note: "x".repeat(1001) })).status).toBe(400);
  });

  it("isole les agences : le bail d'une autre agence est introuvable", async () => {
    const { contract } = await agence();
    const autre = await createManager({ subscriptionStatus: "ACTIVE" });
    const h = authHeader(tokenFor(autre));
    expect((await reviser(h, contract.id, { mode: "AMOUNT", newRent: 540, effectiveDate: "2026-11-01" })).status).toBe(404);
    expect((await request(app).get(`/api/contracts/${contract.id}/rent-revisions`).set(h)).status).toBe(404);
  });

  it("un locataire n'a pas accès aux révisions", async () => {
    const { contract } = await agence();
    const res = await request(app).get(`/api/contracts/${contract.id}/rent-revisions`);
    expect(res.status).toBe(401);
  });
});

describe("information du locataire", () => {
  it("prévient le locataire par email quand le gestionnaire le demande", async () => {
    const { h, contract } = await agence();
    const res = await reviser(h, contract.id, { mode: "PERCENT", percent: 3, effectiveDate: "2026-12-01", notifyTenant: true, note: "Indexation annuelle" });

    expect(res.body.emailEnvoye).toBe(true);
    expect(envoi).toHaveBeenCalledTimes(1);
    const [destinataire, sujet, html] = envoi.mock.calls[0] as [string, string, string];
    expect(destinataire).toBe("locataire@example.com");
    expect(sujet).toContain("1 décembre 2026");
    expect(html).toContain("515");
    expect(html).toContain("+3 %");
    expect(html).toContain("Indexation annuelle");
    expect((await revisionsDe(contract.id))[0].tenantNotifiedAt).not.toBeNull();
  });

  it("prévient aussi les colocataires, chacun à son nom", async () => {
    // Le nouveau loyer s'applique à tous les occupants du bail : seul le titulaire en était informé.
    const { h, manager, contract } = await agence();
    const coloc = await createTenant(manager.id, { email: "binta@example.com", firstName: "Binta", lastName: "Kane" });
    await testDb.insert(contractCotenants).values({ contractId: contract.id, tenantId: coloc.id });

    const res = await reviser(h, contract.id, { mode: "PERCENT", percent: 3, effectiveDate: "2026-12-01", notifyTenant: true });

    expect(res.body.emailEnvoye).toBe(true);
    const destinataires = envoi.mock.calls.map((c: unknown[]) => c[0]);
    expect(destinataires).toEqual(["locataire@example.com", "binta@example.com"]);
    expect(envoi.mock.calls[1][2] as string).toContain("Binta Kane");
    expect(envoi.mock.calls[1][2] as string).not.toContain("Awa Ndiaye");
  });

  it("n'envoie rien par défaut, et un échec d'envoi ne défait pas la révision", async () => {
    const { h, contract } = await agence();
    expect((await reviser(h, contract.id, { mode: "AMOUNT", newRent: 540, effectiveDate: "2026-11-01" })).body.emailEnvoye).toBe(false);
    expect(envoi).not.toHaveBeenCalled();

    await testDb.delete(rentRevisions);
    envoi.mockRejectedValueOnce(new Error("SMTP en panne"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await reviser(h, contract.id, { mode: "AMOUNT", newRent: 560, effectiveDate: "2026-11-01", notifyTenant: true });
    expect(res.status).toBe(201);
    expect(res.body.emailEnvoye).toBe(false);
    expect((await revisionsDe(contract.id))[0].tenantNotifiedAt).toBeNull();
  });
});

describe("équipe", () => {
  it("un agent peut réviser un loyer mais pas annuler une révision ; un comptable ne peut ni l'un ni l'autre", async () => {
    const { manager, contract } = await agence();
    const agent = await createTeamMember(manager.id, { teamRole: "AGENT" });
    const comptable = await createTeamMember(manager.id, { teamRole: "ACCOUNTANT" });
    const hAgent = authHeader(tokenFor({ id: manager.id, role: "MANAGER" }, null, null, agent.id));
    const hCompta = authHeader(tokenFor({ id: manager.id, role: "MANAGER" }, null, null, comptable.id));

    expect((await reviser(hCompta, contract.id, { mode: "AMOUNT", newRent: 540, effectiveDate: "2026-11-01" })).status).toBe(403);
    const creee = await reviser(hAgent, contract.id, { mode: "AMOUNT", newRent: 540, effectiveDate: "2026-11-01" });
    expect(creee.status).toBe(201);
    expect((await request(app).delete(`/api/contracts/${contract.id}/rent-revisions/${creee.body.id}`).set(hAgent)).status).toBe(403);
    expect((await request(app).get(`/api/contracts/${contract.id}/rent-revisions`).set(hCompta)).status).toBe(200);
  });
});

describe("bail PDF", () => {
  const base = {
    startDate: new Date("2026-01-01"), endDate: new Date("2027-01-01"), rent: 515, currency: "EUR", deposit: 1000,
    signedByManagerAt: null, managerSignatureUrl: null, signedByTenantAt: null, tenantSignatureUrl: null,
    property: { title: "Studio A", address: "1 rue X", surface: 30 }, tenant: { firstName: "Awa", lastName: "Ndiaye", email: "a@x.com", phone: "+221770000000" },
  };

  it("garde le loyer signé et liste chaque révision avec sa date d'effet", () => {
    const html = generateLeaseHtml(
      { ...base, revisions: [{ effectiveDate: new Date("2026-10-01T00:00:00Z"), previousRent: 500, newRent: 515 }] },
      { agencyName: "Agence" }
    );
    expect(html).toContain("Loyer mensuel à la signature");
    expect(html).toMatch(/500/);
    expect(html).toContain("Révision à compter du 01/10/2026");
    expect(html).toContain("Loyer mensuel en vigueur");
  });

  it("sans révision, le bail est inchangé : une seule ligne de loyer", () => {
    const html = generateLeaseHtml({ ...base, revisions: [] }, { agencyName: "Agence" });
    expect(html).toContain("Loyer mensuel :");
    expect(html).not.toContain("à la signature");
    expect(html).not.toContain("Révision à compter");
  });

  it("l'API du bail affiche le loyer signé et la révision appliquée", async () => {
    const { h, contract } = await agence();
    await reviser(h, contract.id, { mode: "AMOUNT", newRent: 520, effectiveDate: "2026-10-01" });
    const res = await request(app).get(`/api/documents/lease/${contract.id}`).set(h);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Loyer mensuel à la signature");
    expect(res.text).toContain("Révision à compter du 01/10/2026");
  });
});
