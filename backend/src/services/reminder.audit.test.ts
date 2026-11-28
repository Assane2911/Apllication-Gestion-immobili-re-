import cron from "node-cron";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import { activityLogs, agencySettings, contractCotenants, contracts, insurancePolicies, invoices, storedDocuments } from "../db/schema";
import { createContract, createInsurancePolicy, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import type { BudgetTemps } from "../utils/budgetTemps";
import * as emailService from "./email.service";
import { runSubscriptionExpiryNotices } from "./finAcces.service";
import { oublierAdressesDeReponse } from "./reponseAgence.service";
import * as rentRevisionService from "./rentRevision.service";
import { runContractEndingReminders, runInsurancePolicyExpiryReminders, runRentDueReminders, runStoredDocumentExpiryReminders, runUpcomingRentDueReminders, scheduleContractEndingReminders, sendSingleInvoiceReminder } from "./reminder.service";
import * as whatsappService from "./whatsapp.service";

vi.mock("./finAcces.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./finAcces.service")>()),
  runSubscriptionExpiryNotices: vi.fn(async () => ({})),
}));

/**
 * Audit par sabotage de reminder.service.ts : ce que les tests existants ne vérifiaient pas dans les cinq tâches planifiées
 * et le rappel manuel — les bornes de chaque fenêtre, qui est exclu (bail fini, locataire effacé, déjà rappelé, formule
 * Starter), ce qui est écrit au gestionnaire et au locataire (montant restant dû, devise, jours restants, date, assureur),
 * le marqueur relâché sur LA SEULE ligne en échec, le journal des échecs WhatsApp, et quelle tâche chaque horaire déclenche.
 *
 * Toutes les dates sont celles du 10 août 2026, 8 h.
 */
const REGLAGES = { ...env.reminder };
const MAINTENANT = new Date(2026, 7, 10, 8, 0, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MAINTENANT);
  oublierAdressesDeReponse();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false });
  vi.spyOn(whatsappService, "envoyerMessageWhatsapp").mockResolvedValue({ simulated: false });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.assign(env.reminder, REGLAGES);
});

type AppelEmail = [string, string, string, unknown, { replyTo?: string }?];
const courriels = () => vi.mocked(emailService.sendEmail).mock.calls as unknown as AppelEmail[];
const destinataires = () => courriels().map((c) => c[0]).sort();
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const textesVers = (adresse: string) => courriels().filter((c) => c[0] === adresse).map((c) => texte(c[2]));
type AppelWhatsapp = [string, string, Record<string, string>, unknown];
const messages = () => vi.mocked(whatsappService.envoyerMessageWhatsapp).mock.calls as unknown as AppelWhatsapp[];
const messagesVers = (telephone: string) => messages().filter((m) => m[0] === telephone);

const emailEnEchecPour = (...adresses: string[]) =>
  vi.spyOn(emailService, "sendEmail").mockImplementation((async (a: string) => (adresses.includes(a) ? { simulated: false, error: true } : { simulated: false })) as never);
const whatsappEnEchecPour = (...telephones: string[]) =>
  vi.spyOn(whatsappService, "envoyerMessageWhatsapp").mockImplementation((async (t: string) => (telephones.includes(t) ? { simulated: false, error: true, raison: "numero_invalide" } : { simulated: false })) as never);

const epuise: BudgetTemps = { epuise: () => true, restant: () => 0 };

const journalWhatsapp = async (managerId: string) => (await testDb.select().from(activityLogs).where(eq(activityLogs.managerId, managerId))).filter((l: typeof activityLogs.$inferSelect) => l.action === "reminder.whatsapp_failed");
const jour = (decalage: number, h = 0, min = 0) => new Date(2026, 7, 10 + decalage, h, min);

let compteur = 0;
/** Un gestionnaire (essai : formule effective Pro), son bien, un locataire et son bail commencé en août 2026. */
async function agence(options: { starter?: boolean; nom?: string; telephone?: string; bail?: Partial<typeof contracts.$inferInsert> } = {}) {
  const n = ++compteur;
  const manager = options.starter ? await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "STARTER" }) : await createManager();
  const property = await createProperty(manager.id, { title: options.nom ?? "Villa Ngor" });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow", email: `awa${n}@example.com`, phone: options.telephone ?? `+22177001${String(n).padStart(4, "0")}` });
  const contract = await createContract(property.id, tenant.id, { startDate: new Date(2026, 7, 1), endDate: new Date(2027, 7, 1), ...options.bail });
  return { manager, property, tenant, contract };
}
async function locataireEnPlus(managerId: string, propertyTitle: string, options: { email?: string; phone?: string; bail?: Partial<typeof contracts.$inferInsert>; tenant?: Partial<typeof import("../db/schema").tenants.$inferInsert> } = {}) {
  const n = ++compteur;
  const property = await createProperty(managerId, { title: propertyTitle });
  const tenant = await createTenant(managerId, { firstName: "Loc", lastName: propertyTitle, email: options.email ?? `loc${n}@example.com`, phone: options.phone ?? `+22177002${String(n).padStart(4, "0")}`, ...options.tenant });
  const contract = await createContract(property.id, tenant.id, { startDate: new Date(2026, 7, 1), endDate: new Date(2027, 7, 1), ...options.bail });
  return { property, tenant, contract };
}
async function colocataire(managerId: string, contractId: string, email: string, phone: string) {
  const coloc = await createTenant(managerId, { firstName: "Binta", lastName: "Kane", email, phone });
  await testDb.insert(contractCotenants).values({ contractId, tenantId: coloc.id });
  return coloc;
}
const marqueur = async (table: typeof contracts | typeof insurancePolicies | typeof storedDocuments | typeof invoices, id: string, colonne = "reminderSentAt") => {
  const [ligne] = await testDb.select().from(table).where(eq((table as typeof contracts).id, id));
  return ligne[colonne] as Date | null;
};

const MISE_A_JOUR_REELLE = testDb.update.bind(testDb);
/** Fait arriver un changement dans la base JUSTE avant l'écriture de la première réclamation : une autre exécution est passée avant. */
function avantReclamation(action: () => Promise<unknown>) {
  const reel = MISE_A_JOUR_REELLE;
  let fait = false;
  vi.spyOn(testDb, "update").mockImplementation((table: unknown) => {
    const constructeur = reel(table);
    if (fait) return constructeur;
    fait = true;
    return {
      set: (valeurs: unknown) => {
        const etape = constructeur.set(valeurs);
        return {
          where: (condition: unknown) => {
            const ecriture = etape.where(condition);
            return { returning: (...args: unknown[]) => ({ then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => action().then(() => ecriture.returning(...args)).then(ok, ko) }) };
          },
        };
      },
    };
  });
}

describe("journal des échecs WhatsApp : décompte, libellé et accords", () => {
  async function agenceAvecColocs(nbColocs: number) {
    const { manager, contract, tenant } = await agence({ bail: { startDate: new Date(2026, 7, 1) } });
    const phones: string[] = [];
    for (let j = 0; j < nbColocs; j++) {
      const phone = `+22177009${compteur}${j}`;
      phones.push(phone);
      await colocataire(manager.id, contract.id, `coloc${compteur}${j}@example.com`, phone);
    }
    return { manager, tenant, phones };
  }

  it.each([
    [1, "1 message WhatsApp non délivré (avis d'échéance du mois)"],
    [2, "2 messages WhatsApp non délivrés (avis d'échéance du mois)"],
  ])("%i copie(s) non délivrée(s) : le journal accorde « message » et « délivré »", async (nb, attendu) => {
    const { manager, phones } = await agenceAvecColocs(nb);
    whatsappEnEchecPour(...phones);

    const res = await runRentDueReminders();

    expect(res.whatsappEchecs).toBe(nb);
    const [ligne] = await journalWhatsapp(manager.id);
    expect(ligne.details).toContain(attendu);
    expect(ligne).toMatchObject({ entityType: "reminder", entityLabel: "avis d'échéance du mois" });
  });

  it("les échecs de plusieurs baux du même gestionnaire s'ADDITIONNENT en une seule ligne de journal", async () => {
    const { manager, phones } = await agenceAvecColocs(2);
    const autre = await locataireEnPlus(manager.id, "Villa Mamelles");
    const phoneAutre = `+22177008${compteur}0`;
    await colocataire(manager.id, autre.contract.id, `coloc-autre${compteur}@example.com`, phoneAutre);
    whatsappEnEchecPour(...phones, phoneAutre);

    const res = await runRentDueReminders();

    expect(res.whatsappEchecs).toBe(3);
    const lignes = await journalWhatsapp(manager.id);
    expect(lignes).toHaveLength(1);
    expect(lignes[0].details).toContain("3 messages WhatsApp non délivrés (avis d'échéance du mois)");
  });
});

describe("rappel de fin de bail", () => {
  /** Un bail se terminant à la date donnée, d'un gestionnaire Pro (essai). */
  async function bailFinissantLe(fin: Date, options: Parameters<typeof agence>[0] = {}, locataire: Partial<typeof import("../db/schema").tenants.$inferInsert> = {}) {
    const base = await agence({ ...options, bail: { startDate: new Date(2025, 7, 1), endDate: fin, ...options.bail } });
    if (Object.keys(locataire).length > 0) await testDb.update((await import("../db/schema")).tenants).set(locataire).where(eq((await import("../db/schema")).tenants.id, base.tenant.id));
    return base;
  }

  it("la fenêtre va d'AUJOURD'HUI (dès minuit) à J+14 (jusqu'à 23 h 59) : hier et J+15 n'en font pas partie", async () => {
    const hier = await bailFinissantLe(jour(-1, 23));
    const aujourdhui = await bailFinissantLe(jour(0, 0));
    const dernierJour = await bailFinissantLe(jour(14, 12));
    const apres = await bailFinissantLe(jour(15, 0, 1));

    const res = await runContractEndingReminders();

    expect(res.sent).toBe(2);
    expect(await marqueur(contracts, aujourdhui.contract.id)).not.toBeNull();
    expect(await marqueur(contracts, dernierJour.contract.id)).not.toBeNull();
    expect(await marqueur(contracts, hier.contract.id)).toBeNull();
    expect(await marqueur(contracts, apres.contract.id)).toBeNull();
  });

  it("n'écrit ni pour un bail fini, ni pour un locataire effacé, ni pour un bail déjà rappelé, ni pour un gestionnaire Starter", async () => {
    const fini = await bailFinissantLe(jour(5), { bail: { status: "ENDED" } });
    const efface = await bailFinissantLe(jour(5), {}, { anonymizedAt: new Date() });
    const dejaRappele = await bailFinissantLe(jour(5), { bail: { reminderSentAt: new Date(2026, 7, 1) } });
    const starter = await bailFinissantLe(jour(5), { starter: true });
    const eligible = await bailFinissantLe(jour(5));

    const res = await runContractEndingReminders();

    expect(res.sent).toBe(1);
    expect(await marqueur(contracts, eligible.contract.id)).not.toBeNull();
    for (const exclu of [fini, efface, starter]) expect(await marqueur(contracts, exclu.contract.id)).toBeNull();
    expect((await testDb.select().from(contracts).where(eq(contracts.id, dejaRappele.contract.id)))[0].reminderSentAt).toEqual(new Date(2026, 7, 1));
  });

  it("deux baux éligibles reçoivent chacun leur rappel, avec la date de fin réelle de LEUR bail", async () => {
    const a = await bailFinissantLe(jour(5));
    const b = await bailFinissantLe(jour(9));

    const res = await runContractEndingReminders();

    expect(res.sent).toBe(2);
    expect(textesVers(a.manager.email).join(" ")).toContain("15 août 2026");
    expect(textesVers(b.manager.email).join(" ")).toContain("19 août 2026");
  });

  it("un e-mail en échec relâche le marqueur de CE bail seulement, sans toucher à celui des autres", async () => {
    const ok = await bailFinissantLe(jour(5));
    const ko = await bailFinissantLe(jour(6));
    emailEnEchecPour(ko.manager.email);

    const res = await runContractEndingReminders();

    expect(res).toMatchObject({ sent: 1, echecs: 1 });
    expect(await marqueur(contracts, ok.contract.id)).not.toBeNull();
    expect(await marqueur(contracts, ko.contract.id)).toBeNull();
  });

  it("le budget épuisé interrompt l'exécution : rien n'est réclamé ni envoyé, et l'appelant en est informé", async () => {
    const bail = await bailFinissantLe(jour(5));

    const res = await runContractEndingReminders(epuise);

    expect(res).toMatchObject({ sent: 0, interrompu: true });
    expect(await marqueur(contracts, bail.contract.id)).toBeNull();
  });
});

describe("rappel d'échéance d'assurance", () => {
  async function police(expiration: Date, options: Parameters<typeof agence>[0] = {}, valeurs: Partial<typeof insurancePolicies.$inferInsert> = {}) {
    const base = await agence(options);
    const policy = await createInsurancePolicy(base.property.id, { expiryDate: expiration, ...valeurs });
    return { ...base, policy };
  }

  it("fenêtre de 30 jours : hier et J+31 n'en font pas partie, aujourd'hui et J+30 oui", async () => {
    const hier = await police(jour(-1, 23));
    const aujourdhui = await police(jour(0, 0));
    const dernierJour = await police(jour(30, 12));
    const apres = await police(jour(31, 0, 1));

    const res = await runInsurancePolicyExpiryReminders();

    expect(res.sent).toBe(2);
    expect(await marqueur(insurancePolicies, aujourdhui.policy.id)).not.toBeNull();
    expect(await marqueur(insurancePolicies, dernierJour.policy.id)).not.toBeNull();
    expect(await marqueur(insurancePolicies, hier.policy.id)).toBeNull();
    expect(await marqueur(insurancePolicies, apres.policy.id)).toBeNull();
  });

  it("une police déjà signalée ne l'est pas deux fois ; l'e-mail nomme l'assureur, le numéro et les jours restants", async () => {
    const deja = await police(jour(10), {}, { reminderSentAt: new Date(2026, 7, 1) });
    const nouvelle = await police(jour(10), {}, { insurerName: "AXA", policyNumber: "POL-9" });

    const res = await runInsurancePolicyExpiryReminders();

    expect(res.sent).toBe(1);
    expect(destinataires()).toEqual([nouvelle.manager.email]);
    const mail = textesVers(nouvelle.manager.email)[0];
    expect(mail).toContain("POL-9");
    expect(mail).toContain("AXA");
    expect(mail).toContain("(dans 10 jours)");
    expect((await testDb.select().from(insurancePolicies).where(eq(insurancePolicies.id, deja.policy.id)))[0].reminderSentAt).toEqual(new Date(2026, 7, 1));
  });

  it("un e-mail en échec : l'échec est compté, le marqueur de CETTE police est relâché, celui des autres reste posé", async () => {
    const ok = await police(jour(10));
    const ko = await police(jour(11));
    emailEnEchecPour(ko.manager.email);

    const res = await runInsurancePolicyExpiryReminders();

    expect(res).toMatchObject({ sent: 1, echecs: 1 });
    expect(await marqueur(insurancePolicies, ok.policy.id)).not.toBeNull();
    expect(await marqueur(insurancePolicies, ko.policy.id)).toBeNull();
  });
});

describe("rappel d'expiration des documents rangés", () => {
  async function deposer(managerId: string, valeurs: Partial<typeof storedDocuments.$inferInsert>) {
    const [doc] = await testDb
      .insert(storedDocuments)
      .values({ managerId, title: "Diagnostic", category: "DIAGNOSTIC", filePath: "documents/x.pdf", fileName: "x.pdf", mimeType: "application/pdf", sizeBytes: 1000, ...valeurs })
      .returning();
    return doc;
  }

  it("la fenêtre est celle des DOCUMENTS (réglage propre), annoncée telle quelle dans l'e-mail", async () => {
    env.reminder.documentReminderDays = 10;
    const { manager, property } = await agence();
    const proche = await deposer(manager.id, { propertyId: property.id, title: "Proche", expiresAt: jour(8) });
    const loin = await deposer(manager.id, { propertyId: property.id, title: "Loin", expiresAt: jour(15) });

    const res = await runStoredDocumentExpiryReminders();

    expect(res.sent).toBe(1);
    expect(await marqueur(storedDocuments, proche.id)).not.toBeNull();
    expect(await marqueur(storedDocuments, loin.id)).toBeNull();
    const mail = textesVers(manager.email)[0];
    expect(mail).toContain("dans les 10 prochains jours");
    expect(mail).toContain("(dans 8 jours)");
  });

  it("les documents d'un gestionnaire sont listés du plus proche au plus lointain, avec le bien (ou, à défaut, le locataire)", async () => {
    const { manager, property, tenant } = await agence();
    await deposer(manager.id, { propertyId: property.id, tenantId: tenant.id, title: "Lointain", expiresAt: jour(20) });
    await deposer(manager.id, { tenantId: tenant.id, title: "Identite", expiresAt: jour(25) });
    await deposer(manager.id, { propertyId: property.id, title: "Proche", expiresAt: jour(5) });

    await runStoredDocumentExpiryReminders();

    const mail = textesVers(manager.email)[0];
    expect(mail.indexOf("Proche")).toBeGreaterThan(-1);
    expect(mail.indexOf("Proche")).toBeLessThan(mail.indexOf("Lointain"));
    expect(mail.indexOf("Lointain")).toBeLessThan(mail.indexOf("Identite"));
    expect(mail).toContain("Lointain — Villa Ngor —"); // le bien l'emporte sur le locataire
    expect(mail).toContain("Identite — Awa Sow —");
  });

  it("un document pris par une autre exécution entre-temps n'est pas annoncé, et rien n'est envoyé s'ils le sont tous", async () => {
    const { manager, property } = await agence();
    const a = await deposer(manager.id, { propertyId: property.id, title: "Document A", expiresAt: jour(5) });
    const b = await deposer(manager.id, { propertyId: property.id, title: "Document B", expiresAt: jour(6) });
    avantReclamation(() => testDb.update(storedDocuments).set({ reminderSentAt: new Date() }).where(eq(storedDocuments.id, b.id)));

    const premier = await runStoredDocumentExpiryReminders();

    expect(premier.sent).toBe(1);
    const mail = textesVers(manager.email)[0];
    expect(mail).toContain("Document A");
    expect(mail).not.toContain("Document B");
    vi.mocked(emailService.sendEmail).mockClear();

    await testDb.update(storedDocuments).set({ reminderSentAt: null }).where(eq(storedDocuments.id, a.id));
    avantReclamation(() => testDb.update(storedDocuments).set({ reminderSentAt: new Date() }).where(eq(storedDocuments.id, a.id)));
    const second = await runStoredDocumentExpiryReminders();

    expect(second.sent).toBe(0);
    expect(courriels()).toEqual([]);
  });
});

describe("avis d'échéance du mois", () => {
  it("n'avertit ni un bail fini, ni un locataire effacé, ni une facture réglée, déjà avisée ou d'un autre exercice ; avertit en attente ET en retard", async () => {
    const { manager, contract, tenant } = await agence();
    await createInvoice(contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING", amount: 500 });
    const retard = await locataireEnPlus(manager.id, "Bien en retard");
    await createInvoice(retard.contract.id, { periodMonth: 8, periodYear: 2026, status: "LATE", amount: 500 });
    const regle = await locataireEnPlus(manager.id, "Bien réglé");
    await createInvoice(regle.contract.id, { periodMonth: 8, periodYear: 2026, status: "PAID", paidAt: new Date(2026, 7, 2), amountPaid: 500, amount: 500 });
    const deja = await locataireEnPlus(manager.id, "Bien déjà avisé");
    await createInvoice(deja.contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING", reminderSentAt: new Date(2026, 7, 1) });
    const fini = await locataireEnPlus(manager.id, "Bien fini", { bail: { status: "ENDED" } });
    await createInvoice(fini.contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING" });
    const efface = await locataireEnPlus(manager.id, "Bien effacé", { tenant: { anonymizedAt: new Date() } });
    await createInvoice(efface.contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING" });

    const res = await runRentDueReminders();

    expect(res.sent).toBe(2);
    expect(destinataires()).toEqual([tenant.email, retard.tenant.email].sort());
  });

  it("une facture du même mois d'une AUTRE année n'est pas avisée (une seule facture par bail, celle du mois courant)", async () => {
    const { tenant } = await agence({ bail: { startDate: new Date(2025, 7, 1) } });

    const res = await runRentDueReminders();

    expect(res.sent).toBe(1);
    expect(destinataires()).toEqual([tenant.email]);
  });

  it("déclenché par un gestionnaire : ses locataires seulement, ses révisions seulement, ses baux seulement", async () => {
    const a = await agence();
    const b = await agence();
    const factureDeB = await createInvoice(b.contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING" });
    const revisions = vi.spyOn(rentRevisionService, "appliquerRevisionsDues");

    const res = await runRentDueReminders(a.manager.id);

    expect(res.sent).toBe(1);
    expect(destinataires()).toEqual([a.tenant.email]);
    expect(await marqueur(invoices, factureDeB.id)).toBeNull();
    expect(revisions).toHaveBeenCalledWith(expect.any(Date), a.manager.id);
  });

  it("un bien qui a DEUX baux actifs en même temps n'est facturé qu'une fois pour le mois (aucun double loyer)", async () => {
    const { manager, property } = await agence({ bail: { startDate: new Date(2025, 7, 1), endDate: new Date(2026, 11, 31) } });
    const tenant2 = await createTenant(manager.id, { email: `successeur${++compteur}@example.com` });
    const second = await createContract(property.id, tenant2.id, { startDate: new Date(2026, 7, 1), endDate: new Date(2027, 11, 31) });
    const premier = (await testDb.select().from(contracts).where(eq(contracts.propertyId, property.id))).find((c: typeof contracts.$inferSelect) => c.id !== second.id)!;
    await createInvoice(premier.id, { periodMonth: 7, periodYear: 2026, status: "PAID", paidAt: new Date(2026, 6, 3), amountPaid: 500 });

    await runRentDueReminders();

    const aout = (await testDb.select().from(invoices)).filter((f: typeof invoices.$inferSelect) => f.periodMonth === 8 && f.periodYear === 2026);
    expect(aout).toHaveLength(1);
    void second;
  });

  it("budget épuisé pendant la génération : rien n'est généré ; épuisé pendant l'envoi : rien n'est réclamé ; l'appelant le sait dans les deux cas", async () => {
    const { contract } = await agence();

    const avantGeneration = await runRentDueReminders(undefined, epuise);
    expect(avantGeneration).toMatchObject({ sent: 0, interrompu: true });
    expect(await testDb.select().from(invoices).where(eq(invoices.contractId, contract.id))).toEqual([]);

    await createInvoice(contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING" });
    let appels = 0;
    const apresGeneration: BudgetTemps = { epuise: () => ++appels > 1, restant: () => 0 };
    const pendantEnvoi = await runRentDueReminders(undefined, apresGeneration);
    expect(pendantEnvoi).toMatchObject({ sent: 0, interrompu: true });
  });

  it("un e-mail en échec : le détail ne garde que les envois réussis (sans trou), l'échec est compté, le marqueur de CETTE facture est relâché", async () => {
    const a = await agence();
    const b = await agence();
    const ko = await createInvoice(b.contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING", amount: 500 });
    const ok = await createInvoice(a.contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING", amount: 500 });
    emailEnEchecPour(b.tenant.email);
    whatsappEnEchecPour(b.tenant.phone);

    const res = await runRentDueReminders();

    expect(res).toMatchObject({ sent: 1, echecs: 1 });
    expect(res.details).toHaveLength(1);
    expect(res.details.every(Boolean)).toBe(true);
    expect(await marqueur(invoices, ok.id)).not.toBeNull();
    expect(await marqueur(invoices, ko.id)).toBeNull();
  });
});

describe("rappel « avant échéance »", () => {
  it("fenêtre de 3 jours : l'échéance d'hier, de J+4 ou de J+10 n'en fait pas partie ; avertit en attente ET en retard ; ni bail fini, ni locataire effacé, ni facture réglée ni déjà rappelée", async () => {
    const { manager, contract, tenant } = await agence();
    const facture = (c: string, valeurs: Partial<typeof invoices.$inferInsert>) => createInvoice(c, { periodMonth: 8, periodYear: 2026, status: "PENDING", ...valeurs });
    await facture(contract.id, { dueDate: jour(3, 12) });
    const retard = await locataireEnPlus(manager.id, "Bien en retard");
    await facture(retard.contract.id, { status: "LATE", dueDate: jour(1) });
    const hier = await locataireEnPlus(manager.id, "Bien d'hier");
    await facture(hier.contract.id, { dueDate: jour(-1, 20) });
    const j4 = await locataireEnPlus(manager.id, "Bien J+4");
    await facture(j4.contract.id, { dueDate: jour(4, 0, 1) });
    const j10 = await locataireEnPlus(manager.id, "Bien J+10");
    await facture(j10.contract.id, { dueDate: jour(10) });
    const regle = await locataireEnPlus(manager.id, "Bien réglé");
    await facture(regle.contract.id, { status: "PAID", paidAt: new Date(2026, 7, 2), dueDate: jour(2) });
    const deja = await locataireEnPlus(manager.id, "Bien déjà rappelé");
    await facture(deja.contract.id, { dueDate: jour(2), dueSoonReminderSentAt: new Date(2026, 7, 9) });
    const fini = await locataireEnPlus(manager.id, "Bien fini", { bail: { status: "ENDED" } });
    await facture(fini.contract.id, { dueDate: jour(2) });
    const efface = await locataireEnPlus(manager.id, "Bien effacé", { tenant: { anonymizedAt: new Date() } });
    await facture(efface.contract.id, { dueDate: jour(2) });

    const res = await runUpcomingRentDueReminders();

    expect(res.sent).toBe(2);
    expect(destinataires()).toEqual([tenant.email, retard.tenant.email].sort());
  });

  it("annonce les jours RESTANTS de chaque facture (e-mail et WhatsApp, titulaire et colocataire)", async () => {
    const { manager, contract, tenant } = await agence({ telephone: "+221770007001" });
    await colocataire(manager.id, contract.id, "coloc-jours@example.com", "+221770007002");
    await createInvoice(contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING", dueDate: jour(1, 12), amount: 500 });

    await runUpcomingRentDueReminders();

    expect(textesVers(tenant.email)[0]).toMatch(/dans 1 jour/);
    expect(textesVers("coloc-jours@example.com")[0]).toMatch(/dans 1 jour/);
    expect(messagesVers("+221770007001")[0][2]["4"]).toBe("1");
    expect(messagesVers("+221770007002")[0][2]["4"]).toBe("1");
  });

  it("deux factures éligibles reçoivent chacune leur rappel ; un e-mail en échec ne relâche que le marqueur de SA facture", async () => {
    const a = await agence();
    const b = await agence();
    const ko = await createInvoice(b.contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING", dueDate: jour(2) });
    const ok = await createInvoice(a.contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING", dueDate: jour(2) });
    emailEnEchecPour(b.tenant.email);
    whatsappEnEchecPour(b.tenant.phone);

    const res = await runUpcomingRentDueReminders();

    expect(res).toMatchObject({ sent: 1, echecs: 1 });
    expect(res.details).toHaveLength(1);
    expect(res.details.every(Boolean)).toBe(true);
    expect(await marqueur(invoices, ok.id, "dueSoonReminderSentAt")).not.toBeNull();
    expect(await marqueur(invoices, ko.id, "dueSoonReminderSentAt")).toBeNull();
  });
});

describe("montants, devise, détail et adresse de réponse des messages aux locataires", () => {
  /** Une facture de 500 déjà réglée à 200 : chaque message doit annoncer le RESTE dû, 300, jamais le total. */
  async function scenario(devise: string) {
    const { manager, contract, tenant, property } = await agence({ telephone: "+221770008001" });
    await testDb.insert(agencySettings).values({ userId: manager.id, email: "agence@example.com" });
    const coloc = await colocataire(manager.id, contract.id, "coloc-montants@example.com", "+221770008002");
    const invoice = await createInvoice(contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING", amount: 500, amountPaid: 200, currency: devise, dueDate: jour(3) });
    return { manager, contract, tenant, property, coloc, invoice };
  }
  const lancements: Array<[string, (s: Awaited<ReturnType<typeof scenario>>) => Promise<unknown>]> = [
    ["avis du mois", () => runRentDueReminders()],
    ["rappel avant échéance", () => runUpcomingRentDueReminders()],
    ["rappel manuel", (s) => sendSingleInvoiceReminder(s.invoice.id, s.manager.id)],
  ];

  it.each(lancements.flatMap(([nom, lancer]) => [["XOF", "300 FCFA"], ["", "300 €"]].map(([devise, attendu]) => [nom, lancer, devise, attendu] as const)))(
    "%s, devise « %s » : titulaire et colocataire, e-mail et WhatsApp, annoncent « %s » et non le total",
    async (_nom, lancer, devise, attendu) => {
      const s = await scenario(devise);

      await lancer(s);

      for (const adresse of [s.tenant.email, s.coloc.email!]) {
        const mail = textesVers(adresse);
        expect(mail, adresse).toHaveLength(1);
        expect(mail[0]).toContain(attendu);
        expect(mail[0]).not.toContain("500");
      }
      for (const telephone of [s.tenant.phone, s.coloc.phone!]) {
        const envoyes = messagesVers(telephone);
        expect(envoyes, telephone).toHaveLength(1);
        expect(Object.values(envoyes[0][2])).toContain(attendu);
      }
      // Chaque e-mail répond à l'adresse de CONTACT de l'agence.
      expect(courriels().length).toBeGreaterThan(0);
      for (const appel of courriels()) expect(appel[4]).toEqual({ replyTo: "agence@example.com" });
    }
  );

  it.each([
    ["avis du mois", () => runRentDueReminders()],
    ["rappel avant échéance", () => runUpcomingRentDueReminders()],
  ] as const)("%s : le détail rendu à l'appelant, quand WhatsApp et l'e-mail sont simulés", async (_nom, lancer) => {
    const s = await scenario("XOF");
    vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true });
    vi.spyOn(whatsappService, "envoyerMessageWhatsapp").mockResolvedValue({ simulated: true });

    const res = (await lancer()) as { details: unknown[] };

    expect(res.details).toEqual([{ tenantName: "Awa Sow", tenantEmail: s.tenant.email, propertyTitle: "Villa Ngor", amount: 300, simulated: true, whatsappSimulated: true, whatsappError: false }]);
  });

  it.each([
    ["avis du mois", () => runRentDueReminders()],
    ["rappel avant échéance", () => runUpcomingRentDueReminders()],
  ] as const)("%s : le détail rendu à l'appelant, quand WhatsApp échoue pour de vrai", async (_nom, lancer) => {
    const s = await scenario("XOF");
    whatsappEnEchecPour(s.tenant.phone);

    const res = (await lancer()) as { details: unknown[] };

    expect(res.details).toEqual([{ tenantName: "Awa Sow", tenantEmail: s.tenant.email, propertyTitle: "Villa Ngor", amount: 300, simulated: false, whatsappSimulated: false, whatsappError: true }]);
  });

  it("rappel avant échéance : le détail est une liste sans trou, et un échec WhatsApp du titulaire est compté", async () => {
    const s = await scenario("XOF");
    whatsappEnEchecPour(s.tenant.phone, s.coloc.phone!);

    const res = await runUpcomingRentDueReminders();

    expect(res.whatsappEchecs).toBe(2);
    expect(res.echecs).toBe(0);
  });
});

describe("rappel manuel d'une facture", () => {
  async function factureDuLocataire(valeurs: Partial<typeof invoices.$inferInsert> = {}, options: Parameters<typeof agence>[0] = {}) {
    const base = await agence({ telephone: "+221770009001", ...options });
    const invoice = await createInvoice(base.contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING", amount: 500, dueDate: jour(3), ...valeurs });
    return { ...base, invoice };
  }
  const refus = (code: string) => expect.objectContaining({ statusCode: 409, code });

  it("un rappel d'il y a 30 secondes bloque un nouveau (REMINDER_IN_PROGRESS) ; un rappel d'il y a 5 minutes n'empêche rien", async () => {
    const recent = await factureDuLocataire({ reminderSentAt: new Date(Date.now() - 30_000) });
    const ancien = await factureDuLocataire({ reminderSentAt: new Date(Date.now() - 5 * 60_000) });

    await expect(sendSingleInvoiceReminder(recent.invoice.id, recent.manager.id)).rejects.toEqual(refus("REMINDER_IN_PROGRESS"));
    const res = await sendSingleInvoiceReminder(ancien.invoice.id, ancien.manager.id);

    expect(res.success).toBe(true);
    expect((await marqueur(invoices, ancien.invoice.id))!.getTime()).toBe(Date.now());
  });

  it("une facture en retard est rappelée ; une facture réglée (INVOICE_ALREADY_PAID) ou annulée (INVOICE_CANCELLED_LOCKED) est refusée sans rien marquer", async () => {
    const retard = await factureDuLocataire({ status: "LATE" });
    const regle = await factureDuLocataire({ status: "PAID", paidAt: new Date(2026, 7, 2), amountPaid: 500 });
    const annulee = await factureDuLocataire({ status: "CANCELLED" });

    expect((await sendSingleInvoiceReminder(retard.invoice.id, retard.manager.id)).success).toBe(true);
    await expect(sendSingleInvoiceReminder(regle.invoice.id, regle.manager.id)).rejects.toEqual(refus("INVOICE_ALREADY_PAID"));
    await expect(sendSingleInvoiceReminder(annulee.invoice.id, annulee.manager.id)).rejects.toEqual(refus("INVOICE_CANCELLED_LOCKED"));
    expect(await marqueur(invoices, regle.invoice.id)).toBeNull();
    expect(await marqueur(invoices, annulee.invoice.id)).toBeNull();
  });

  it("ne marque que la facture visée", async () => {
    const { manager, contract, invoice } = await factureDuLocataire();
    const autre = await createInvoice(contract.id, { periodMonth: 7, periodYear: 2026, status: "PENDING" });

    await sendSingleInvoiceReminder(invoice.id, manager.id);

    expect(await marqueur(invoices, invoice.id)).not.toBeNull();
    expect(await marqueur(invoices, autre.id)).toBeNull();
  });

  it("e-mail en échec : pas de succès, marqueur relâché sur CETTE facture seulement, aucune copie aux colocataires, aucun échec WhatsApp journalisé", async () => {
    const { manager, contract, tenant, invoice } = await factureDuLocataire();
    const coloc = await colocataire(manager.id, contract.id, "coloc-echec@example.com", "+221770009002");
    const autre = await createInvoice(contract.id, { periodMonth: 7, periodYear: 2026, status: "PENDING", reminderSentAt: new Date(2026, 7, 5) });
    emailEnEchecPour(tenant.email);
    whatsappEnEchecPour(tenant.phone);

    const res = await sendSingleInvoiceReminder(invoice.id, manager.id);

    expect(res.success).toBe(false);
    expect(await marqueur(invoices, invoice.id)).toBeNull();
    expect((await marqueur(invoices, autre.id))!.getTime()).toBe(new Date(2026, 7, 5).getTime());
    expect(destinataires()).toEqual([tenant.email]);
    expect(messagesVers(coloc.phone!)).toEqual([]);
    expect(await journalWhatsapp(manager.id)).toEqual([]);
  });

  it("succès : le marqueur reste posé, le colocataire reçoit sa copie par e-mail et WhatsApp, le résultat porte le nom et l'e-mail du locataire", async () => {
    const { manager, contract, tenant, invoice } = await factureDuLocataire();
    const coloc = await colocataire(manager.id, contract.id, "coloc-ok@example.com", "+221770009003");

    const res = await sendSingleInvoiceReminder(invoice.id, manager.id);

    expect(res).toMatchObject({ success: true, tenantEmail: tenant.email, tenantName: "Awa Sow", simulated: false, whatsappSimulated: false, whatsappError: false });
    expect(await marqueur(invoices, invoice.id)).not.toBeNull();
    expect(destinataires()).toEqual([coloc.email, tenant.email].sort());
    expect(messagesVers(coloc.phone!)).toHaveLength(1);
  });

  it("formule Starter : l'e-mail part, mais ni le locataire ni ses colocataires ne reçoivent de WhatsApp", async () => {
    const { manager, contract, tenant, invoice } = await factureDuLocataire({}, { starter: true });
    const coloc = await colocataire(manager.id, contract.id, "coloc-starter@example.com", "+221770009004");

    const res = await sendSingleInvoiceReminder(invoice.id, manager.id);

    expect(res.success).toBe(true);
    expect(destinataires()).toEqual([coloc.email, tenant.email].sort());
    expect(messages()).toEqual([]);
  });

  it("le résultat dit si l'e-mail et le WhatsApp étaient simulés ou en échec", async () => {
    const { manager, tenant, invoice } = await factureDuLocataire();
    vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true });
    vi.spyOn(whatsappService, "envoyerMessageWhatsapp").mockResolvedValue({ simulated: true });

    const simule = await sendSingleInvoiceReminder(invoice.id, manager.id);
    await testDb.update(invoices).set({ reminderSentAt: null }).where(eq(invoices.id, invoice.id));
    whatsappEnEchecPour(tenant.phone);
    vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false });
    const enEchec = await sendSingleInvoiceReminder(invoice.id, manager.id);

    expect(simule).toMatchObject({ simulated: true, whatsappSimulated: true, whatsappError: false });
    expect(enEchec).toMatchObject({ simulated: false, whatsappSimulated: false, whatsappError: true });
  });

  it("journal : un WhatsApp non délivré au locataire, puis des copies non délivrées aux colocataires, avec le bon libellé, le bon nombre et le bon motif", async () => {
    const { manager, contract, tenant, invoice } = await factureDuLocataire();
    await colocataire(manager.id, contract.id, "coloc-j1@example.com", "+221770009005");
    await colocataire(manager.id, contract.id, "coloc-j2@example.com", "+221770009006");
    whatsappEnEchecPour(tenant.phone, "+221770009005", "+221770009006");

    await sendSingleInvoiceReminder(invoice.id, manager.id);

    const lignes = await journalWhatsapp(manager.id);
    expect(lignes).toHaveLength(2);
    for (const ligne of lignes) expect(ligne).toMatchObject({ entityType: "invoice", entityId: invoice.id, entityLabel: "Awa Sow — Villa Ngor" });
    const details = lignes.map((l: typeof activityLogs.$inferSelect) => l.details).sort();
    expect(details).toContain("2 copie(s) WhatsApp aux colocataires non délivrée(s) (numero_invalide) — les emails, eux, sont bien partis.");
    expect(details).toContain("Le rappel WhatsApp n'a pas été délivré (numero_invalide) — l'email, lui, est bien parti.");
  });
});

describe("scheduleContractEndingReminders : chaque horaire déclenche SA tâche", () => {
  it("chaque tâche planifiée marque ce qui la concerne et rien d'autre ; la dernière lance les e-mails de fin d'accès", async () => {
    const planifiees: Array<() => void> = [];
    vi.spyOn(cron, "schedule").mockImplementation(((_expression: string, tache: () => void) => {
      planifiees.push(tache);
      return { stop() {}, start() {} };
    }) as unknown as typeof cron.schedule);
    scheduleContractEndingReminders();
    expect(planifiees).toHaveLength(6);

    // Une donnée pour CHAQUE tâche, toutes dans leur fenêtre.
    const fin = await agence({ bail: { startDate: new Date(2025, 7, 1), endDate: jour(5) } });
    const assur = await agence();
    const policy = await createInsurancePolicy(assur.property.id, { expiryDate: jour(10) });
    const docs = await agence();
    const [doc] = await testDb
      .insert(storedDocuments)
      .values({ managerId: docs.manager.id, title: "Diag", category: "DIAGNOSTIC", filePath: "d/x.pdf", fileName: "x.pdf", mimeType: "application/pdf", sizeBytes: 1, expiresAt: jour(10) })
      .returning();
    const echeance = await agence();
    const facture = await createInvoice(echeance.contract.id, { periodMonth: 8, periodYear: 2026, status: "PENDING", dueDate: jour(2) });

    const lire = async () => ({
      finDeBail: (await marqueur(contracts, fin.contract.id)) !== null,
      assurance: (await marqueur(insurancePolicies, policy.id)) !== null,
      documents: (await marqueur(storedDocuments, doc.id)) !== null,
      avisDuMois: (await marqueur(invoices, facture.id)) !== null,
      avantEcheance: (await marqueur(invoices, facture.id, "dueSoonReminderSentAt")) !== null,
    });
    const remettreAZero = async () => {
      await testDb.update(contracts).set({ reminderSentAt: null }).where(eq(contracts.id, fin.contract.id));
      await testDb.update(insurancePolicies).set({ reminderSentAt: null }).where(eq(insurancePolicies.id, policy.id));
      await testDb.update(storedDocuments).set({ reminderSentAt: null }).where(eq(storedDocuments.id, doc.id));
      await testDb.update(invoices).set({ reminderSentAt: null, dueSoonReminderSentAt: null }).where(eq(invoices.id, facture.id));
    };
    const rien = { finDeBail: false, assurance: false, documents: false, avisDuMois: false, avantEcheance: false };
    const attendu = [
      { ...rien, finDeBail: true },
      { ...rien, avisDuMois: true },
      { ...rien, avantEcheance: true },
      { ...rien, assurance: true },
      { ...rien, documents: true },
      rien,
    ];

    for (let i = 0; i < planifiees.length; i++) {
      await remettreAZero();
      vi.mocked(runSubscriptionExpiryNotices).mockClear();
      planifiees[i]();
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(await lire(), `tâche ${i}`).toEqual(attendu[i]);
      expect(vi.mocked(runSubscriptionExpiryNotices).mock.calls.length, `tâche ${i}`).toBe(i === 5 ? 1 : 0);
    }
  });
});
