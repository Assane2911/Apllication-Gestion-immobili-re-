import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../app";
import { insurancePolicies, leaseNotices, rentRevisions, storedDocuments } from "../db/schema";
import { authHeader, createContract, createInsurancePolicy, createInvoice, createManager, createOwner, createProperty, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { chargerAgenda, chargerAgendaProprietaire, resumeAgenda } from "./agenda.service";

/**
 * Audit par sabotage de agenda.service.ts : l'agenda n'avait presque aucun test sur le CONTENU exact de ses événements. Chaque
 * type d'échéance est comparé champ par champ, les bornes (fenêtre, 90 jours de conservation, plafond de 1 000, semaine du
 * résumé) sont testées à la limite exacte, et l'isolation entre agences / propriétaires est vérifiée sur TOUS les types.
 *
 * Les fonctions du service reçoivent « maintenant » en paramètre : aucun horloge à figer. Référence : le 15 juin 2026 à 8 h
 * (heure locale, UTC en test et en CI). Les dates sont écrites à minuit local, comme celles de l'application.
 */
const MAINT = new Date(2026, 5, 15, 8, 0, 0);
const d = (annee: number, mois: number, jour: number, heure = 0, minute = 0) => new Date(annee, mois - 1, jour, heure, minute);

afterEach(() => vi.restoreAllMocks());

async function agence(titre = "Villa Baobab") {
  const manager = await createManager();
  const property = await createProperty(manager.id, { title: titre });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Sow" });
  const contract = await createContract(property.id, tenant.id, { endDate: d(2027, 1, 1) }); // hors de toute fenêtre testée
  return { manager, property, tenant, contract };
}

/** Un bail actif sur son propre bien (un seul bail actif par bien), avec un locataire nommé. */
async function bail(managerId: string, titre: string, locataire: [string, string], surcharge: Partial<typeof import("../db/schema").contracts.$inferInsert>, ownerId?: string) {
  const property = await createProperty(managerId, { title: titre, ...(ownerId ? { ownerId } : {}) });
  const tenant = await createTenant(managerId, { firstName: locataire[0], lastName: locataire[1] });
  const contract = await createContract(property.id, tenant.id, surcharge);
  return { property, tenant, contract };
}

async function conge(managerId: string, contractId: string, exitDate: Date, extra: Partial<typeof leaseNotices.$inferInsert> = {}) {
  const [notice] = await testDb
    .insert(leaseNotices)
    .values({ contractId, managerId, givenBy: "TENANT", deliveryMode: "EMAIL", servedAt: d(2026, 5, 1), periodValue: 1, periodUnit: "MONTHS", exitDate, ...extra })
    .returning();
  return notice;
}

async function revision(contractId: string, effectiveDate: Date, extra: Partial<typeof rentRevisions.$inferInsert> = {}) {
  const [r] = await testDb.insert(rentRevisions).values({ contractId, previousRent: 500, newRent: 520, effectiveDate, method: "AMOUNT", ...extra }).returning();
  return r;
}

const DOC = { filePath: "documents/x.pdf", fileName: "x.pdf", mimeType: "application/pdf", sizeBytes: 1 };
async function document(managerId: string, extra: Partial<typeof storedDocuments.$inferInsert>) {
  const [doc] = await testDb.insert(storedDocuments).values({ managerId, ...DOC, ...extra } as typeof storedDocuments.$inferInsert).returning();
  return doc;
}

const ids = (liste: Array<{ id: string }>) => liste.map((e) => e.id);

describe("agenda de l'agence : le contenu exact de chaque type d'échéance", () => {
  it("loyers : reste dû, devise, bien, bail et locataire ; en retard par le statut OU par la date ; soldés et annulés absents", async () => {
    const { manager, property, contract } = await agence();
    const aVenir = await createInvoice(contract.id, { periodMonth: 6, dueDate: d(2026, 6, 20), amount: 500, amountPaid: 200, currency: "XOF" });
    const retardParDate = await createInvoice(contract.id, { periodMonth: 5, dueDate: d(2026, 6, 5), status: "PENDING", amount: 400, currency: "XOF" });
    const retardParStatut = await createInvoice(contract.id, { periodMonth: 7, dueDate: d(2026, 7, 5), status: "LATE", amount: 300, currency: "XOF" });
    const surpayee = await createInvoice(contract.id, { periodMonth: 8, dueDate: d(2026, 6, 22), amount: 500, amountPaid: 700, currency: "XOF" });
    await createInvoice(contract.id, { periodMonth: 4, dueDate: d(2026, 6, 1), status: "PAID" });
    await createInvoice(contract.id, { periodMonth: 3, dueDate: d(2026, 6, 2), status: "CANCELLED" });
    await createInvoice(contract.id, { periodMonth: 9, dueDate: d(2026, 8, 1) }); // au-delà de l'horizon

    const liste = await chargerAgenda(manager.id, 30, MAINT);

    expect(ids(liste)).toEqual([`RENT_DUE:${retardParDate.id}`, `RENT_DUE:${retardParStatut.id}`, `RENT_DUE:${aVenir.id}`, `RENT_DUE:${surpayee.id}`]);
    expect(liste[2]).toEqual({
      id: `RENT_DUE:${aVenir.id}`,
      type: "RENT_DUE",
      date: d(2026, 6, 20),
      enRetard: false,
      propertyId: property.id,
      propertyTitle: "Villa Baobab",
      contractId: contract.id,
      tenantName: "Awa Sow",
      amount: 300, // 500 dus, 200 payés
      currency: "XOF",
      label: null,
    });
    expect(liste.map((e) => e.enRetard)).toEqual([true, true, false, false]);
    expect(liste[3].amount).toBe(0); // surpayée : jamais négatif, jamais 1
  });

  it("fins de bail : événement complet ; un bail dépassé est en retard ; un bail clôturé ou résilié n'est jamais affiché", async () => {
    const { manager } = await agence();
    const a = await bail(manager.id, "Villa A", ["Awa", "Sow"], { endDate: d(2026, 7, 10) });
    const b = await bail(manager.id, "Villa B", ["Moussa", "Diop"], { endDate: d(2026, 6, 1) }); // dépassé, encore actif
    await bail(manager.id, "Villa C", ["C", "C"], { endDate: d(2026, 6, 10), status: "ENDED" });
    await bail(manager.id, "Villa D", ["D", "D"], { endDate: d(2026, 6, 11), status: "TERMINATED" });

    const liste = (await chargerAgenda(manager.id, 30, MAINT)).filter((e) => e.type === "LEASE_END");

    expect(ids(liste)).toEqual([`LEASE_END:${b.contract.id}`, `LEASE_END:${a.contract.id}`]);
    expect(liste[1]).toEqual({
      id: `LEASE_END:${a.contract.id}`,
      type: "LEASE_END",
      date: d(2026, 7, 10),
      enRetard: false,
      propertyId: a.property.id,
      propertyTitle: "Villa A",
      contractId: a.contract.id,
      tenantName: "Awa Sow",
      amount: null,
      currency: null,
      label: null,
    });
    expect(liste[0]).toMatchObject({ enRetard: true, tenantName: "Moussa Diop", propertyTitle: "Villa B" });
  });

  it("congés : événement complet ; le congé remplace la fin de SON bail seulement ; congé inactif, bail clôturé : ignorés", async () => {
    const { manager } = await agence();
    const x = await bail(manager.id, "Villa X", ["Awa", "Sow"], { endDate: d(2026, 9, 30) });
    const avecConge = await conge(manager.id, x.contract.id, d(2026, 7, 1), { reason: "Mutation" });
    const y = await bail(manager.id, "Villa Y", ["Moussa", "Diop"], { endDate: d(2026, 12, 31) });
    const congeEnRetard = await conge(manager.id, y.contract.id, d(2026, 6, 5)); // sans motif
    const z = await bail(manager.id, "Villa Z", ["Z", "Z"], { endDate: d(2026, 7, 3) });
    await conge(manager.id, z.contract.id, d(2026, 7, 8), { status: "CANCELLED" }); // retiré : la fin de bail reste
    const w = await bail(manager.id, "Villa W", ["W", "W"], { endDate: d(2026, 7, 12) }); // sans congé : sa fin de bail reste
    const t = await bail(manager.id, "Villa T", ["T", "T"], { endDate: d(2026, 12, 31), status: "TERMINATED" });
    await conge(manager.id, t.contract.id, d(2026, 7, 9)); // bail résilié : le congé ne compte pas

    const liste = (await chargerAgenda(manager.id, 30, MAINT)).filter((e) => e.type === "EXIT" || e.type === "LEASE_END");

    expect(ids(liste)).toEqual([`EXIT:${congeEnRetard.id}`, `EXIT:${avecConge.id}`, `LEASE_END:${z.contract.id}`, `LEASE_END:${w.contract.id}`]);
    expect(liste[1]).toEqual({
      id: `EXIT:${avecConge.id}`,
      type: "EXIT",
      date: d(2026, 7, 1),
      enRetard: false,
      propertyId: x.property.id,
      propertyTitle: "Villa X",
      contractId: x.contract.id,
      tenantName: "Awa Sow",
      amount: null,
      currency: null,
      label: "Mutation",
    });
    expect(liste[0]).toMatchObject({ enRetard: true, label: null, tenantName: "Moussa Diop" }); // sans motif : null, pas une chaîne vide
  });

  it("révisions de loyer : événement complet (nouveau loyer, devise du bail) ; appliquées et hors horizon écartées ; en retard par la date", async () => {
    const { manager } = await agence();
    const a = await bail(manager.id, "Villa A", ["Awa", "Sow"], { endDate: d(2027, 1, 1), currency: "XOF" });
    const aVenir = await revision(a.contract.id, d(2026, 7, 1), { newRent: 520 });
    const b = await bail(manager.id, "Villa B", ["Moussa", "Diop"], { endDate: d(2027, 1, 1) });
    const enRetard = await revision(b.contract.id, d(2026, 6, 1));
    const c = await bail(manager.id, "Villa C", ["C", "C"], { endDate: d(2027, 1, 1) });
    await revision(c.contract.id, d(2026, 6, 2), { status: "APPLIED" });
    const e = await bail(manager.id, "Villa E", ["E", "E"], { endDate: d(2027, 1, 1) });
    await revision(e.contract.id, d(2026, 8, 1)); // au-delà de l'horizon

    const liste = await chargerAgenda(manager.id, 30, MAINT);

    expect(ids(liste)).toEqual([`RENT_REVISION:${enRetard.id}`, `RENT_REVISION:${aVenir.id}`]);
    expect(liste[1]).toEqual({
      id: `RENT_REVISION:${aVenir.id}`,
      type: "RENT_REVISION",
      date: d(2026, 7, 1),
      enRetard: false,
      propertyId: a.property.id,
      propertyTitle: "Villa A",
      contractId: a.contract.id,
      tenantName: "Awa Sow",
      amount: 520,
      currency: "XOF",
      label: null,
    });
    expect(liste[0].enRetard).toBe(true);
  });

  it("assurances : événement complet (assureur en libellé) ; conservées jusqu'à 90 jours après l'échéance, pas 91", async () => {
    const { manager, property } = await agence();
    const aVenir = await createInsurancePolicy(property.id, { insurerName: "AXA", policyNumber: "P-1", expiryDate: d(2026, 7, 10) });
    const enRetard = await createInsurancePolicy(property.id, { policyNumber: "P-2", expiryDate: d(2026, 6, 1) });
    const limite90 = await createInsurancePolicy(property.id, { policyNumber: "P-90", expiryDate: d(2026, 3, 17) }); // 90 jours
    await createInsurancePolicy(property.id, { policyNumber: "P-91", expiryDate: d(2026, 3, 16) }); // 91 jours : plus une échéance

    const liste = await chargerAgenda(manager.id, 30, MAINT);

    expect(ids(liste)).toEqual([`INSURANCE_EXPIRY:${limite90.id}`, `INSURANCE_EXPIRY:${enRetard.id}`, `INSURANCE_EXPIRY:${aVenir.id}`]);
    expect(liste[2]).toEqual({
      id: `INSURANCE_EXPIRY:${aVenir.id}`,
      type: "INSURANCE_EXPIRY",
      date: d(2026, 7, 10),
      enRetard: false,
      propertyId: property.id,
      propertyTitle: "Villa Baobab",
      contractId: null,
      tenantName: null,
      amount: null,
      currency: null,
      label: "AXA",
    });
    expect(liste.map((e) => e.enRetard)).toEqual([true, true, false]);
  });

  it("documents : événement complet (bien, locataire, intitulé) ; sans date ou périmés depuis plus de 90 jours : absents", async () => {
    const { manager, property, tenant } = await agence();
    const lesDeux = await document(manager.id, { propertyId: property.id, tenantId: tenant.id, title: "Bail signé", expiresAt: d(2026, 7, 10) });
    const bienSeul = await document(manager.id, { propertyId: property.id, title: "Diagnostic gaz", expiresAt: d(2026, 7, 11) });
    const locataireSeul = await document(manager.id, { tenantId: tenant.id, title: "Titre de séjour", expiresAt: d(2026, 6, 1) });
    const limite90 = await document(manager.id, { propertyId: property.id, title: "Limite 90", expiresAt: d(2026, 3, 17) });
    await document(manager.id, { propertyId: property.id, title: "Limite 91", expiresAt: d(2026, 3, 16) });
    await document(manager.id, { propertyId: property.id, title: "Sans date" });

    const liste = (await chargerAgenda(manager.id, 30, MAINT)).filter((e) => e.type === "DOCUMENT_EXPIRY");

    expect(ids(liste)).toEqual([`DOCUMENT_EXPIRY:${limite90.id}`, `DOCUMENT_EXPIRY:${locataireSeul.id}`, `DOCUMENT_EXPIRY:${lesDeux.id}`, `DOCUMENT_EXPIRY:${bienSeul.id}`]);
    expect(liste[2]).toEqual({
      id: `DOCUMENT_EXPIRY:${lesDeux.id}`,
      type: "DOCUMENT_EXPIRY",
      date: d(2026, 7, 10),
      enRetard: false,
      propertyId: property.id,
      propertyTitle: "Villa Baobab",
      contractId: null,
      tenantName: "Awa Sow",
      amount: null,
      currency: null,
      label: "Bail signé",
    });
    expect(liste[1]).toMatchObject({ propertyId: null, propertyTitle: null, tenantName: "Awa Sow", enRetard: true }); // rangé au seul nom du locataire
    expect(liste[3]).toMatchObject({ tenantName: null, propertyTitle: "Villa Baobab" });
  });

  it("le nom du locataire n'a ni blanc de tête ni blanc de queue quand le prénom ou le nom est vide", async () => {
    const { manager } = await agence();
    const sansPrenom = await bail(manager.id, "Villa A", ["", "Sow"], { endDate: d(2026, 7, 10) });
    const sansNom = await bail(manager.id, "Villa B", ["Awa", ""], { endDate: d(2026, 7, 11) });

    const liste = await chargerAgenda(manager.id, 30, MAINT);

    expect(liste.find((e) => e.contractId === sansPrenom.contract.id)?.tenantName).toBe("Sow");
    expect(liste.find((e) => e.contractId === sansNom.contract.id)?.tenantName).toBe("Awa");
  });
});

describe("agenda de l'agence : fenêtre, tri, plafond", () => {
  it("la fenêtre se termine à MINUIT du dernier jour : la veille et minuit pile passent, 5 h du matin et le lendemain non", async () => {
    const { manager, property } = await agence();
    const veille = await createInsurancePolicy(property.id, { policyNumber: "J-1", expiryDate: d(2026, 7, 14) });
    const dernier = await createInsurancePolicy(property.id, { policyNumber: "J", expiryDate: d(2026, 7, 15) });
    await createInsurancePolicy(property.id, { policyNumber: "J-5H", expiryDate: d(2026, 7, 15, 5) });
    await createInsurancePolicy(property.id, { policyNumber: "J+1", expiryDate: d(2026, 7, 16) });

    const liste = await chargerAgenda(manager.id, 30, MAINT);

    expect(ids(liste)).toEqual([`INSURANCE_EXPIRY:${veille.id}`, `INSURANCE_EXPIRY:${dernier.id}`]);
  });

  it("par défaut 180 jours (le 180ᵉ jour passe, le 181ᵉ non) ; ?days= accepte 366 et refuse 367", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(MAINT);
    try {
      const { manager, property } = await agence();
      const jour180 = await createInsurancePolicy(property.id, { policyNumber: "J180", expiryDate: d(2026, 12, 12) });
      await createInsurancePolicy(property.id, { policyNumber: "J181", expiryDate: d(2026, 12, 13) });
      const lire = (query = "") => request(app).get(`/api/agenda${query}`).set(authHeader(tokenFor(manager)));

      const parDefaut = await lire();
      expect(ids(parDefaut.body)).toEqual([`INSURANCE_EXPIRY:${jour180.id}`]);
      expect((await lire("?days=366")).status).toBe(200);
      expect((await lire("?days=367")).status).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });

  it("en retard d'abord, même quand sa date est plus tardive (loyer en retard au statut), puis par date, puis par identifiant", async () => {
    const { manager, property, contract } = await agence();
    const retardTardif = await createInvoice(contract.id, { periodMonth: 7, dueDate: d(2026, 7, 5), status: "LATE" });
    const junio = await createInsurancePolicy(property.id, { policyNumber: "JUIN", expiryDate: d(2026, 6, 20) });
    // Deux échéances à la MÊME date, insérées dans l'ordre inverse de leurs identifiants.
    const b = await createInsurancePolicy(property.id, { id: "pol-b", policyNumber: "B", expiryDate: d(2026, 7, 1) });
    const a = await createInsurancePolicy(property.id, { id: "pol-a", policyNumber: "A", expiryDate: d(2026, 7, 1) });

    const liste = await chargerAgenda(manager.id, 30, MAINT);

    expect(ids(liste)).toEqual([`RENT_DUE:${retardTardif.id}`, `INSURANCE_EXPIRY:${junio.id}`, `INSURANCE_EXPIRY:${a.id}`, `INSURANCE_EXPIRY:${b.id}`]);
  });

  it("ne renvoie jamais plus de 1 000 échéances : les 1 000 premières dans l'ordre", async () => {
    const { manager, property } = await agence();
    const numero = (i: number) => String(i).padStart(4, "0");
    await testDb.insert(insurancePolicies).values(
      Array.from({ length: 1001 }, (_, i) => ({ id: `cap-${numero(i)}`, propertyId: property.id, insurerName: "X", policyNumber: `CAP-${numero(i)}`, expiryDate: d(2026, 6, 16, 0, i) }))
    );

    const liste = await chargerAgenda(manager.id, 30, MAINT);

    expect(liste).toHaveLength(1000);
    expect(liste[0].id).toBe("INSURANCE_EXPIRY:cap-0000");
    expect(liste[999].id).toBe("INSURANCE_EXPIRY:cap-0999");
  });
});

describe("agenda de l'agence : jamais les échéances d'une autre agence, pour AUCUN type", () => {
  async function peupler(managerId: string, nom: string) {
    const loyer = await bail(managerId, `Loyer ${nom}`, ["Awa", nom], { endDate: d(2027, 1, 1) });
    const facture = await createInvoice(loyer.contract.id, { periodMonth: 6, dueDate: d(2026, 6, 20) });
    const finDeBail = await bail(managerId, `Fin ${nom}`, ["Awa", nom], { endDate: d(2026, 7, 10) });
    const sortie = await bail(managerId, `Sortie ${nom}`, ["Awa", nom], { endDate: d(2027, 1, 1) });
    const avecConge = await conge(managerId, sortie.contract.id, d(2026, 7, 1));
    const rev = await bail(managerId, `Révision ${nom}`, ["Awa", nom], { endDate: d(2027, 1, 1) });
    const maRevision = await revision(rev.contract.id, d(2026, 7, 2));
    const assurance = await createInsurancePolicy(loyer.property.id, { policyNumber: `POL-${nom}`, expiryDate: d(2026, 7, 3) });
    const doc = await document(managerId, { propertyId: loyer.property.id, tenantId: loyer.tenant.id, title: `Doc ${nom}`, expiresAt: d(2026, 7, 4) });
    return [
      `RENT_DUE:${facture.id}`,
      `LEASE_END:${finDeBail.contract.id}`,
      `EXIT:${avecConge.id}`,
      `RENT_REVISION:${maRevision.id}`,
      `INSURANCE_EXPIRY:${assurance.id}`,
      `DOCUMENT_EXPIRY:${doc.id}`,
    ];
  }

  it("chaque gestionnaire ne voit que ses six échéances, une de chaque type", async () => {
    const premier = await createManager();
    const second = await createManager();
    const siennes = await peupler(premier.id, "Sow");
    const autres = await peupler(second.id, "Diop");

    const listePremier = ids(await chargerAgenda(premier.id, 30, MAINT));
    const listeSecond = ids(await chargerAgenda(second.id, 30, MAINT));

    expect([...listePremier].sort()).toEqual([...siennes].sort());
    expect([...listeSecond].sort()).toEqual([...autres].sort());
  });
});

describe("résumé du tableau de bord : semaine, retard hors loyers, horloge", () => {
  it("compte les échéances jusqu'au 7ᵉ jour inclus (pas le 8ᵉ), les retards avec et sans les loyers, à la date de référence donnée", async () => {
    const { manager, property, contract } = await agence();
    await createInvoice(contract.id, { periodMonth: 4, dueDate: d(2026, 6, 1), status: "PENDING" }); // retard (loyer)
    await createInvoice(contract.id, { periodMonth: 5, dueDate: d(2026, 6, 3), status: "LATE" }); // retard (loyer)
    await createInsurancePolicy(property.id, { policyNumber: "RETARD", expiryDate: d(2026, 6, 10) }); // retard (hors loyers)
    await createInsurancePolicy(property.id, { policyNumber: "J2", expiryDate: d(2026, 6, 16) }); // à venir
    await createInsurancePolicy(property.id, { policyNumber: "J7", expiryDate: d(2026, 6, 22) }); // 7ᵉ jour : compté
    await createInsurancePolicy(property.id, { policyNumber: "J8", expiryDate: d(2026, 6, 23) }); // 8ᵉ jour : non

    const resume = await resumeAgenda(manager.id, MAINT);

    expect(resume).toEqual({ overdue: 3, overdueOther: 1, soon: 2 });
  });
});

describe("agenda du propriétaire", () => {
  async function proprietaire() {
    const manager = await createManager();
    const owner = await createOwner(manager.id);
    return { manager, owner };
  }

  it("fins de bail, sorties et assurances de SES biens : événements complets, sans aucune donnée du locataire ni motif", async () => {
    const { manager, owner } = await proprietaire();
    const a = await bail(manager.id, "Résidence A", ["Awa", "Sow"], { endDate: d(2026, 7, 10) }, owner.id);
    const enRetard = await bail(manager.id, "Résidence B", ["Moussa", "Diop"], { endDate: d(2026, 6, 1) }, owner.id);
    const c = await bail(manager.id, "Résidence C", ["C", "C"], { endDate: d(2026, 12, 31) }, owner.id);
    const sortie = await conge(manager.id, c.contract.id, d(2026, 7, 1), { reason: "Mutation" });
    const d2 = await bail(manager.id, "Résidence D", ["D", "D"], { endDate: d(2026, 12, 31) }, owner.id);
    const sortieEnRetard = await conge(manager.id, d2.contract.id, d(2026, 6, 5));
    const z = await bail(manager.id, "Résidence Z", ["Z", "Z"], { endDate: d(2026, 7, 3) }, owner.id);
    await conge(manager.id, z.contract.id, d(2026, 7, 8), { status: "CANCELLED" }); // retiré : la fin de bail de Z reste
    const w = await bail(manager.id, "Résidence W", ["W", "W"], { endDate: d(2026, 7, 12) }, owner.id); // sans congé
    const t = await bail(manager.id, "Résidence T", ["T", "T"], { endDate: d(2026, 12, 31), status: "TERMINATED" }, owner.id);
    await conge(manager.id, t.contract.id, d(2026, 7, 9)); // bail résilié
    await bail(manager.id, "Résidence E", ["E", "E"], { endDate: d(2026, 6, 10), status: "ENDED" }, owner.id);
    const aujourdhui = await bail(manager.id, "Résidence H", ["H", "H"], { endDate: d(2026, 6, 15) }, owner.id); // aujourd'hui : pas un retard
    const aXA = await createInsurancePolicy(a.property.id, { insurerName: "AXA", policyNumber: "P-1", expiryDate: d(2026, 7, 14) });
    const limite90 = await createInsurancePolicy(a.property.id, { policyNumber: "P-90", expiryDate: d(2026, 3, 17) });
    await createInsurancePolicy(a.property.id, { policyNumber: "P-91", expiryDate: d(2026, 3, 16) });

    const liste = await chargerAgendaProprietaire(owner.id, 30, MAINT);

    expect(ids(liste)).toEqual([
      `INSURANCE_EXPIRY:${limite90.id}`, // 90 jours : conservée
      `LEASE_END:${enRetard.contract.id}`,
      `EXIT:${sortieEnRetard.id}`,
      `LEASE_END:${aujourdhui.contract.id}`,
      `EXIT:${sortie.id}`,
      `LEASE_END:${z.contract.id}`,
      `LEASE_END:${a.contract.id}`,
      `LEASE_END:${w.contract.id}`,
      `INSURANCE_EXPIRY:${aXA.id}`,
    ]);
    expect(liste.map((e) => e.enRetard)).toEqual([true, true, true, false, false, false, false, false, false]);
    const parId = (id: string) => liste.find((e) => e.id === id)!;
    expect(parId(`LEASE_END:${a.contract.id}`)).toEqual({
      id: `LEASE_END:${a.contract.id}`,
      type: "LEASE_END",
      date: d(2026, 7, 10),
      enRetard: false,
      propertyId: a.property.id,
      propertyTitle: "Résidence A",
      contractId: null,
      tenantName: null,
      amount: null,
      currency: null,
      label: null,
    });
    expect(parId(`EXIT:${sortie.id}`)).toEqual({
      id: `EXIT:${sortie.id}`,
      type: "EXIT",
      date: d(2026, 7, 1),
      enRetard: false,
      propertyId: c.property.id,
      propertyTitle: "Résidence C",
      contractId: null,
      tenantName: null,
      amount: null,
      currency: null,
      label: null, // le motif du congé n'est jamais exposé au propriétaire
    });
    expect(parId(`INSURANCE_EXPIRY:${aXA.id}`)).toEqual({
      id: `INSURANCE_EXPIRY:${aXA.id}`,
      type: "INSURANCE_EXPIRY",
      date: d(2026, 7, 14),
      enRetard: false,
      propertyId: a.property.id,
      propertyTitle: "Résidence A",
      contractId: null,
      tenantName: null,
      amount: null,
      currency: null,
      label: "AXA",
    });
  });

  it("jamais les biens d'un autre propriétaire ni ceux sans propriétaire", async () => {
    const { manager, owner } = await proprietaire();
    const autre = await createOwner(manager.id);
    const mien = await bail(manager.id, "Mon bien", ["A", "A"], { endDate: d(2026, 7, 10) }, owner.id);
    const sien = await bail(manager.id, "Son bien", ["B", "B"], { endDate: d(2026, 7, 11) }, autre.id);
    const sansProprietaire = await bail(manager.id, "Sans propriétaire", ["C", "C"], { endDate: d(2026, 7, 12) });
    const congeSien = await bail(manager.id, "Son bien 2", ["D", "D"], { endDate: d(2026, 12, 31) }, autre.id);
    await conge(manager.id, congeSien.contract.id, d(2026, 7, 2));
    await createInsurancePolicy(sien.property.id, { policyNumber: "SIENNE", expiryDate: d(2026, 7, 3) });
    await createInsurancePolicy(sansProprietaire.property.id, { policyNumber: "ORPHELINE", expiryDate: d(2026, 7, 4) });

    const liste = await chargerAgendaProprietaire(owner.id, 30, MAINT);

    expect(ids(liste)).toEqual([`LEASE_END:${mien.contract.id}`]);
  });

  it("la fenêtre se termine à minuit du dernier jour", async () => {
    const { manager, owner } = await proprietaire();
    const { property } = await bail(manager.id, "Résidence", ["A", "A"], { endDate: d(2027, 1, 1) }, owner.id);
    const veille = await createInsurancePolicy(property.id, { policyNumber: "J-1", expiryDate: d(2026, 7, 14) });
    const dernier = await createInsurancePolicy(property.id, { policyNumber: "J", expiryDate: d(2026, 7, 15) });
    await createInsurancePolicy(property.id, { policyNumber: "J-5H", expiryDate: d(2026, 7, 15, 5) });
    await createInsurancePolicy(property.id, { policyNumber: "J+1", expiryDate: d(2026, 7, 16) });

    const liste = await chargerAgendaProprietaire(owner.id, 30, MAINT);

    expect(ids(liste)).toEqual([`INSURANCE_EXPIRY:${veille.id}`, `INSURANCE_EXPIRY:${dernier.id}`]);
  });

  it("ne renvoie jamais plus de 1 000 échéances", async () => {
    const { manager, owner } = await proprietaire();
    const { property } = await bail(manager.id, "Résidence", ["A", "A"], { endDate: d(2027, 1, 1) }, owner.id);
    const numero = (i: number) => String(i).padStart(4, "0");
    await testDb.insert(insurancePolicies).values(
      Array.from({ length: 1001 }, (_, i) => ({ id: `cap-${numero(i)}`, propertyId: property.id, insurerName: "X", policyNumber: `CAP-${numero(i)}`, expiryDate: d(2026, 6, 16, 0, i) }))
    );

    const liste = await chargerAgendaProprietaire(owner.id, 30, MAINT);

    expect(liste).toHaveLength(1000);
    expect(liste[999].id).toBe("INSURANCE_EXPIRY:cap-0999");
  });
});
