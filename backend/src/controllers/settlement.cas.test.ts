import { and, eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { activityLogs, agencySettings, contractCotenants, contracts, invoices, leaseNotices, leaseSettlements, tenants } from "../db/schema";
import * as emailService from "../services/email.service";
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
import { formaterMontant } from "../utils/montant";

/**
 * Solde de tout compte : cas limites de l'aperçu, de l'émission (refus, doublons, enregistrement, e-mails, journal), du règlement
 * et du document. Complète settlement.test.ts et soldeDoubleEmission.test.ts.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 25, 12, 0)); // 25 novembre 2026, midi
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * Un bail terminé : loyer 500, dépôt 1000, janvier réglé, février réglé en partie (200), mars impayé. Un autre locataire de la
 * même agence est créé AVANT celui du bail : une lecture du « premier locataire de l'agence » se tromperait de personne.
 */
async function agence(statut: "ENDED" | "ACTIVE" | "TERMINATED" = "ENDED", locataire: Record<string, unknown> = {}) {
  const manager = await createManager();
  const property = await createProperty(manager.id, { title: "Studio Plateau", address: "12 rue Carnot, Dakar" });
  const autreLocataire = await createTenant(manager.id, { firstName: "Moussa", lastName: "Sow", email: "moussa@test.local" });
  const tenant = await createTenant(manager.id, { civility: "M", firstName: "Awa", lastName: "Diop", email: "awa@test.local", ...locataire });
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
  return { manager, property, tenant, autreLocataire, contract, h: authHeader(tokenFor(manager)) };
}

const apercu = (h: Record<string, string>, contractId: string, requete: Record<string, string> = {}) =>
  request(app).get(`/api/contracts/${contractId}/settlement/preview`).query({ exitDate: "2025-03-15", ...requete }).set(h);
const emettre = (h: Record<string, string>, contractId: string, corps: object = {}) =>
  request(app).post(`/api/contracts/${contractId}/settlements`).set(h).send({ exitDate: "2025-03-15", ...corps });
const regler = (h: Record<string, string>, contractId: string, soldeId: string) =>
  request(app).post(`/api/contracts/${contractId}/settlements/${soldeId}/settle`).set(h);

const lireSolde = async (id: string) => (await testDb.select().from(leaseSettlements).where(eq(leaseSettlements.id, id)))[0];
const lireTrace = async (action: string) => (await testDb.select().from(activityLogs).where(eq(activityLogs.action, action)))[0];

describe("date de sortie et bail introuvable", () => {
  it("refuse une date de sortie hors des années acceptées, avec son code et la plage", async () => {
    const { contract, h } = await agence();

    for (const date of ["1979-12-31", "2201-01-01"]) {
      const lecture = await apercu(h, contract.id, { exitDate: date });
      expect(lecture.status, date).toBe(400);
      expect(lecture.body.code, date).toBe("LEASE_DATE_OUT_OF_RANGE");
      expect(lecture.body.params, date).toEqual({ min: 1980, max: 2200 });
      const emission = await emettre(h, contract.id, { exitDate: date });
      expect(emission.status, date).toBe(400);
      expect(emission.body.code, date).toBe("LEASE_DATE_OUT_OF_RANGE");
    }
    expect(await testDb.select().from(leaseSettlements)).toHaveLength(0);
  });

  it("sans date de sortie demandée, l'émission prend la fin du bail ou aujourd'hui, et le mode complet", async () => {
    const { contract, h } = await agence();

    const res = await request(app).post(`/api/contracts/${contract.id}/settlements`).set(h).send({});

    expect(res.status).toBe(201);
    expect(res.body.lastMonthMode).toBe("FULL");
    expect(res.body.exitDate.slice(0, 10)).toBe("2026-11-25");
  });

  it("répond 404 CONTRACT_NOT_FOUND pour un bail inconnu, ou d'une autre agence même quand cette agence a ses propres biens", async () => {
    const { contract } = await agence();
    const autre = await createManager();
    await createProperty(autre.id, { title: "Bien de l'autre agence" });
    const hAutre = authHeader(tokenFor(autre));
    const appels = (id: string, h: Record<string, string>) => [
      request(app).get(`/api/contracts/${id}/settlement/preview`).set(h),
      request(app).get(`/api/contracts/${id}/settlements`).set(h),
      request(app).post(`/api/contracts/${id}/settlements`).set(h).send({ exitDate: "2025-03-15" }),
      request(app).post(`/api/contracts/${id}/settlements/inconnu/settle`).set(h),
    ];

    for (const [id, h] of [
      ["inconnu", hAutre],
      [contract.id, hAutre],
    ] as const) {
      for (const res of await Promise.all(appels(id, h))) {
        expect(res.status, id).toBe(404);
        expect(res.body.code, id).toBe("CONTRACT_NOT_FOUND");
      }
    }
  });

  it("l'aperçu rappelle le statut du bail", async () => {
    const termine = await agence("ENDED");
    const enCours = await agence("ACTIVE");

    expect((await apercu(termine.h, termine.contract.id)).body.contractStatus).toBe("ENDED");
    expect((await apercu(enCours.h, enCours.contract.id)).body.contractStatus).toBe("ACTIVE");
  });
});

describe("conditions d'émission", () => {
  const conge = (contractId: string, managerId: string, extra: Record<string, unknown> = {}) =>
    testDb.insert(leaseNotices).values({
      contractId,
      managerId,
      givenBy: "LANDLORD",
      deliveryMode: "BAILIFF",
      servedAt: new Date(Date.UTC(2025, 0, 10)),
      periodValue: 2,
      periodUnit: "MONTHS",
      exitDate: new Date(Date.UTC(2025, 2, 15)),
      ...extra,
    });

  it("un bail résilié s'émet sans congé : seul un bail en cours exige un congé", async () => {
    const { contract, h } = await agence("TERMINATED");

    expect((await emettre(h, contract.id)).status).toBe(201);
  });

  it("un bail en cours reste refusé si le congé est annulé, ou s'il concerne un autre bail", async () => {
    const { contract, manager, h } = await agence("ACTIVE");
    const autre = await agence("ACTIVE");
    await conge(contract.id, manager.id, { status: "CANCELLED" });
    await conge(autre.contract.id, autre.manager.id);

    const res = await emettre(h, contract.id);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SETTLEMENT_CONTRACT_STILL_ACTIVE");
    expect(res.body.error).toContain("Le bail est en cours");
  });

  it("un locataire anonymisé est refusé, quel que soit l'autre locataire de l'agence", async () => {
    const { contract, tenant, autreLocataire, h } = await agence();
    await testDb.update(tenants).set({ anonymizedAt: new Date() }).where(eq(tenants.id, autreLocataire.id));
    expect((await emettre(h, contract.id)).status).toBe(201);

    const seconde = await agence();
    await testDb.update(tenants).set({ anonymizedAt: new Date() }).where(eq(tenants.id, seconde.tenant.id));
    const res = await emettre(seconde.h, seconde.contract.id);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SETTLEMENT_TENANT_ANONYMIZED");
    expect(res.body.error).toContain("anonymisé");
    void tenant;
  });
});

describe("doublons : le contenu entier est comparé, avec le dernier solde de moins de 24 heures", () => {
  /** Enregistre un solde antérieur identique à ce que l'émission calculerait, sauf `ecart`. */
  async function precedent(contractId: string, managerId: string, h: Record<string, string>, ecart: Record<string, unknown> = {}, createdAt = new Date(2026, 10, 25, 10, 0)) {
    const { body } = await apercu(h, contractId);
    const [ligne] = await testDb
      .insert(leaseSettlements)
      .values({
        contractId,
        managerId,
        currency: body.currency,
        exitDate: new Date(body.exitDate),
        lastMonthMode: body.lastMonthMode,
        depositAmount: body.depositAmount,
        deductionsTotal: body.deductionsTotal,
        depositRefunded: body.depositRefunded,
        unpaidTotal: body.unpaidTotal,
        creditTotal: body.creditTotal,
        balance: body.balance,
        details: "{}",
        createdAt,
        ...ecart,
      })
      .returning();
    return ligne;
  }

  it("un solde identique est refusé, avec la référence et la date du précédent", async () => {
    const { contract, manager, h } = await agence();
    const avant = await precedent(contract.id, manager.id, h);

    const res = await emettre(h, contract.id);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SETTLEMENT_DUPLICATE");
    expect(res.body.params).toEqual({ reference: `SOLDE-2026-${avant.id.slice(0, 8).toUpperCase()}`, date: "25/11/2026" });
    expect(res.body.error).toBe(`Un solde de tout compte identique (réf. ${res.body.params.reference}) a déjà été émis le 25/11/2026 : rien n'a changé depuis.`);
  });

  it.each([
    ["la date de sortie", { exitDate: new Date(Date.UTC(2025, 2, 16)) }],
    ["le mode du dernier mois", { lastMonthMode: "PRORATA" }],
    ["le dépôt de garantie", { depositAmount: 1001 }],
    ["les retenues", { deductionsTotal: 1 }],
    ["la part du dépôt déjà restituée", { depositRefunded: 1 }],
    ["les loyers impayés", { unpaidTotal: 801 }],
    ["le trop-perçu", { creditTotal: 1 }],
    ["le solde", { balance: 201 }],
  ])("un seul écart sur %s suffit à permettre l'émission", async (_nom, ecart) => {
    const { contract, manager, h } = await agence();
    await precedent(contract.id, manager.id, h, ecart);

    const res = await emettre(h, contract.id);

    expect(res.status).toBe(201);
  });

  it("le délai est de 24 heures : un identique émis il y a 23 heures est refusé, pas une heure plus tard", async () => {
    const { contract, manager, h } = await agence();
    const ancien = await precedent(contract.id, manager.id, h, {}, new Date(2026, 10, 24, 13, 0));
    expect((await emettre(h, contract.id)).status).toBe(409);

    await testDb.update(leaseSettlements).set({ createdAt: new Date(2026, 10, 24, 11, 0) }).where(eq(leaseSettlements.id, ancien.id));
    expect((await emettre(h, contract.id)).status).toBe(201);
  });

  it("seul le dernier solde compte : un ancien identique, suivi d'un solde différent, n'empêche pas l'émission", async () => {
    const { contract, manager, h } = await agence();
    await precedent(contract.id, manager.id, h, {}, new Date(2026, 10, 25, 8, 0));
    await precedent(contract.id, manager.id, h, { balance: 999 }, new Date(2026, 10, 25, 10, 0));

    expect((await emettre(h, contract.id)).status).toBe(201);
  });

  it("le dernier solde est le plus récent, même s'il a été enregistré avant les autres", async () => {
    const { contract, manager, h } = await agence();
    await precedent(contract.id, manager.id, h, {}, new Date(2026, 10, 25, 10, 0));
    await precedent(contract.id, manager.id, h, { balance: 999 }, new Date(2026, 10, 25, 8, 0));

    const res = await emettre(h, contract.id);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SETTLEMENT_DUPLICATE");
  });
});

describe("ce que l'émission enregistre", () => {
  it("fige chaque montant du calcul, la devise, le gestionnaire et l'auteur", async () => {
    const { contract, manager, h } = await agence();
    await testDb
      .update(contracts)
      .set({ depositDeductions: JSON.stringify([{ label: "Peinture", amount: 150 }]), depositRefundedAt: new Date(2026, 10, 1) })
      .where(eq(contracts.id, contract.id));
    await testDb.update(invoices).set({ status: "PAID", amountPaid: 500 }).where(eq(invoices.contractId, contract.id));
    await createInvoice(contract.id, { periodMonth: 4, periodYear: 2025, amount: 500, status: "PENDING", dueDate: new Date(2025, 3, 5) });
    const calcul = (await apercu(h, contract.id, { lastMonth: "PRORATA" })).body;

    const res = await emettre(h, contract.id, { lastMonthMode: "PRORATA" });

    expect(res.status).toBe(201);
    const ligne = await lireSolde(res.body.id);
    expect(ligne).toMatchObject({
      contractId: contract.id,
      managerId: manager.id,
      createdBy: manager.id,
      currency: "XOF",
      lastMonthMode: "PRORATA",
      depositAmount: 1000,
      deductionsTotal: 150,
      depositRefunded: 850,
      unpaidTotal: 0,
      creditTotal: 258.06,
      balance: calcul.balance,
    });
    expect(ligne.exitDate.toISOString().slice(0, 10)).toBe("2025-03-15");
    const details = JSON.parse(ligne.details);
    expect(details.lignes).toHaveLength(3);
    expect(details.lignes[2]).toMatchObject({ periodMonth: 3, periodYear: 2025, amount: 500 });
    expect(details.deductions).toEqual([{ label: "Peinture", amount: 150 }]);
    expect(details.facturesApresSortie).toBe(1);
  });

  it("enregistre les loyers impayés et le solde quand rien n'est restitué", async () => {
    const { contract, h } = await agence();

    const res = await emettre(h, contract.id);

    expect(await lireSolde(res.body.id)).toMatchObject({ unpaidTotal: 800, creditTotal: 0, deductionsTotal: 0, depositRefunded: 0, balance: 200, depositAmount: 1000 });
  });

  it("un collaborateur est l'auteur de l'émission, l'agence reste le gestionnaire du solde", async () => {
    const { contract, manager } = await agence();
    const collaborateur = await createTeamMember(manager.id);
    const h = authHeader(tokenFor({ id: manager.id, role: "MANAGER" }, null, null, collaborateur.id));

    const res = await emettre(h, contract.id);

    expect(res.status).toBe(201);
    expect(await lireSolde(res.body.id)).toMatchObject({ createdBy: collaborateur.id, managerId: manager.id });
  });

  it("la réponse ne renvoie jamais le détail figé, mais la référence et les compteurs d'envoi", async () => {
    const { contract, h } = await agence();

    const res = await emettre(h, contract.id);

    expect(res.body.details).toBeUndefined();
    expect(res.body).toMatchObject({ emailEnvoye: false, colocatairesPrevenus: 0, balance: 200 });
    expect(res.body.reference).toBe(`SOLDE-2026-${res.body.id.slice(0, 8).toUpperCase()}`);
  });
});

describe("e-mails du solde", () => {
  async function agenceAvecReponse() {
    const base = await agence();
    await testDb.insert(agencySettings).values({ userId: base.manager.id, agencyName: "Agence Baobab", email: "contact@baobab.test" });
    return base;
  }

  it("écrit au locataire du bail, avec le PDF, le sujet, l'agence, le solde et l'adresse de réponse de l'agence", async () => {
    const { contract, h } = await agenceAvecReponse();
    const envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);

    const res = await emettre(h, contract.id, { sendEmail: true });

    expect(res.status).toBe(201);
    expect(envoi).toHaveBeenCalledTimes(1);
    const [destinataire, sujet, html, pieces, options] = envoi.mock.calls[0];
    expect(destinataire).toBe("awa@test.local");
    expect(sujet).toBe(`Solde de tout compte — Studio Plateau (réf. ${res.body.reference})`);
    expect(html).toContain("Monsieur Awa Diop");
    expect(html).toContain("Agence Baobab");
    expect(html).toContain("Studio Plateau");
    expect(html).toContain(res.body.reference);
    expect(html).toContain("Somme à vous restituer");
    expect(html).toContain(formaterMontant(200, "XOF"));
    expect(pieces).toHaveLength(1);
    expect(pieces?.[0]).toMatchObject({ filename: `solde-de-tout-compte-${res.body.reference}.pdf`, contentType: "application/pdf" });
    expect(options).toEqual({ replyTo: "contact@baobab.test" });
  });

  it("le courriel d'un solde à régler et celui d'un compte soldé le disent", async () => {
    const regle = await agence();
    await testDb.update(invoices).set({ amountPaid: 0 }).where(and(eq(invoices.contractId, regle.contract.id), eq(invoices.periodMonth, 2)));
    const solde = await emettre(regle.h, regle.contract.id, { sendEmail: true });
    expect(solde.body.balance).toBe(0);

    const du = await agence();
    await testDb
      .update(contracts)
      .set({ depositDeductions: JSON.stringify([{ label: "Peinture", amount: 150 }]), depositRefundedAt: new Date(2026, 10, 1) })
      .where(eq(contracts.id, du.contract.id));
    const envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
    await emettre(du.h, du.contract.id, { sendEmail: true });

    expect(envoi.mock.calls.some(([, , html]) => html.includes("Reste à régler") && html.includes(formaterMontant(800, "XOF")))).toBe(true);
  });

  it("sans adresse e-mail, aucun message n'est envoyé au locataire", async () => {
    const { contract, h } = await agence("ENDED", { email: "" });
    const envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);

    const res = await emettre(h, contract.id, { sendEmail: true });

    expect(res.status).toBe(201);
    expect(envoi).not.toHaveBeenCalled();
    expect(res.body.emailEnvoye).toBe(false);
    expect((await lireSolde(res.body.id)).emailSentAt).toBeNull();
  });

  it("un échec d'envoi est signalé, et la date d'envoi n'est pas enregistrée", async () => {
    const { contract, h } = await agence();
    vi.spyOn(emailService, "sendEmail").mockResolvedValue({ error: "boîte pleine" } as never);

    const res = await emettre(h, contract.id, { sendEmail: true });

    expect(res.status).toBe(201);
    expect(res.body.emailEnvoye).toBe(false);
    expect((await lireSolde(res.body.id)).emailSentAt).toBeNull();
    expect((await lireTrace("contract.settlement")).details).toContain(", e-mail NON parti.");
  });

  it("une réponse du service d'envoi sans erreur (champ vide) vaut pour un envoi réussi", async () => {
    const { contract, h } = await agence();
    vi.spyOn(emailService, "sendEmail").mockResolvedValue({ error: null } as never);

    const res = await emettre(h, contract.id, { sendEmail: true });

    expect(res.body.emailEnvoye).toBe(true);
    expect((await lireSolde(res.body.id)).emailSentAt).not.toBeNull();
  });

  it("la date d'envoi n'est portée que par le solde envoyé, pas par les soldes précédents du même bail", async () => {
    const { contract, h } = await agence();
    vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
    const premier = await emettre(h, contract.id, { exitDate: "2025-02-20" });
    const second = await emettre(h, contract.id, { sendEmail: true });

    expect((await lireSolde(premier.body.id)).emailSentAt).toBeNull();
    expect((await lireSolde(second.body.id)).emailSentAt).not.toBeNull();
  });

  it("les colocataires reçoivent la même pièce jointe, sous leur propre nom, et sont comptés ; un colocataire sans adresse est ignoré", async () => {
    const { contract, manager, h } = await agenceAvecReponse();
    const colocataire = await createTenant(manager.id, { civility: "MME", firstName: "Fatou", lastName: "Ba", email: "fatou@test.local" });
    const sansAdresse = await createTenant(manager.id, { firstName: "Ibou", lastName: "Fall", email: "" });
    await testDb.insert(contractCotenants).values([
      { contractId: contract.id, tenantId: colocataire.id },
      { contractId: contract.id, tenantId: sansAdresse.id },
    ]);
    const envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);

    const res = await emettre(h, contract.id, { sendEmail: true });

    expect(res.body.colocatairesPrevenus).toBe(1);
    expect(envoi).toHaveBeenCalledTimes(2);
    const [destinataire, , html, pieces, options] = envoi.mock.calls[1];
    expect(destinataire).toBe("fatou@test.local");
    expect(html).toContain("Madame Fatou Ba");
    expect(pieces?.[0]).toMatchObject({ filename: `solde-de-tout-compte-${res.body.reference}.pdf`, contentType: "application/pdf" });
    expect(options).toEqual({ replyTo: "contact@baobab.test" });
  });
});

describe("journal d'activité de l'émission", () => {
  const attendu = (reference: string, fin: string) => `Solde de tout compte ${reference} émis : ${fin}`;

  it("à restituer, sans envoi : l'entité, le libellé (sans civilité) et le texte", async () => {
    const { contract, manager, h } = await agence();

    const res = await emettre(h, contract.id);

    const trace = await lireTrace("contract.settlement");
    expect(trace).toMatchObject({ managerId: manager.id, entityType: "contract", entityId: contract.id, entityLabel: "Studio Plateau — Awa Diop" });
    expect(trace.details).toBe(attendu(res.body.reference, `${formaterMontant(200, "XOF")} à restituer au locataire, sans envoi par e-mail.`));
  });

  it("reste dû, avec envoi réussi", async () => {
    const { contract, h } = await agence();
    await testDb
      .update(contracts)
      .set({ depositDeductions: JSON.stringify([{ label: "Peinture", amount: 150 }]), depositRefundedAt: new Date(2026, 10, 1) })
      .where(eq(contracts.id, contract.id));
    vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);

    const res = await emettre(h, contract.id, { sendEmail: true });

    expect(res.body.balance).toBe(-800);
    expect((await lireTrace("contract.settlement")).details).toBe(attendu(res.body.reference, `${formaterMontant(800, "XOF")} restant dus par le locataire, envoyé par e-mail.`));
  });

  it("compte soldé", async () => {
    const { contract, h } = await agence();
    await testDb.update(invoices).set({ amountPaid: 0 }).where(and(eq(invoices.contractId, contract.id), eq(invoices.periodMonth, 2)));

    const res = await emettre(h, contract.id);

    expect(res.body.balance).toBe(0);
    expect((await lireTrace("contract.settlement")).details).toBe(attendu(res.body.reference, "compte soldé, sans envoi par e-mail."));
  });
});

describe("règlement d'un solde", () => {
  it("ne règle que le solde désigné, trace l'opération et ne renvoie ni détail ni solde voisin", async () => {
    const { contract, manager, h } = await agence();
    const premier = await emettre(h, contract.id, { exitDate: "2025-02-20" });
    const second = await emettre(h, contract.id);

    const res = await regler(h, contract.id, second.body.id);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(second.body.id);
    expect(res.body.reference).toBe(second.body.reference);
    expect(res.body.details).toBeUndefined();
    expect(res.body.settledAt).not.toBeNull();
    expect((await lireSolde(premier.body.id)).settledAt).toBeNull();
    expect((await lireSolde(second.body.id)).settledAt).not.toBeNull();
    const trace = await lireTrace("contract.settlement_settle");
    expect(trace).toMatchObject({ managerId: manager.id, entityType: "contract", entityId: contract.id, entityLabel: "Studio Plateau" });
    expect(trace.details).toBe(`Solde de tout compte ${second.body.reference} marqué comme réglé.`);
  });

  it("un identifiant de solde inconnu est introuvable, même sur un bail qui a des soldes", async () => {
    const { contract, h } = await agence();
    await emettre(h, contract.id);

    const res = await regler(h, contract.id, "inconnu");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SETTLEMENT_NOT_FOUND");
    expect(res.body.error).toBe("Solde de tout compte introuvable");
  });

  it("un solde déjà réglé ne l'est pas deux fois : la date du premier règlement est conservée", async () => {
    const { contract, h } = await agence();
    const { body } = await emettre(h, contract.id);
    await regler(h, contract.id, body.id);
    const date = (await lireSolde(body.id)).settledAt;
    vi.setSystemTime(new Date(2026, 10, 25, 12, 30));

    const second = await regler(h, contract.id, body.id);

    expect(second.status).toBe(409);
    expect(second.body.code).toBe("SETTLEMENT_ALREADY_SETTLED");
    expect((await lireSolde(body.id)).settledAt).toEqual(date);
  });
});

describe("document du solde", () => {
  it("un solde inconnu est introuvable (404 SETTLEMENT_NOT_FOUND), comme celui d'un autre", async () => {
    const { contract, h } = await agence();
    const { body } = await emettre(h, contract.id);

    const inconnu = await request(app).get("/api/documents/settlement/inconnu").set(h);
    const autre = await request(app).get(`/api/documents/settlement/${body.id}`).set(authHeader(tokenFor(await createManager())));
    const autreLocataire = await request(app)
      .get(`/api/documents/settlement/${body.id}`)
      .set(authHeader(await tokenLocataire((await createTenant((await createManager()).id)).id)));

    for (const res of [inconnu, autre, autreLocataire]) {
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("SETTLEMENT_NOT_FOUND");
      expect(res.body.error).toBe("Solde de tout compte introuvable");
    }
  });

  it("le document reprend le solde figé (somme à restituer, montant) et s'envoie en HTML", async () => {
    const { contract, h } = await agence();
    const { body } = await emettre(h, contract.id);

    const res = await request(app).get(`/api/documents/settlement/${body.id}`).set(h);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.text).toContain("Somme à restituer au locataire");
    expect(res.text).toContain(body.reference);
  });
});
