import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activityLogs, agencySettings, contractGuarantors, contracts, invoices } from "../db/schema";
import { env } from "../config/env";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { formaterMontant } from "../utils/montant";
import { nomAvecCivilite, nomComplet } from "../utils/nom";
import * as emailService from "./email.service";
import { guarantorUnpaidNoticeEmail, overdueReminderEmail } from "./email.service";
import { type FactureExistantePourGeneration, generateInvoicesForContract, markOverdueInvoices, periodeCouverte } from "./invoice.service";
import * as reminderService from "./reminder.service";
import { niveauAttendu, runOverdueReminders } from "./relances.service";
import { oublierAdressesDeReponse } from "./reponseAgence.service";
import * as whatsappService from "./whatsapp.service";

/**
 * Génération des factures (invoice.service.ts) et relances d'impayés (relances.service.ts) : cas limites trouvés en
 * sabotant les deux fichiers, que les tests existants laissaient passer.
 */
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("periodeCouverte : jours d'un mois couverts par un bail", () => {
  const bornes = (debut: Date, fin: Date) => ({ startDate: debut, endDate: fin });

  it("un mois avant le début ou après la fin du bail n'est couvert par aucun jour", () => {
    const bail = bornes(new Date(2026, 2, 10), new Date(2026, 4, 20));

    const avant = periodeCouverte(bail, 2, 2026);
    const apres = periodeCouverte(bail, 6, 2026);

    expect(avant).toEqual({ premierJour: 0, dernierJour: 0, jours: 0, joursDuMois: 28, complet: false });
    expect(apres).toEqual({ premierJour: 0, dernierJour: 0, jours: 0, joursDuMois: 30, complet: false });
  });

  it("un mois entier est complet ; le premier et le dernier mois sont comptés bornes incluses et ne sont pas complets", () => {
    const bail = bornes(new Date(2026, 2, 10), new Date(2026, 4, 20));

    expect(periodeCouverte(bail, 4, 2026)).toEqual({ premierJour: 1, dernierJour: 30, jours: 30, joursDuMois: 30, complet: true });
    expect(periodeCouverte(bail, 3, 2026)).toEqual({ premierJour: 10, dernierJour: 31, jours: 22, joursDuMois: 31, complet: false });
    expect(periodeCouverte(bail, 5, 2026)).toEqual({ premierJour: 1, dernierJour: 20, jours: 20, joursDuMois: 31, complet: false });
  });

  it("un bail dont la fin précède le début dans le même mois ne couvre aucun jour (jamais un nombre négatif)", () => {
    const res = periodeCouverte(bornes(new Date(2026, 2, 20), new Date(2026, 2, 10)), 3, 2026);

    expect(res.jours).toBe(0);
  });
});

describe("generateInvoicesForContract : cas limites", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 2, 20));
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  async function bail(extra: Partial<typeof contracts.$inferInsert> = {}) {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const [contract] = await testDb
      .insert(contracts)
      .values({ propertyId: property.id, tenantId: tenant.id, rent: 500, deposit: 1000, startDate: new Date(2026, 2, 1), endDate: new Date(2026, 11, 31), ...extra })
      .returning();
    return contract;
  }
  const mois = async (contractId: string) =>
    (await testDb.select().from(invoices).where(eq(invoices.contractId, contractId))).map((i: { periodMonth: number }) => i.periodMonth).sort((a: number, b: number) => a - b);
  const autre = (extra: Partial<FactureExistantePourGeneration> = {}): FactureExistantePourGeneration => ({
    contractId: "autre-contrat",
    periodMonth: 3,
    periodYear: 2026,
    status: "PENDING",
    contractStart: new Date(2026, 0, 1),
    contractEnd: new Date(2026, 11, 31),
    ...extra,
  });

  it("les factures déjà connues, fournies par l'appelant, remplacent la lecture en base", async () => {
    const contract = await bail({ startDate: new Date(2026, 0, 1) });
    const janvier = autre({ contractId: contract.id, periodMonth: 1, contractStart: contract.startDate, contractEnd: contract.endDate });

    await generateInvoicesForContract(contract, testDb, [janvier]);

    expect(await mois(contract.id)).toEqual([2, 3]);
  });

  it("une facture ANNULÉE d'un autre contrat du bien ne bloque pas le mois ; une facture vivante le bloque et le signale", async () => {
    const libre = await bail();
    const bloque = await bail();

    await generateInvoicesForContract(libre, testDb, [autre({ status: "CANCELLED" })]);
    await generateInvoicesForContract(bloque, testDb, [autre({ status: "PENDING" })]);

    expect(await mois(libre.id)).toEqual([3]);
    expect(await mois(bloque.id)).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("chevauchement"));
  });

  it("une facture d'un autre mois, ou d'une autre année, du même autre contrat n'empêche pas le mois courant", async () => {
    const autreMois = await bail();
    const autreAnnee = await bail();

    await generateInvoicesForContract(autreMois, testDb, [autre({ periodMonth: 2 })]);
    await generateInvoicesForContract(autreAnnee, testDb, [autre({ periodYear: 2025, contractStart: new Date(2025, 0, 1) })]);

    expect(await mois(autreMois.id)).toEqual([3]);
    expect(await mois(autreAnnee.id)).toEqual([3]);
  });

  it("deux baux qui partagent un seul jour (la fin de l'un est le début de l'autre) se chevauchent : rien n'est facturé deux fois", async () => {
    const debuteLe15 = await bail({ startDate: new Date(2026, 2, 15) });
    const finitLe15 = await bail({ startDate: new Date(2026, 2, 1), endDate: new Date(2026, 2, 15) });

    await generateInvoicesForContract(debuteLe15, testDb, [autre({ contractStart: new Date(2026, 0, 1), contractEnd: new Date(2026, 2, 15) })]);
    await generateInvoicesForContract(finitLe15, testDb, [autre({ contractStart: new Date(2026, 2, 15), contractEnd: new Date(2026, 11, 31) })]);

    expect(await mois(debuteLe15.id)).toEqual([]);
    expect(await mois(finitLe15.id)).toEqual([]);
  });

  it("la première facture, au prorata, est exigible à l'entrée dans les lieux et non avant, quel que soit le jour d'échéance", async () => {
    const contract = await bail({ startDate: new Date(2026, 2, 12), paymentDay: 5 });

    await generateInvoicesForContract(contract, testDb);

    const [facture] = await testDb.select().from(invoices).where(eq(invoices.contractId, contract.id));
    expect(new Date(facture.dueDate)).toEqual(new Date(2026, 2, 12));
  });

  it("un bail dont la fin précède le début ne produit aucune facture", async () => {
    const contract = await bail({ startDate: new Date(2026, 2, 12), endDate: new Date(2026, 2, 5) });

    const ids = await generateInvoicesForContract(contract, testDb);

    expect(ids).toEqual([]);
  });

  it("un mois entier est facturé au loyer exact du bail, sans arrondi", async () => {
    vi.setSystemTime(new Date(2026, 0, 20));
    const contract = await bail({ startDate: new Date(2026, 0, 1), rent: 123.456 });

    await generateInvoicesForContract(contract, testDb);

    const [facture] = await testDb.select().from(invoices).where(eq(invoices.contractId, contract.id));
    expect(facture.amount).toBe(123.456);
  });
});

describe("markOverdueInvoices : seules les factures en attente passent en retard", () => {
  it("une facture payée ou annulée, même échue, reste telle quelle ; une facture due aujourd'hui reste en attente", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 15, 9));
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const contract = await createContract(property.id, (await createTenant(manager.id)).id);
    const echue = new Date(2026, 5, 1);
    const enAttente = await createInvoice(contract.id, { periodMonth: 1, status: "PENDING", dueDate: echue });
    const payee = await createInvoice(contract.id, { periodMonth: 2, status: "PAID", dueDate: echue });
    const annulee = await createInvoice(contract.id, { periodMonth: 3, status: "CANCELLED", dueDate: echue });
    const duAujourdhui = await createInvoice(contract.id, { periodMonth: 4, status: "PENDING", dueDate: new Date(2026, 5, 15) });

    const nombre = await markOverdueInvoices();

    const statut = async (id: string) => (await testDb.select().from(invoices).where(eq(invoices.id, id)))[0].status;
    expect(nombre).toBe(1);
    expect(await statut(enAttente.id)).toBe("LATE");
    expect(await statut(payee.id)).toBe("PAID");
    expect(await statut(annulee.id)).toBe("CANCELLED");
    expect(await statut(duAujourdhui.id)).toBe("PENDING");
  });
});

describe("niveauAttendu : bornes", () => {
  it("avec un délai de grâce nul, un retard d'un intervalle exact reste au premier niveau", () => {
    expect(niveauAttendu(7, 0, 7)).toBe(1);
    expect(niveauAttendu(8, 0, 7)).toBe(2);
  });

  it("un intervalle nul compte pour un jour", () => {
    expect(niveauAttendu(3, 3, 0)).toBe(1);
    expect(niveauAttendu(4, 3, 0)).toBe(2);
  });
});

describe("relances d'impayés : cas limites", () => {
  let envoi: ReturnType<typeof vi.spyOn>;
  const AUJOURDHUI = new Date(2026, 9, 12);
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 12, 9));
    oublierAdressesDeReponse();
    envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  async function agence(reglages: Partial<typeof agencySettings.$inferInsert> = {}, locataire: Parameters<typeof createTenant>[1] = {}) {
    const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "Agence Teranga", email: "contact@agence.test", overdueRemindersEnabled: true, ...reglages });
    const property = await createProperty(manager.id, { title: "Studio A" });
    const tenant = await createTenant(manager.id, { email: "awa@example.com", firstName: "Awa", lastName: "Sow", ...locataire });
    const contract = await createContract(property.id, tenant.id, { status: "ACTIVE" });
    return { manager, property, tenant, contract };
  }
  const echueIlYA = (jours: number) => new Date(AUJOURDHUI.getTime() - jours * 86_400_000);
  const facture = (contractId: string, jours: number, extra: Partial<typeof invoices.$inferInsert> = {}) =>
    createInvoice(contractId, { periodMonth: 10, periodYear: 2026, amount: 500, status: "LATE", dueDate: echueIlYA(jours), ...extra });
  const ligne = async (id: string) => (await testDb.select().from(invoices).where(eq(invoices.id, id)))[0];

  it("un impayé de 90 jours exactement est relancé, un impayé de 91 jours ne l'est plus", async () => {
    const { contract } = await agence();
    await facture(contract.id, 90, { periodMonth: 7 });
    await facture(contract.id, 91, { periodMonth: 6 });

    const res = await runOverdueReminders();

    expect(res.sent).toBe(1);
  });

  it("une facture en attente (PENDING) échue est relancée comme une facture en retard (LATE)", async () => {
    const { contract } = await agence();
    const f = await facture(contract.id, 7, { status: "PENDING" });

    const res = await runOverdueReminders();

    expect(res.sent).toBe(1);
    expect((await ligne(f.id)).overdueReminderLevel).toBe(1);
  });

  it("une facture intégralement réglée par des paiements partiels mais encore marquée en retard n'est pas relancée", async () => {
    const { contract } = await agence();
    await facture(contract.id, 7, { amountPaid: 500 });

    const res = await runOverdueReminders();

    expect(res.sent).toBe(0);
    expect(envoi).not.toHaveBeenCalled();
  });

  it("la relance enregistre le niveau et l'instant d'envoi", async () => {
    const { contract } = await agence();
    const f = await facture(contract.id, 7);

    await runOverdueReminders();

    const apres = await ligne(f.id);
    expect(apres.overdueReminderLevel).toBe(1);
    expect(apres.overdueReminderSentAt).toEqual(new Date(2026, 9, 12, 9));
  });

  it("l'e-mail porte le bien, le reste dû, l'échéance, le retard, le niveau, l'agence, la civilité et la langue du locataire", async () => {
    const { contract } = await agence({}, { civility: "MME", language: "en" });
    await facture(contract.id, 7, { amountPaid: 200 });

    await runOverdueReminders();

    const attendu = overdueReminderEmail({
      propertyTitle: "Studio A",
      amount: 300,
      currency: "EUR",
      periodMonth: 10,
      periodYear: 2026,
      dueDate: echueIlYA(7),
      daysLate: 7,
      niveau: 1,
      agencyName: "Agence Teranga",
      tenantName: "Madame Awa Sow",
      langue: "en",
    });
    expect(envoi.mock.calls[0][1]).toBe(attendu.subject);
    expect(envoi.mock.calls[0][2]).toBe(attendu.html);
  });

  it("l'e-mail part avec l'adresse de réponse de l'agence", async () => {
    const { contract } = await agence();
    await facture(contract.id, 7);

    await runOverdueReminders();

    expect(envoi.mock.calls[0][4]).toStrictEqual({ replyTo: "contact@agence.test" });
  });

  it("un e-mail en échec restitue aussi la date d'envoi précédente", async () => {
    const { contract } = await agence();
    const f = await facture(contract.id, 7);
    envoi.mockResolvedValueOnce({ simulated: false, error: true } as never);

    await runOverdueReminders();

    const apres = await ligne(f.id);
    expect(apres.overdueReminderLevel).toBe(0);
    expect(apres.overdueReminderSentAt).toBeNull();
  });

  it("une exécution dont le budget de temps est épuisé le signale", async () => {
    const { contract } = await agence();
    await facture(contract.id, 7);

    const res = await runOverdueReminders({ epuise: () => true, restant: () => 0 });

    expect(res).toMatchObject({ sent: 0, interrompu: true });
  });

  it("le journal d'activité décrit la relance : entité, libellé, niveau, mois sur deux chiffres, reste dû et retard", async () => {
    const { manager, contract } = await agence();
    const f = await facture(contract.id, 7, { periodMonth: 9, amountPaid: 200 });

    await runOverdueReminders();

    const [journal] = await testDb.select().from(activityLogs).where(eq(activityLogs.managerId, manager.id));
    expect(journal).toMatchObject({
      action: "invoice.overdue_reminder",
      entityType: "invoice",
      entityId: f.id,
      entityLabel: "Awa Sow — Studio A",
      details: `Relance 1/3 envoyée (loyer 09/2026, ${formaterMontant(300, "EUR")} restant dû, 7 jour(s) de retard).`,
    });
  });

  it("les échecs WhatsApp sont signalés au gestionnaire avec le motif par défaut et le libellé des relances", async () => {
    const avant = env.whatsapp.templateNameOverdue;
    env.whatsapp.templateNameOverdue = "relance_impaye";
    try {
      const { manager, contract } = await agence();
      await facture(contract.id, 7);
      vi.spyOn(whatsappService, "envoyerMessageWhatsapp").mockResolvedValue({ error: true } as never);
      const signaler = vi.spyOn(reminderService, "signalerEchecsWhatsapp").mockResolvedValue(undefined as never);

      await runOverdueReminders();

      expect(signaler).toHaveBeenCalledWith(new Map([[manager.id, { count: 1, dernierMotif: "erreur_api" }]]), "relances d'impayés");
    } finally {
      env.whatsapp.templateNameOverdue = avant;
    }
  });

  describe("garants (dernier niveau)", () => {
    async function agenceAvecGarants() {
      const base = await agence({ overdueNotifyGuarantors: true }, { civility: "MME" });
      await testDb.insert(contractGuarantors).values([
        { contractId: base.contract.id, firstName: "Ibrahima", lastName: "Fall", phone: "+221771234567", email: "garant@example.com", maxAmount: 300 },
        { contractId: base.contract.id, firstName: "Sans", lastName: "Adresse", phone: "+221771234568", email: null },
      ]);
      await facture(base.contract.id, 25);
      return base;
    }

    it("le garant sans adresse e-mail est ignoré ; l'avis des autres porte le nom du locataire sans civilité et l'adresse de réponse", async () => {
      await agenceAvecGarants();

      await runOverdueReminders();

      expect(envoi.mock.calls.some((c: unknown[]) => !c[0])).toBe(false);
      const avis = envoi.mock.calls.find((c: unknown[]) => c[0] === "garant@example.com")!;
      const attendu = guarantorUnpaidNoticeEmail({
        propertyTitle: "Studio A",
        amount: 500,
        currency: "EUR",
        periodMonth: 10,
        periodYear: 2026,
        agencyName: "Agence Teranga",
        guarantorName: nomAvecCivilite({ firstName: "Ibrahima", lastName: "Fall" }),
        maxAmount: 300,
        tenantName: nomComplet({ firstName: "Awa", lastName: "Sow" }),
        langue: "fr",
      });
      expect(avis[1]).toBe(attendu.subject);
      expect(avis[2]).toBe(attendu.html);
      expect(avis[4]).toStrictEqual({ replyTo: "contact@agence.test" });
    });

    it("le journal cite les garants prévenus", async () => {
      const { manager } = await agenceAvecGarants();

      await runOverdueReminders();

      const [journal] = await testDb.select().from(activityLogs).where(eq(activityLogs.managerId, manager.id));
      expect(journal.details).toBe(`Relance 3/3 envoyée (loyer 10/2026, ${formaterMontant(500, "EUR")} restant dû, 25 jour(s) de retard) ; 1 garant(s) prévenu(s).`);
    });

    it("un envoi au garant qui lève une erreur ne fait pas échouer la relance : elle est journalisée", async () => {
      await agenceAvecGarants();
      envoi.mockImplementation((async (to: string) => {
        if (to === "garant@example.com") throw new Error("SMTP indisponible");
        return { simulated: true };
      }) as never);

      const res = await runOverdueReminders();

      expect(res.sent).toBe(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Avis au garant"), expect.any(Error));
    });
  });
});
