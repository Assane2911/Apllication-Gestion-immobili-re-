import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agencySettings, contractCotenants, contractGuarantors, formalNotices, tenants, users } from "../db/schema";
import * as emailService from "./email.service";
import {
  bauxAMettreEnDemeure,
  donneesDuCourrier,
  emettreMiseEnDemeure,
  factureMure,
  FENETRE_DOUBLON_HEURES,
  impayesDuBail,
  listerMisesEnDemeure,
  lireFactures,
  referenceMiseEnDemeure,
} from "./miseEnDemeure.service";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Cas limites de la mise en demeure, au niveau du service : calendrier de maturité (bornes exactes), lecture d'un instantané abîmé,
 * liste des baux à mettre en demeure (plus ancien impayé, total arrondi, déjà réclamées, tri), fenêtre anti-doublon à la minute près,
 * locataire anonymisé, résultat des envois (locataire sans adresse, envoi refusé ou simulé, garants sans adresse) et données du courrier.
 * L'instant « maintenant » est toujours passé en paramètre : les bornes se vérifient sans dépendre de l'horloge.
 */
const MAINTENANT = new Date(2026, 6, 1, 12, 0, 0);
const jours = (n: number) => new Date(2026, 6, 1 - n);

afterEach(() => {
  vi.restoreAllMocks();
});

async function agence(overrides: { currency?: string } = {}) {
  const manager = await createManager();
  const property = await createProperty(manager.id, { title: "Villa des Almadies", address: "5 route des Almadies, Dakar" });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Diop", email: "awa@test.local" });
  const contract = await createContract(property.id, tenant.id, { status: "ACTIVE", startDate: new Date(2025, 0, 1), endDate: new Date(2028, 0, 1), ...overrides });
  return { manager, property, tenant, contract };
}

const emettre = (a: { manager: { id: string }; contract: { id: string } }, extra: Partial<Parameters<typeof emettreMiseEnDemeure>[0]> = {}) =>
  emettreMiseEnDemeure({
    contractId: a.contract.id,
    managerId: a.manager.id,
    deadlineDays: 8,
    envoyerParEmail: false,
    prevenirGarants: false,
    createdBy: a.manager.id,
    maintenant: MAINTENANT,
    ...extra,
  });

describe("lireFactures : un instantané abîmé ne fait jamais échouer le courrier", () => {
  it("rend les factures d'un tableau, et une liste vide pour tout autre contenu", () => {
    const facture = { invoiceId: "f1", periodMonth: 5, periodYear: 2026, dueDate: "2026-05-20T00:00:00.000Z", amount: 100, resteDu: 40 };
    expect(lireFactures(JSON.stringify([facture]))).toEqual([facture]);
    expect(lireFactures("[]")).toEqual([]);
    // JSON valide mais pas un tableau : un objet, un nombre, null.
    expect(lireFactures('{"invoiceId":"f1"}')).toEqual([]);
    expect(lireFactures("12")).toEqual([]);
    expect(lireFactures("null")).toEqual([]);
    // JSON invalide.
    expect(lireFactures("[{")).toEqual([]);
    expect(lireFactures("")).toEqual([]);
  });
});

describe("impayesDuBail", () => {
  it("ne garde que les factures échues et non soldées, de la plus ancienne à la plus récente", async () => {
    const { contract, tenant, manager } = await agence();
    const autreBail = await createContract((await createProperty(manager.id)).id, tenant.id, { status: "ACTIVE" });
    const recente = await createInvoice(contract.id, { status: "LATE", dueDate: jours(5), periodMonth: 6 });
    const ancienne = await createInvoice(contract.id, { status: "PENDING", dueDate: jours(40), periodMonth: 5 });
    const echeanceAujourdhui = await createInvoice(contract.id, { status: "PENDING", dueDate: MAINTENANT, periodMonth: 7 });
    const veille = await createInvoice(contract.id, { status: "PENDING", dueDate: jours(1), periodMonth: 4 });
    await createInvoice(contract.id, { status: "PAID", dueDate: jours(60), periodMonth: 1 });
    await createInvoice(contract.id, { status: "CANCELLED", dueDate: jours(60), periodMonth: 2 });
    await createInvoice(contract.id, { status: "PENDING", dueDate: jours(30), amount: 500, amountPaid: 500, periodMonth: 3 });
    await createInvoice(autreBail.id, { status: "LATE", dueDate: jours(50) });

    const impayes = await impayesDuBail(contract.id, MAINTENANT);

    expect(impayes.map((f: { id: string }) => f.id)).toEqual([ancienne.id, recente.id, veille.id]);
    expect(impayes.map((f: { id: string }) => f.id)).not.toContain(echeanceAujourdhui.id);
  });
});

describe("factureMure : bornes exactes du calendrier", () => {
  const facture = (retard: number, niveau = 0, relanceIlYa: number | null = null) =>
    ({
      dueDate: jours(retard),
      overdueReminderLevel: niveau,
      overdueReminderSentAt: relanceIlYa === null ? null : jours(relanceIlYa),
    }) as unknown as Parameters<typeof factureMure>[0];
  const actives = (grace: number, intervalle: number) => ({ overdueRemindersEnabled: true, overdueGraceDays: grace, overdueIntervalDays: intervalle });

  it("relances actives : le retard équivalent est le délai de grâce plus trois intervalles", () => {
    // 5 + 3 × 10 = 35 jours.
    expect(factureMure(facture(34), actives(5, 10), MAINTENANT)).toBe(false);
    expect(factureMure(facture(35), actives(5, 10), MAINTENANT)).toBe(true);
  });

  it("une grâce ou un intervalle nul compte pour un jour au moins", () => {
    // max(1, 0) + 3 × max(1, 0) = 4 jours.
    expect(factureMure(facture(3), actives(0, 0), MAINTENANT)).toBe(false);
    expect(factureMure(facture(4), actives(0, 0), MAINTENANT)).toBe(true);
    // Un intervalle négatif est ramené à un jour, lui aussi.
    expect(factureMure(facture(4), actives(0, -5), MAINTENANT)).toBe(true);
  });

  it("dernier niveau de relance : mûre un intervalle après la dernière relance, jamais sans date de relance", () => {
    // Retard loin sous le seuil (35 jours) : seule la dernière relance compte.
    expect(factureMure(facture(20, 3, 9), actives(5, 10), MAINTENANT)).toBe(false);
    expect(factureMure(facture(20, 3, 10), actives(5, 10), MAINTENANT)).toBe(true);
    expect(factureMure(facture(20, 3, null), actives(5, 10), MAINTENANT)).toBe(false);
    // Un niveau inférieur au dernier n'appelle rien, même avec une vieille relance.
    expect(factureMure(facture(20, 2, 30), actives(5, 10), MAINTENANT)).toBe(false);
  });

  it("relances désactivées : trente jours de retard, quelles que soient les relances", () => {
    const desactivees = { overdueRemindersEnabled: false, overdueGraceDays: 5, overdueIntervalDays: 10 };
    expect(factureMure(facture(29, 3, 90), desactivees, MAINTENANT)).toBe(false);
    expect(factureMure(facture(29), { overdueRemindersEnabled: false, overdueGraceDays: 5, overdueIntervalDays: 10 }, MAINTENANT)).toBe(false);
    expect(factureMure(facture(30), { overdueRemindersEnabled: false, overdueGraceDays: 5, overdueIntervalDays: 10 }, MAINTENANT)).toBe(true);
  });
});

describe("bauxAMettreEnDemeure : ce que la liste rapporte", () => {
  it("compte le plus ancien impayé quel que soit l'ordre, le total arrondi, les impayés déjà réclamés, et trie le plus en retard d'abord", async () => {
    const a = await agence();
    // Le plus récent est inséré AVANT le plus ancien : la date retenue ne dépend pas de l'ordre de lecture.
    await createInvoice(a.contract.id, { status: "LATE", dueDate: jours(40), amount: 0.1, periodMonth: 6 });
    await createInvoice(a.contract.id, { status: "LATE", dueDate: jours(70), amount: 0.2, periodMonth: 5 });
    // Un paiement partiel : seul le reste dû entre dans le total.
    await createInvoice(a.contract.id, { status: "PENDING", dueDate: jours(35), amount: 500, amountPaid: 200, periodMonth: 7 });
    // Intégralement payé mais encore « en attente » : ignoré.
    await createInvoice(a.contract.id, { status: "PENDING", dueDate: jours(80), amount: 300, amountPaid: 300, periodMonth: 4 });
    // Autre bail du même gestionnaire, moins en retard.
    const bien2 = await createProperty(a.manager.id, { title: "Studio Mermoz" });
    const loc2 = await createTenant(a.manager.id, { firstName: "Ibou", lastName: "Fall" });
    const bail2 = await createContract(bien2.id, loc2.id, { status: "ACTIVE" });
    await createInvoice(bail2.id, { status: "LATE", dueDate: jours(31), amount: 100 });

    const liste = await bauxAMettreEnDemeure(a.manager.id, MAINTENANT);

    expect(liste).toHaveLength(2);
    // Triés du plus en retard au moins en retard.
    expect(liste.map((l: { contractId: string }) => l.contractId)).toEqual([a.contract.id, bail2.id]);
    expect(liste[0]).toMatchObject({
      propertyTitle: "Villa des Almadies",
      tenantName: "Awa Diop",
      unpaidCount: 3,
      alreadyClaimedCount: 0,
      daysLate: 70,
      agencyReachable: false,
    });
    expect(liste[0].oldestDueDate).toEqual(jours(70));
    // 0,2 + 0,1 + (500 − 200) : 300,3 et non 300,30000000000003.
    expect(liste[0].totalDue).toBe(300.3);
    expect(liste[1]).toMatchObject({ tenantName: "Ibou Fall", unpaidCount: 1, daysLate: 31, totalDue: 100 });
  });

  it("un bail dont tous les impayés mûrs sont déjà réclamés n'est plus proposé, un nouvel impayé mûr le fait revenir", async () => {
    const a = await agence();
    const premiere = await createInvoice(a.contract.id, { status: "LATE", dueDate: jours(50), periodMonth: 5 });
    await emettre(a);
    expect(await bauxAMettreEnDemeure(a.manager.id, MAINTENANT)).toEqual([]);

    await createInvoice(a.contract.id, { status: "LATE", dueDate: jours(33), periodMonth: 6 });
    const liste = await bauxAMettreEnDemeure(a.manager.id, MAINTENANT);

    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({ unpaidCount: 2, alreadyClaimedCount: 1 });
    expect(premiere.id).toBeTruthy();
  });

  it("un impayé encore récent (non mûr) ne fait pas proposer le bail, même à côté d'un impayé mûr déjà réclamé", async () => {
    const a = await agence();
    await createInvoice(a.contract.id, { status: "LATE", dueDate: jours(50), periodMonth: 5 });
    await emettre(a);
    await createInvoice(a.contract.id, { status: "PENDING", dueDate: jours(5), periodMonth: 6 });

    expect(await bauxAMettreEnDemeure(a.manager.id, MAINTENANT)).toEqual([]);
  });

  it("ne propose ni le bail d'un autre gestionnaire, ni celui d'un locataire anonymisé", async () => {
    const a = await agence();
    await createInvoice(a.contract.id, { status: "LATE", dueDate: jours(40) });
    const autre = await agence();
    await createInvoice(autre.contract.id, { status: "LATE", dueDate: jours(90) });
    const anonyme = await agence();
    await createInvoice(anonyme.contract.id, { status: "LATE", dueDate: jours(90) });
    await testDb.update(tenants).set({ anonymizedAt: new Date() }).where(eq(tenants.id, anonyme.tenant.id));

    expect((await bauxAMettreEnDemeure(a.manager.id, MAINTENANT)).map((l: { contractId: string }) => l.contractId)).toEqual([a.contract.id]);
    expect((await bauxAMettreEnDemeure(autre.manager.id, MAINTENANT)).map((l: { contractId: string }) => l.contractId)).toEqual([autre.contract.id]);
    expect(await bauxAMettreEnDemeure(anonyme.manager.id, MAINTENANT)).toEqual([]);
  });

  it("le calendrier des relances de l'agence s'applique : relances actives, un impayé de 31 jours n'est pas encore mûr", async () => {
    const a = await agence();
    await createInvoice(a.contract.id, { status: "LATE", dueDate: jours(31) });
    await testDb.insert(agencySettings).values({ userId: a.manager.id, agencyName: "Agence", overdueRemindersEnabled: true, overdueGraceDays: 5, overdueIntervalDays: 10 });

    expect(await bauxAMettreEnDemeure(a.manager.id, MAINTENANT)).toEqual([]);
    await testDb.update(agencySettings).set({ overdueIntervalDays: 8 }).where(eq(agencySettings.userId, a.manager.id));
    expect(await bauxAMettreEnDemeure(a.manager.id, MAINTENANT)).toHaveLength(1);
  });

  it("l'échéance du jour n'est pas encore un impayé : elle n'entre ni dans le nombre ni dans le total", async () => {
    const a = await agence();
    await createInvoice(a.contract.id, { status: "LATE", dueDate: jours(40), amount: 100, periodMonth: 5 });
    await createInvoice(a.contract.id, { status: "PENDING", dueDate: MAINTENANT, amount: 700, periodMonth: 7 });

    const [bail] = await bauxAMettreEnDemeure(a.manager.id, MAINTENANT);

    expect(bail).toMatchObject({ unpaidCount: 1, totalDue: 100 });
  });

  it("le total est arrondi au centime : 0,1 + 0,2 vaut 0,3 et non 0,30000000000000004", async () => {
    const a = await agence();
    await createInvoice(a.contract.id, { status: "LATE", dueDate: jours(50), amount: 0.1, periodMonth: 5 });
    await createInvoice(a.contract.id, { status: "LATE", dueDate: jours(40), amount: 0.2, periodMonth: 6 });

    const [bail] = await bauxAMettreEnDemeure(a.manager.id, MAINTENANT);
    expect(bail.totalDue).toBe(0.3);

    const { notice } = await emettre(a);
    expect(notice.totalDue).toBe(0.3);
  });

  it("l'agence est joignable dès qu'un téléphone OU un email est renseigné, et pas avec des blancs", async () => {
    const a = await agence();
    await createInvoice(a.contract.id, { status: "LATE", dueDate: jours(40) });
    const lire = async () => (await bauxAMettreEnDemeure(a.manager.id, MAINTENANT))[0].agencyReachable;

    expect(await lire()).toBe(false);
    await testDb.insert(agencySettings).values({ userId: a.manager.id, agencyName: "Agence", phone: "   ", email: " " });
    expect(await lire()).toBe(false);
    await testDb.update(agencySettings).set({ phone: "+221770000000" }).where(eq(agencySettings.userId, a.manager.id));
    expect(await lire()).toBe(true);
    await testDb.update(agencySettings).set({ phone: "", email: "agence@test.local" }).where(eq(agencySettings.userId, a.manager.id));
    expect(await lire()).toBe(true);
  });
});

describe("emettreMiseEnDemeure : refus et contenu figé", () => {
  it("refuse un bail inconnu, un locataire anonymisé et un bail sans rien d'échu, sans rien écrire", async () => {
    const a = await agence();
    await createInvoice(a.contract.id, { status: "LATE", dueDate: jours(40) });

    await expect(emettre({ manager: a.manager, contract: { id: "inexistant" } })).rejects.toMatchObject({ statusCode: 404, code: "CONTRACT_NOT_FOUND" });

    await testDb.update(tenants).set({ anonymizedAt: new Date() }).where(eq(tenants.id, a.tenant.id));
    await expect(emettre(a)).rejects.toMatchObject({ statusCode: 409, code: "FORMAL_NOTICE_TENANT_ANONYMIZED" });

    await testDb.update(tenants).set({ anonymizedAt: null }).where(eq(tenants.id, a.tenant.id));
    const vide = await agence();
    await expect(emettre(vide)).rejects.toMatchObject({ statusCode: 409, code: "FORMAL_NOTICE_NOTHING_OVERDUE" });

    expect(await testDb.select().from(formalNotices)).toHaveLength(0);
  });

  it("fige les factures du plus ancien au plus récent, le reste dû, le total arrondi, la devise du bail, l'auteur et l'instant d'émission", async () => {
    const a = await agence({ currency: "XOF" });
    const recente = await createInvoice(a.contract.id, { status: "LATE", dueDate: jours(40), amount: 0.1, periodMonth: 6, periodYear: 2026 });
    const ancienne = await createInvoice(a.contract.id, { status: "PENDING", dueDate: jours(70), amount: 0.2, periodMonth: 5, periodYear: 2026 });
    const partielle = await createInvoice(a.contract.id, { status: "PENDING", dueDate: jours(55), amount: 500, amountPaid: 200, periodMonth: 4, periodYear: 2026 });

    const { notice, emailEnvoye, colocatairesPrevenus, garantsPrevenus } = await emettre(a, { deadlineDays: 15, createdBy: "agent-1" });

    expect({ emailEnvoye, colocatairesPrevenus, garantsPrevenus }).toEqual({ emailEnvoye: false, colocatairesPrevenus: 0, garantsPrevenus: 0 });
    expect(notice).toMatchObject({ contractId: a.contract.id, managerId: a.manager.id, currency: "XOF", deadlineDays: 15, createdBy: "agent-1", totalDue: 300.3, emailSentAt: null, guarantorsNotified: 0 });
    expect(notice.createdAt).toEqual(MAINTENANT);
    expect(JSON.parse(notice.invoicesSnapshot)).toEqual([
      { invoiceId: ancienne.id, periodMonth: 5, periodYear: 2026, dueDate: jours(70).toISOString(), amount: 0.2, resteDu: 0.2 },
      { invoiceId: partielle.id, periodMonth: 4, periodYear: 2026, dueDate: jours(55).toISOString(), amount: 500, resteDu: 300 },
      { invoiceId: recente.id, periodMonth: 6, periodYear: 2026, dueDate: jours(40).toISOString(), amount: 0.1, resteDu: 0.1 },
    ]);
  });

  it("refuse une copie identique pendant 24 h exactement, et l'autorise dès la seconde suivante", async () => {
    const a = await agence();
    await createInvoice(a.contract.id, { status: "LATE", dueDate: jours(40) });
    const { notice } = await emettre(a);

    const apres = (ms: number) => new Date(MAINTENANT.getTime() + ms);
    const HEURE = 3_600_000;
    expect(FENETRE_DOUBLON_HEURES).toBe(24);

    const refus = await emettre(a, { maintenant: apres(FENETRE_DOUBLON_HEURES * HEURE) }).catch((e) => e);
    expect(refus).toMatchObject({ statusCode: 409, code: "FORMAL_NOTICE_DUPLICATE" });
    expect(refus.params).toEqual({ reference: referenceMiseEnDemeure(notice), date: MAINTENANT.toLocaleDateString("fr-FR") });
    expect(refus.message).toContain(referenceMiseEnDemeure(notice));

    const permise = await emettre(a, { maintenant: apres(FENETRE_DOUBLON_HEURES * HEURE + 1000) });
    expect(permise.notice.id).not.toBe(notice.id);
  });

  it("une mise en demeure d'un autre bail ou d'un autre contenu n'est pas un doublon", async () => {
    const a = await agence();
    await createInvoice(a.contract.id, { status: "LATE", dueDate: jours(40), amount: 500 });
    await emettre(a);
    const b = await agence();
    await createInvoice(b.contract.id, { status: "LATE", dueDate: jours(40), amount: 500 });
    expect((await emettre(b)).notice.contractId).toBe(b.contract.id);

    // Même facture, reste dû modifié par un paiement partiel : contenu différent.
    const { invoices } = await import("../db/schema");
    await testDb.update(invoices).set({ amountPaid: 100 }).where(eq(invoices.contractId, a.contract.id));
    const nouvelle = await emettre(a);
    expect(nouvelle.notice.totalDue).toBe(400);
  });
});

describe("emettreMiseEnDemeure : envoi par email", () => {
  async function avecImpaye() {
    const a = await agence();
    await createInvoice(a.contract.id, { status: "LATE", dueDate: jours(40) });
    return a;
  }

  it("un envoi accepté (ou simulé) compte comme envoyé et date l'envoi ; l'adresse de réponse est celle de l'agence", async () => {
    const a = await avecImpaye();
    await testDb.insert(agencySettings).values({ userId: a.manager.id, agencyName: "Agence Teranga", email: "agence@test.local" });
    const envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);

    const res = await emettre(a, { envoyerParEmail: true });

    expect(res.emailEnvoye).toBe(true);
    expect(res.notice.emailSentAt).toEqual(MAINTENANT);
    expect(envoi).toHaveBeenCalledTimes(1);
    expect(envoi.mock.calls[0][0]).toBe("awa@test.local");
    expect(envoi.mock.calls[0][4]).toEqual({ replyTo: "agence@test.local" });
    const [, sujet, html, pieces] = envoi.mock.calls[0];
    expect(sujet).toContain("Mise en demeure de payer");
    expect(String(html)).toContain("Agence Teranga");
    expect(pieces?.[0].filename).toMatch(/^mise-en-demeure-MED-2026-[0-9A-Z]{6}\.pdf$/);
  });

  it("un envoi refusé n'est pas compté et ne date rien, mais la mise en demeure reste émise", async () => {
    const a = await avecImpaye();
    vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false, error: true } as never);

    const res = await emettre(a, { envoyerParEmail: true });

    expect(res.emailEnvoye).toBe(false);
    expect(res.notice.emailSentAt).toBeNull();
    expect(await testDb.select().from(formalNotices)).toHaveLength(1);
  });

  it("un locataire sans adresse ne reçoit rien, mais ses colocataires reçoivent leur copie", async () => {
    const a = await avecImpaye();
    await testDb.update(tenants).set({ email: "" }).where(eq(tenants.id, a.tenant.id));
    const coloc = await createTenant(a.manager.id, { email: "coloc@test.local" });
    await testDb.insert(contractCotenants).values({ contractId: a.contract.id, tenantId: coloc.id });
    const envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);

    const res = await emettre(a, { envoyerParEmail: true });

    expect(envoi.mock.calls.map((c) => c[0])).toEqual(["coloc@test.local"]);
    expect(res).toMatchObject({ emailEnvoye: false, colocatairesPrevenus: 1 });
    expect(res.notice.emailSentAt).toBeNull();
  });

  it("garants : seuls ceux qui ont une adresse et dont l'envoi est accepté sont comptés, avec l'adresse de réponse de l'agence ; rien ne part sans la demande", async () => {
    const a = await avecImpaye();
    await testDb.insert(agencySettings).values({ userId: a.manager.id, agencyName: "Agence", email: "agence@test.local" });
    await testDb.insert(contractGuarantors).values([
      { contractId: a.contract.id, firstName: "Moussa", lastName: "Sow", phone: "+221770000000", email: "moussa@test.local" },
      { contractId: a.contract.id, firstName: "Fatou", lastName: "Ndiaye", phone: "+221770000001", email: "" },
      { contractId: a.contract.id, firstName: "Omar", lastName: "Ba", phone: "+221770000002", email: "refuse@test.local" },
      { contractId: a.contract.id, firstName: "Aminata", lastName: "Sy", phone: "+221770000003", email: "plante@test.local" },
    ]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const envoi = vi.spyOn(emailService, "sendEmail").mockImplementation((async (to: string) => {
      if (to === "refuse@test.local") return { simulated: false, error: true };
      if (to === "plante@test.local") throw new Error("SMTP indisponible");
      return { simulated: true };
    }) as never);

    const sans = await emettre(a, { envoyerParEmail: true, prevenirGarants: false });
    expect(sans.garantsPrevenus).toBe(0);
    expect(envoi.mock.calls.map((c) => c[0])).toEqual(["awa@test.local"]);

    envoi.mockClear();
    const avec = await emettre(a, { envoyerParEmail: true, prevenirGarants: true, maintenant: new Date(MAINTENANT.getTime() + 3 * 86_400_000) });
    // Moussa accepté ; Fatou sans adresse ; Omar refusé ; Aminata en exception (non comptée, et n'arrête pas les autres).
    expect(avec.garantsPrevenus).toBe(1);
    expect(avec.notice.guarantorsNotified).toBe(1);
    expect(envoi.mock.calls.map((c) => c[0])).toEqual(["awa@test.local", "moussa@test.local", "refuse@test.local", "plante@test.local"]);
    for (const appel of envoi.mock.calls) expect(appel[4]).toEqual({ replyTo: "agence@test.local" });
    const [enBase] = await testDb.select().from(formalNotices).where(eq(formalNotices.id, avec.notice.id));
    expect(enBase.guarantorsNotified).toBe(1);
  });
});

describe("donneesDuCourrier et listerMisesEnDemeure", () => {
  it("rend le courrier avec ses valeurs par défaut quand l'agence n'a rien renseigné", async () => {
    const a = await agence();
    await createInvoice(a.contract.id, { status: "LATE", dueDate: jours(40) });
    const { notice } = await emettre(a, { deadlineDays: 12 });

    const d = await donneesDuCourrier(notice);

    expect(d).toMatchObject({
      reference: referenceMiseEnDemeure(notice),
      deadlineDays: 12,
      currency: notice.currency,
      totalDue: notice.totalDue,
      destinataires: "Awa Diop",
      adresse: "5 route des Almadies, Dakar",
      propertyTitle: "Villa des Almadies",
      garants: [],
      pays: null,
      agency: { name: "Agence Immobilière", address: null, phone: null, email: null, siretOrId: null },
    });
    expect(d.factures).toHaveLength(1);
    expect(d.createdAt).toEqual(MAINTENANT);
  });

  it("nomme tous les occupants, les garants, le pays et les coordonnées de l'agence", async () => {
    const a = await agence();
    await createInvoice(a.contract.id, { status: "LATE", dueDate: jours(40) });
    const coloc = await createTenant(a.manager.id, { firstName: "Ibou", lastName: "Fall" });
    await testDb.insert(contractCotenants).values({ contractId: a.contract.id, tenantId: coloc.id });
    await testDb.insert(contractGuarantors).values({ contractId: a.contract.id, firstName: "Moussa", lastName: "Sow", phone: "+221770000000" });
    await testDb.update(users).set({ country: "SN" }).where(eq(users.id, a.manager.id));
    await testDb.insert(agencySettings).values({
      userId: a.manager.id,
      agencyName: "Agence Teranga",
      address: "10 avenue Cheikh Anta Diop",
      phone: "+221338000000",
      email: "contact@teranga.test",
      siretOrId: "NINEA 123",
    });
    const { notice } = await emettre(a);

    const d = await donneesDuCourrier(notice);

    expect(d.destinataires).toContain("Awa Diop");
    expect(d.destinataires).toContain("Ibou Fall");
    expect(d.garants).toEqual(["Moussa Sow"]);
    expect(d.pays).toBe("SN");
    expect(d.agency).toEqual({ name: "Agence Teranga", address: "10 avenue Cheikh Anta Diop", phone: "+221338000000", email: "contact@teranga.test", siretOrId: "NINEA 123" });
  });

  it("la référence est MED-année-six derniers caractères de l'identifiant en majuscules", () => {
    expect(referenceMiseEnDemeure({ id: "abcdef123xyz", createdAt: new Date(2027, 2, 9) })).toBe("MED-2027-123XYZ");
  });

  it("liste les mises en demeure d'un bail de la plus récente à la plus ancienne, avec leurs factures", async () => {
    const a = await agence();
    const f1 = await createInvoice(a.contract.id, { status: "LATE", dueDate: jours(60), periodMonth: 5 });
    const un = await emettre(a);
    const f2 = await createInvoice(a.contract.id, { status: "LATE", dueDate: jours(45), periodMonth: 6 });
    const deux = await emettre(a, { maintenant: new Date(MAINTENANT.getTime() + 2 * 86_400_000) });
    const autre = await agence();
    await createInvoice(autre.contract.id, { status: "LATE", dueDate: jours(60) });
    await emettre(autre);

    const liste = await listerMisesEnDemeure(a.contract.id);

    expect(liste.map((n: { id: string }) => n.id)).toEqual([deux.notice.id, un.notice.id]);
    expect(liste[0].invoices.map((f: { invoiceId: string }) => f.invoiceId)).toEqual([f1.id, f2.id]);
    expect(liste[1].invoices.map((f: { invoiceId: string }) => f.invoiceId)).toEqual([f1.id]);
  });
});
