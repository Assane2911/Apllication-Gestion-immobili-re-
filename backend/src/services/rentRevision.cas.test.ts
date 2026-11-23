import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agencySettings, contractCotenants, contracts, invoices, rentRevisions } from "../db/schema";
import * as emailService from "./email.service";
import { rentRevisionEmail } from "./email.service";
import { TEXTES_SUITE } from "./email.suite.textes";
import { oublierAdressesDeReponse } from "./reponseAgence.service";
import {
  annulerRevision,
  appliquerRevisionsDues,
  bauxAReviser,
  calculerNouveauLoyer,
  creerRevision,
  listerRevisions,
  motifRevision,
  numeroAvenant,
  revisionsAppliquees,
} from "./rentRevision.service";
import { MONTANT_MAXIMUM } from "../utils/montant";
import { createContract, createInvoice, createManager, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Cas limites de la révision de loyer (rentRevision.service.ts), trouvés en sabotant le service : chaque test ci-dessous
 * échoue si la ligne qu'il garde est modifiée, alors que les tests existants passaient tous.
 * Aujourd'hui (horloge figée) : 12 octobre 2026.
 */
const MAINTENANT = new Date("2026-10-12T09:00:00Z");
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

let envoi: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  oublierAdressesDeReponse();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MAINTENANT);
  envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function agence(contratExtra: Partial<typeof contracts.$inferInsert> = {}, tenantExtra: Record<string, unknown> = {}) {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
  const property = await createProperty(manager.id, { title: "Studio A" });
  const tenant = await createTenant(manager.id, { email: "locataire@example.com", firstName: "Awa", lastName: "Ndiaye", ...tenantExtra });
  const contract = await createContract(property.id, tenant.id, { rent: 500, startDate: utc("2026-01-01"), endDate: utc("2027-12-31"), ...contratExtra });
  return { manager, property, tenant, contract };
}

/** Un second bail, sur un autre bien et avec un autre locataire, pour la même agence. */
async function autreBail(managerId: string, extra: Partial<typeof contracts.$inferInsert> = {}) {
  const property = await createProperty(managerId, { title: "Studio B" });
  const tenant = await createTenant(managerId, { email: `autre-${Math.random()}@example.com` });
  const contract = await createContract(property.id, tenant.id, { rent: 500, startDate: utc("2026-01-01"), endDate: utc("2027-12-31"), ...extra });
  return { property, tenant, contract };
}

const creer = (managerId: string, contractId: string, extra: Partial<Parameters<typeof creerRevision>[0]> = {}) =>
  creerRevision({
    contractId,
    managerId,
    entree: { mode: "PERCENT", percent: 10 },
    effectiveDate: utc("2026-11-01"),
    prevenirLocataire: false,
    maintenant: MAINTENANT,
    ...extra,
  });

const revision = async (contractId: string, extra: Partial<typeof rentRevisions.$inferInsert> = {}) => {
  const [ligne] = await testDb
    .insert(rentRevisions)
    .values({ contractId, previousRent: 500, newRent: 550, effectiveDate: utc("2026-11-01"), method: "AMOUNT", ...extra })
    .returning();
  return ligne;
};
const lire = async (id: string) => (await testDb.select().from(rentRevisions).where(eq(rentRevisions.id, id)))[0];

describe("calculerNouveauLoyer — bornes et codes", () => {
  const erreur = (entree: Parameters<typeof calculerNouveauLoyer>[1], loyer = 500) => {
    try {
      calculerNouveauLoyer(loyer, entree);
    } catch (err) {
      return err as { code?: string };
    }
    throw new Error("aucune erreur levée");
  };

  it("accepte -50 % et 100 % ainsi que les valeurs voisines, refuse au-delà", () => {
    expect(calculerNouveauLoyer(500, { mode: "PERCENT", percent: -50 })).toBe(250);
    expect(calculerNouveauLoyer(500, { mode: "PERCENT", percent: -49.5 })).toBe(252.5);
    expect(calculerNouveauLoyer(500, { mode: "PERCENT", percent: 100 })).toBe(1000);
    expect(erreur({ mode: "PERCENT", percent: 100.5 }).code).toBe("REVISION_PERCENT_RANGE");
    expect(erreur({ mode: "PERCENT", percent: -50.5 }).code).toBe("REVISION_PERCENT_RANGE");
  });

  it("refuse une valeur d'indice nulle, nouvelle comme ancienne", () => {
    expect(erreur({ mode: "INDEX", indexOld: 142, indexNew: 0 }).code).toBe("REVISION_INDEX_POSITIVE");
    expect(erreur({ mode: "INDEX", indexOld: 0, indexNew: 142 }).code).toBe("REVISION_INDEX_POSITIVE");
  });

  it("refuse un loyer nul, accepte le plafond exact et refuse au-delà, chacun avec son code", () => {
    expect(erreur({ mode: "AMOUNT", newRent: 0 }).code).toBe("REVISION_RENT_POSITIVE");
    expect(calculerNouveauLoyer(500, { mode: "AMOUNT", newRent: MONTANT_MAXIMUM })).toBe(MONTANT_MAXIMUM);
    expect(erreur({ mode: "AMOUNT", newRent: MONTANT_MAXIMUM + 1000 }).code).toBe("REVISION_RENT_CAP");
  });
});

describe("motifRevision", () => {
  const base = { method: "PERCENT", percent: null, indexName: null, indexOld: null, indexNew: null };
  const fr = TEXTES_SUITE.fr.revision.motif;

  it("écrit le pourcentage avec son signe, sans « + » pour zéro, avec la virgule du français", () => {
    expect(motifRevision({ ...base, percent: 0 })).toBe(`0${fr.pourcent}`);
    expect(motifRevision({ ...base, percent: 2.5 })).toBe(`+2,5${fr.pourcent}`);
    expect(motifRevision({ ...base, percent: -10 })).toBe(`-10${fr.pourcent}`);
    expect(motifRevision({ ...base, percent: 2.5 }, "en")).toContain("2.5");
  });

  it("écrit l'indice avec son nom, ou le mot par défaut quand le nom est vide ou absent, dans l'ordre ancien → nouveau", () => {
    const indice = { ...base, method: "INDEX", indexOld: 142.06, indexNew: 144.5 };
    expect(motifRevision({ ...indice, indexName: "IRL" })).toBe(`IRL${fr.deuxPoints}142,06 → 144,5`);
    expect(motifRevision({ ...indice, indexName: "" })).toBe(`${fr.indice}${fr.deuxPoints}142,06 → 144,5`);
    expect(motifRevision({ ...indice, indexName: null })).toBe(`${fr.indice}${fr.deuxPoints}142,06 → 144,5`);
  });

  it("ne donne aucun motif sans valeurs, ni pour un montant", () => {
    expect(motifRevision({ ...base, method: "INDEX" })).toBeNull();
    expect(motifRevision({ ...base, method: "PERCENT", percent: null })).toBeNull();
    expect(motifRevision({ ...base, method: "AMOUNT" })).toBeNull();
  });
});

describe("révision à effet immédiat — quelles factures sont recalculées", () => {
  it("recalcule les factures impayées à partir du mois d'effet, pas les mois d'avant, les annulées ni celles d'un autre bail", async () => {
    const { manager, contract } = await agence();
    const autre = await autreBail(manager.id);
    const f = (mois: number, extra: Record<string, unknown> = {}) => createInvoice(contract.id, { periodMonth: mois, periodYear: 2026, amount: 500, status: "PENDING", ...extra });
    const septembre = await f(9);
    const octobre = await f(10);
    const novembre = await f(11, { status: "CANCELLED" });
    const decembre = await f(12);
    const dAutre = await createInvoice(autre.contract.id, { periodMonth: 10, periodYear: 2026, amount: 500, status: "PENDING" });

    const res = await creer(manager.id, contract.id, { effectiveDate: utc("2026-10-01") });

    expect(res.appliquee).toBe(true);
    expect(res.facturesRecalculees).toBe(2);
    const montant = async (id: string) => (await testDb.select().from(invoices).where(eq(invoices.id, id)))[0].amount;
    expect(await montant(septembre.id)).toBe(500);
    expect(await montant(octobre.id)).toBe(550);
    expect(await montant(novembre.id)).toBe(500);
    expect(await montant(decembre.id)).toBe(550);
    expect(await montant(dAutre.id)).toBe(500);
    const loyer = async (id: string) => (await testDb.select().from(contracts).where(eq(contracts.id, id)))[0].rent;
    expect(await loyer(contract.id)).toBe(550);
    expect(await loyer(autre.contract.id)).toBe(500);
  });

  it("arrondit chaque facture dans SA devise, pas dans celle du bail", async () => {
    const { manager, contract } = await agence({ currency: "XOF", rent: 1000 });
    const facture = await createInvoice(contract.id, { periodMonth: 10, periodYear: 2026, amount: 333.33, currency: "EUR", status: "PENDING" });

    await creer(manager.id, contract.id, { effectiveDate: utc("2026-10-01"), entree: { mode: "AMOUNT", newRent: 1100 } });

    const [apres] = await testDb.select().from(invoices).where(eq(invoices.id, facture.id));
    expect(apres.amount).toBe(366.66);
  });
});

describe("révision programmée — application par le cron", () => {
  it("épargne les factures déjà payées, même en partie, et recalcule les autres à partir du mois d'effet", async () => {
    const { contract } = await agence();
    const rev = await revision(contract.id, { effectiveDate: utc("2026-10-01"), newRent: 550 });
    const f = (mois: number, extra: Record<string, unknown>) => createInvoice(contract.id, { periodMonth: mois, periodYear: 2026, amount: 500, ...extra });
    const payee = await f(10, { status: "PAID", amountPaid: 500 });
    const partielle = await f(11, { status: "PENDING", amountPaid: 100 });
    const payeeSansMontant = await f(12, { status: "PAID", amountPaid: 0 });
    const impayee = await f(8, { status: "PENDING" });
    const aVenir = await createInvoice(contract.id, { periodMonth: 1, periodYear: 2027, amount: 500, status: "PENDING" });

    const res = await appliquerRevisionsDues(MAINTENANT);

    expect(res).toEqual({ appliquees: 1, annulees: 0 });
    const montant = async (id: string) => (await testDb.select().from(invoices).where(eq(invoices.id, id)))[0].amount;
    expect(await montant(payee.id)).toBe(500);
    expect(await montant(partielle.id)).toBe(500);
    expect(await montant(payeeSansMontant.id)).toBe(500);
    expect(await montant(impayee.id)).toBe(500);
    expect(await montant(aVenir.id)).toBe(550);
    const apres = await lire(rev.id);
    expect(apres.status).toBe("APPLIED");
    expect(apres.appliedAt?.getTime()).toBe(MAINTENANT.getTime());
  });

  it("applique une révision dont la date d'effet est exactement maintenant", async () => {
    const { contract } = await agence();
    await revision(contract.id, { effectiveDate: utc("2026-11-01") });

    expect(await appliquerRevisionsDues(utc("2026-11-01"))).toEqual({ appliquees: 1, annulees: 0 });
  });

  it("ne traite que les révisions de l'agence demandée", async () => {
    const a = await agence();
    const b = await agence();
    const revA = await revision(a.contract.id, { effectiveDate: utc("2026-10-01") });
    const revB = await revision(b.contract.id, { effectiveDate: utc("2026-10-01") });

    const res = await appliquerRevisionsDues(MAINTENANT, a.manager.id);

    expect(res).toEqual({ appliquees: 1, annulees: 0 });
    expect((await lire(revA.id)).status).toBe("APPLIED");
    expect((await lire(revB.id)).status).toBe("PENDING");
  });

  it("annule la révision d'un bail terminé et efface sa date d'application", async () => {
    const { contract } = await agence();
    const rev = await revision(contract.id, { effectiveDate: utc("2026-10-01") });
    await testDb.update(contracts).set({ status: "ENDED" }).where(eq(contracts.id, contract.id));

    const res = await appliquerRevisionsDues(MAINTENANT);

    expect(res).toEqual({ appliquees: 0, annulees: 1 });
    const apres = await lire(rev.id);
    expect(apres.status).toBe("CANCELLED");
    expect(apres.appliedAt).toBeNull();
  });

  it("prend pour loyer de départ celui du bail au moment d'appliquer, corrigé depuis la programmation", async () => {
    const { contract } = await agence();
    const rev = await revision(contract.id, { effectiveDate: utc("2026-10-01"), previousRent: 500, newRent: 550 });
    await testDb.update(contracts).set({ rent: 520 }).where(eq(contracts.id, contract.id));

    await appliquerRevisionsDues(MAINTENANT);

    expect((await lire(rev.id)).previousRent).toBe(520);
    expect((await testDb.select().from(contracts).where(eq(contracts.id, contract.id)))[0].rent).toBe(550);
  });
});

describe("creerRevision — refus et enregistrement", () => {
  it("refuse un bail inconnu et celui d'une autre agence, en 404", async () => {
    const { contract } = await agence();
    const intrus = await createManager();

    await expect(creer(intrus.id, "inconnu")).rejects.toMatchObject({ statusCode: 404, code: "CONTRACT_NOT_FOUND" });
    await expect(creer(intrus.id, contract.id)).rejects.toMatchObject({ statusCode: 404, code: "CONTRACT_NOT_FOUND" });
  });

  it("refuse une date d'effet avant ou au début du bail, accepte la fin du bail exacte, refuse au-delà", async () => {
    const { manager, contract } = await agence({ startDate: utc("2026-12-01"), endDate: utc("2027-06-01") });

    await expect(creer(manager.id, contract.id, { effectiveDate: utc("2026-11-01") })).rejects.toMatchObject({ code: "REVISION_DATE_BEFORE_START" });
    await expect(creer(manager.id, contract.id, { effectiveDate: utc("2026-12-01") })).rejects.toMatchObject({ code: "REVISION_DATE_BEFORE_START" });
    await expect(creer(manager.id, contract.id, { effectiveDate: utc("2027-07-01") })).rejects.toMatchObject({ code: "REVISION_DATE_AFTER_END" });
    const ok = await creer(manager.id, contract.id, { effectiveDate: utc("2027-06-01") });
    expect(ok.revision.status).toBe("PENDING");
  });

  it("une révision programmée sur un autre bail ne bloque pas celui-ci", async () => {
    const { manager, contract } = await agence();
    const autre = await autreBail(manager.id);
    await revision(autre.contract.id, { status: "PENDING" });

    const res = await creer(manager.id, contract.id);

    expect(res.revision.status).toBe("PENDING");
  });

  it("un loyer payé en totalité sans montant réglé enregistré refuse la révision, avec la période sur deux chiffres", async () => {
    const { manager, contract } = await agence();
    await createInvoice(contract.id, { periodMonth: 3, periodYear: 2027, amount: 500, status: "PAID", amountPaid: 0 });

    const err = await creer(manager.id, contract.id).catch((e) => e);

    expect(err.statusCode).toBe(409);
    expect(err.code).toBe("REVISION_MONTH_ALREADY_PAID");
    expect(err.message).toContain("03/2027");
    expect(err.params).toEqual({ period: "03/2027" });
  });

  it("une facture annulée, ou payée sur un autre bail, ne refuse pas la révision", async () => {
    const { manager, contract } = await agence();
    const autre = await autreBail(manager.id);
    await createInvoice(contract.id, { periodMonth: 12, periodYear: 2026, amount: 500, status: "CANCELLED", amountPaid: 100 });
    await createInvoice(autre.contract.id, { periodMonth: 12, periodYear: 2026, amount: 500, status: "PAID", amountPaid: 500 });

    const res = await creer(manager.id, contract.id);

    expect(res.revision.status).toBe("PENDING");
  });

  it("enregistre le motif nettoyé, l'auteur et, pour une révision programmée, aucune date d'application", async () => {
    const { manager, contract } = await agence();

    const { revision: r } = await creer(manager.id, contract.id, {
      entree: { mode: "INDEX", indexName: "  IRL  ", indexOld: 142.06, indexNew: 144 },
      note: "  Révision annuelle  ",
      createdBy: manager.id,
    });

    expect(r).toMatchObject({ method: "INDEX", indexName: "IRL", indexOld: 142.06, indexNew: 144, note: "Révision annuelle", createdBy: manager.id, status: "PENDING", appliedAt: null });
  });

  it("un nom d'indice ou une note faits d'espaces sont enregistrés vides", async () => {
    const { manager, contract } = await agence();

    const { revision: r } = await creer(manager.id, contract.id, { entree: { mode: "INDEX", indexName: "   ", indexOld: 142, indexNew: 144 }, note: "   " });

    expect(r.indexName).toBeNull();
    expect(r.note).toBeNull();
  });

  it("une révision du mois en cours est appliquée tout de suite et porte sa date d'application", async () => {
    const { manager, contract } = await agence();

    const { revision: r, appliquee } = await creer(manager.id, contract.id, { effectiveDate: utc("2026-10-01") });

    expect(appliquee).toBe(true);
    expect(r.status).toBe("APPLIED");
    expect(r.appliedAt?.getTime()).toBe(MAINTENANT.getTime());
  });
});

describe("creerRevision — e-mail au locataire", () => {
  async function monde() {
    const m = await agence({ currency: "XOF", rent: 50000 }, { language: "pt" });
    await testDb.insert(agencySettings).values({ userId: m.manager.id, agencyName: "Agence du Port", email: "agence@test.local" });
    return m;
  }

  it("écrit l'e-mail complet dans la langue de la fiche : bien, anciens et nouveaux loyers, devise, motif, note, réponse à l'agence", async () => {
    const { manager, contract } = await monde();

    const { revision: r, emailEnvoye } = await creer(manager.id, contract.id, {
      entree: { mode: "INDEX", indexName: "IRL", indexOld: 142.06, indexNew: 144 },
      note: "Indexation annuelle",
      prevenirLocataire: true,
    });

    expect(emailEnvoye).toBe(true);
    const attendu = rentRevisionEmail({
      tenantName: "Awa Ndiaye",
      propertyTitle: "Studio A",
      previousRent: r.previousRent,
      newRent: r.newRent,
      currency: "XOF",
      effectiveDate: r.effectiveDate,
      motif: motifRevision(r, "pt"),
      note: "Indexation annuelle",
      langue: "pt",
    });
    expect(envoi).toHaveBeenCalledTimes(1);
    const [destinataire, sujet, html, , options] = envoi.mock.calls[0];
    expect(destinataire).toBe("locataire@example.com");
    expect(sujet).toBe(attendu.subject);
    expect(html).toBe(attendu.html);
    expect(options).toEqual({ replyTo: "agence@test.local" });
    expect(r.newRent).not.toBe(r.previousRent);
  });

  it("sans adresse pour le titulaire, rien ne lui est envoyé ; une copie à un colocataire compte comme prévenu", async () => {
    const { manager, contract } = await agence({}, { email: "" });
    const coloc = await createTenant(manager.id, { email: "binta@example.com", firstName: "Binta", lastName: "Kane" });
    await testDb.insert(contractCotenants).values({ contractId: contract.id, tenantId: coloc.id });

    const res = await creer(manager.id, contract.id, { prevenirLocataire: true });

    expect(res.emailEnvoye).toBe(true);
    expect(envoi.mock.calls.map((c: unknown[]) => c[0])).toEqual(["binta@example.com"]);
    expect((await lire(res.revision.id)).tenantNotifiedAt).not.toBeNull();
  });

  it("sans personne à prévenir, rien n'est marqué comme envoyé", async () => {
    const { manager, contract } = await agence({}, { email: "" });

    const res = await creer(manager.id, contract.id, { prevenirLocataire: true });

    expect(res.emailEnvoye).toBe(false);
    expect(envoi).not.toHaveBeenCalled();
    expect((await lire(res.revision.id)).tenantNotifiedAt).toBeNull();
  });

  it("n'horodate que la révision dont le locataire a été prévenu", async () => {
    const { manager, contract } = await agence();
    const autre = await autreBail(manager.id);
    const sansAvis = await revision(autre.contract.id);

    const res = await creer(manager.id, contract.id, { prevenirLocataire: true });

    expect((await lire(res.revision.id)).tenantNotifiedAt).not.toBeNull();
    expect((await lire(sansAvis.id)).tenantNotifiedAt).toBeNull();
  });
});

describe("listerRevisions, revisionsAppliquees et annulerRevision", () => {
  it("liste les révisions du bail de la plus récente à la plus ancienne, les égalités par création récente d'abord", async () => {
    const { manager, contract } = await agence();
    const autre = await autreBail(manager.id);
    const r1 = await revision(contract.id, { effectiveDate: utc("2026-11-01") });
    const r2 = await revision(contract.id, { effectiveDate: utc("2026-12-01") });
    const ancien = await revision(contract.id, { effectiveDate: utc("2027-01-01"), createdAt: new Date("2026-01-01T00:00:00Z") });
    const recent = await revision(contract.id, { effectiveDate: utc("2027-01-01"), createdAt: new Date("2026-02-01T00:00:00Z") });
    await revision(autre.contract.id, { effectiveDate: utc("2028-01-01") });

    const liste = await listerRevisions(contract.id);

    expect(liste.map((r) => r.id)).toEqual([recent.id, ancien.id, r2.id, r1.id]);
  });

  it("ne donne que les révisions appliquées du bail, de la plus ancienne à la plus récente", async () => {
    const { manager, contract } = await agence();
    const autre = await autreBail(manager.id);
    const mars = await revision(contract.id, { status: "APPLIED", effectiveDate: utc("2026-03-01") });
    const janvier = await revision(contract.id, { status: "APPLIED", effectiveDate: utc("2026-01-01") });
    await revision(contract.id, { status: "PENDING", effectiveDate: utc("2026-12-01") });
    await revision(contract.id, { status: "CANCELLED", effectiveDate: utc("2026-02-01") });
    await revision(autre.contract.id, { status: "APPLIED", effectiveDate: utc("2026-02-01") });

    const liste = await revisionsAppliquees(contract.id);

    expect(liste.map((r) => r.id)).toEqual([janvier.id, mars.id]);
  });

  it("n'annule que la révision visée de ce bail ; chaque refus a son code", async () => {
    const { manager, contract } = await agence();
    const autre = await autreBail(manager.id);
    const visee = await revision(contract.id, { status: "PENDING", effectiveDate: utc("2026-11-01") });
    const voisine = await revision(contract.id, { status: "PENDING", effectiveDate: utc("2026-12-01") });
    const appliquee = await revision(contract.id, { status: "APPLIED", effectiveDate: utc("2026-03-01") });
    const annulee = await revision(contract.id, { status: "CANCELLED", effectiveDate: utc("2026-02-01") });

    await expect(annulerRevision(autre.contract.id, visee.id)).rejects.toMatchObject({ statusCode: 404, code: "REVISION_NOT_FOUND" });
    await expect(annulerRevision(contract.id, "inconnue")).rejects.toMatchObject({ statusCode: 404, code: "REVISION_NOT_FOUND" });
    await expect(annulerRevision(contract.id, appliquee.id)).rejects.toMatchObject({ statusCode: 409, code: "REVISION_ALREADY_APPLIED" });
    await expect(annulerRevision(contract.id, annulee.id)).rejects.toMatchObject({ statusCode: 409, code: "REVISION_ALREADY_CANCELLED" });
    expect((await lire(visee.id)).status).toBe("PENDING");

    await annulerRevision(contract.id, visee.id);

    expect((await lire(visee.id)).status).toBe("CANCELLED");
    expect((await lire(voisine.id)).status).toBe("PENDING");
  });
});

describe("numeroAvenant", () => {
  it("compte les révisions non annulées de CE bail, par date d'effet", async () => {
    const { manager, contract } = await agence();
    const autre = await autreBail(manager.id);
    await revision(contract.id, { status: "CANCELLED", effectiveDate: utc("2026-11-01") });
    const appliquee = await revision(contract.id, { status: "APPLIED", effectiveDate: utc("2026-12-01") });
    const suivante = await revision(contract.id, { status: "PENDING", effectiveDate: utc("2027-02-01") });
    await revision(autre.contract.id, { status: "APPLIED", effectiveDate: utc("2026-01-01") });

    expect(await numeroAvenant(appliquee)).toBe(1);
    expect(await numeroAvenant(suivante)).toBe(2);
  });
});

describe("bauxAReviser — fenêtre, années et dates", () => {
  async function bail(managerId: string, debut: string, fin = "2028-12-31") {
    const property = await createProperty(managerId, { title: `Bien ${debut}` });
    const tenant = await createTenant(managerId, { email: `loc-${debut}-${Math.random()}@example.com`, firstName: "Awa", lastName: "Ndiaye" });
    const contract = await createContract(property.id, tenant.id, { rent: 500, startDate: utc(debut), endDate: utc(fin), status: "ACTIVE" });
    return contract;
  }
  const ids = (l: Array<{ contractId: string }>) => l.map((b) => b.contractId);

  it("retient l'anniversaire exactement à 30 jours avant ou 60 jours après, pas un jour de plus", async () => {
    const manager = await createManager();
    const lundi = utc("2026-10-12");
    const il30 = await bail(manager.id, "2025-09-12");
    const il31 = await bail(manager.id, "2025-09-11");
    const dans60 = await bail(manager.id, "2025-12-11");
    const dans61 = await bail(manager.id, "2025-12-12");

    const liste = await bauxAReviser(manager.id, lundi);

    expect(ids(liste)).toEqual([il30.id, dans60.id]);
    expect(ids(liste)).not.toContain(il31.id);
    expect(ids(liste)).not.toContain(dans61.id);
  });

  it("l'anniversaire doit suivre le début du bail et peut tomber le dernier jour du bail", async () => {
    const manager = await createManager();
    const memeJour = await bail(manager.id, "2026-10-01");
    const dernierJour = await bail(manager.id, "2025-11-15", "2026-11-15");

    const liste = await bauxAReviser(manager.id);

    expect(ids(liste)).toEqual([dernierJour.id]);
    expect(ids(liste)).not.toContain(memeJour.id);
  });

  it("trouve l'anniversaire de l'année précédente en janvier et celui de l'année suivante en décembre", async () => {
    const manager = await createManager();
    const decembrePasse = await bail(manager.id, "2024-12-20");
    const janvierProchain = await bail(manager.id, "2025-01-05");

    const enJanvier = await bauxAReviser(manager.id, utc("2026-01-10"));
    const enDecembre = await bauxAReviser(manager.id, utc("2026-12-20"));

    expect(ids(enJanvier)).toContain(decembrePasse.id);
    expect(ids(enDecembre)).toContain(janvierProchain.id);
  });

  it("une révision programmée, même ancienne, couvre l'échéance ; une appliquée il y a onze mois exactement aussi", async () => {
    const manager = await createManager();
    const programmee = await bail(manager.id, "2025-11-15");
    const pile = await bail(manager.id, "2025-11-15");
    const veille = await bail(manager.id, "2025-11-15");
    await revision(programmee.id, { status: "PENDING", effectiveDate: utc("2024-01-01") });
    // L'anniversaire est le 15/11/2026 : le seuil de onze mois est le 15/12/2025.
    await revision(pile.id, { status: "APPLIED", effectiveDate: new Date("2025-12-15T00:00:00Z") });
    await revision(veille.id, { status: "APPLIED", effectiveDate: new Date("2025-12-14T00:00:00Z") });

    const liste = await bauxAReviser(manager.id);

    expect(ids(liste)).toEqual([veille.id]);
  });

  it("donne, comme dernière révision, la plus récente des révisions appliquées", async () => {
    const manager = await createManager();
    const b = await bail(manager.id, "2025-11-15");
    await revision(b.id, { status: "APPLIED", effectiveDate: utc("2024-02-01") });
    await revision(b.id, { status: "APPLIED", effectiveDate: utc("2025-01-01") });

    const [ligne] = await bauxAReviser(manager.id);

    expect(ligne.derniereRevision?.toISOString().slice(0, 10)).toBe("2025-01-01");
  });

  it("ne compte pas les révisions d'un autre bail ni les annulées, et ne montre que les baux de l'agence et actifs", async () => {
    const manager = await createManager();
    const autreAgence = await createManager();
    const b = await bail(manager.id, "2025-11-15");
    const autreBailAgence = await bail(manager.id, "2025-11-16");
    await bail(autreAgence.id, "2025-11-17");
    await revision(autreBailAgence.id, { status: "APPLIED", effectiveDate: utc("2026-09-01") });
    await revision(b.id, { status: "CANCELLED", effectiveDate: utc("2026-09-01") });

    const liste = await bauxAReviser(manager.id);

    expect(ids(liste)).toEqual([b.id]);
  });
});
