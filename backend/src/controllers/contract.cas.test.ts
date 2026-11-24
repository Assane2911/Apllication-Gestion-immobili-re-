import { and, eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { activityLogs, contractCotenants, contractGuarantors, contracts, invoices, issueReports, leaseNotices, leaseSettlements, properties } from "../db/schema";
import * as emailService from "../services/email.service";
import { referenceSolde } from "../services/soldeDeToutCompte.service";
import * as storageService from "../services/storage.service";
import {
  authHeader,
  createAdmin,
  createContract,
  createInspection,
  createInvoice,
  createManager,
  createProperty,
  createTenant,
  tokenFor,
  tokenLocataire,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { TAILLE_MAX_SIGNATURE } from "../utils/signature";

/**
 * Audit par sabotage de contract.controller.ts : ce que les tests existants ne verrouillaient pas.
 *
 * Les gaps étaient de quatre sortes : l'isolement et la pagination de la liste des contrats, les CODES d'erreur (que le
 * frontend traduit : les tests ne regardaient que le statut HTTP), les bornes (dates qui se touchent, montants égaux,
 * limites de taille) et les champs repris tels quels (renouvellement, résumé des soldes, e-mail de restitution).
 */

const SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

let suppression: ReturnType<typeof vi.spyOn>;
let courriel: ReturnType<typeof vi.spyOn>;
let signer: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  signer = vi.spyOn(storageService, "getSignedUrl").mockImplementation(async (chemin: string) => `https://stockage.test/signe/${chemin}`);
  vi.spyOn(storageService, "getSignedUrls").mockImplementation(async (chemins: string[]) => new Map(chemins.map((c) => [c, `https://stockage.test/signe/${c}`] as const)));
  suppression = vi.spyOn(storageService, "deleteStorageObjectBestEffort").mockResolvedValue(undefined);
  courriel = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: false } as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function agence(overrides: Parameters<typeof createManager>[0] = {}) {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", ...overrides });
  const property = await createProperty(manager.id, { title: "Villa Ngor", status: "AVAILABLE" });
  const tenant = await createTenant(manager.id, { firstName: "Aminata", lastName: "Diallo", email: `aminata-${manager.id}@test.local` });
  return { manager, property, tenant, h: authHeader(tokenFor(manager)) };
}
const autreProperty = (managerId: string, titre = "Studio B") => createProperty(managerId, { title: titre, status: "AVAILABLE" });
const bienDe = async (id: string) => (await testDb.select().from(properties).where(eq(properties.id, id)))[0];
const journal = (managerId: string, action: string) => testDb.select().from(activityLogs).where(and(eq(activityLogs.managerId, managerId), eq(activityLogs.action, action)));
const sansEspaces = (s: string) => s.split(" ").join("").split(" ").join("").split(" ").join("");

const corps = (propertyId: string, tenantId: string, extra: Record<string, unknown> = {}) => ({
  propertyId,
  tenantId,
  rent: 500,
  deposit: 1000,
  startDate: "2026-06-01",
  endDate: "2027-05-31",
  ...extra,
});
const jour = (iso: string) => new Date(`${iso}T00:00:00Z`);

/* ───────────────────────────── Création ───────────────────────────── */

describe("création d'un bail : validation et bornes", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 1));
  });

  it.each([["propertyId"], ["tenantId"]])("un %s vide est refusé comme donnée invalide, pas comme bien ou locataire introuvable", async (champ) => {
    const { property, tenant, h } = await agence();

    const res = await request(app).post("/api/contracts").set(h).send(corps(property.id, tenant.id, { [champ]: "" }));

    expect(res.status).toBe(400);
    expect(res.body.code).toMatch(/^VALIDATION_ERROR/);
  });

  it("un loyer nul est refusé ; un dépôt de garantie nul est accepté", async () => {
    const { property, tenant, h } = await agence();

    expect((await request(app).post("/api/contracts").set(h).send(corps(property.id, tenant.id, { rent: 0 }))).status).toBe(400);
    const res = await request(app).post("/api/contracts").set(h).send(corps(property.id, tenant.id, { deposit: 0 }));
    expect(res.status).toBe(201);
    expect(res.body.deposit).toBe(0);
  });

  it("une date de bail hors limites répond avec son code et la plage acceptée", async () => {
    const { property, tenant, h } = await agence();

    const res = await request(app).post("/api/contracts").set(h).send(corps(property.id, tenant.id, { startDate: "1800-01-01" }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LEASE_DATE_OUT_OF_RANGE");
    expect(res.body.params).toEqual({ min: 1980, max: 2200 });
  });

  it("le début de la facturation peut coïncider avec le début du bail", async () => {
    const { property, tenant, h } = await agence();

    const res = await request(app).post("/api/contracts").set(h).send(corps(property.id, tenant.id, { startDate: "2026-03-01", billingFrom: "2026-03-01" }));

    expect(res.status).toBe(201);
  });

  it("le bien d'un autre gestionnaire, le locataire d'un autre gestionnaire : refus avec leur code", async () => {
    const { property, tenant, h } = await agence();
    const autre = await agence();

    const bien = await request(app).post("/api/contracts").set(h).send(corps(autre.property.id, tenant.id));
    expect(bien.status).toBe(404);
    expect(bien.body.code).toBe("PROPERTY_NOT_FOUND");

    const locataire = await request(app).post("/api/contracts").set(h).send(corps(property.id, autre.tenant.id));
    expect(locataire.status).toBe(404);
    expect(locataire.body.code).toBe("TENANT_NOT_FOUND");
  });

  it("le journal garde le bien, le locataire et le détail de la création", async () => {
    const { manager, property, tenant, h } = await agence();

    await request(app).post("/api/contracts").set(h).send(corps(property.id, tenant.id));

    const [ligne] = await journal(manager.id, "contract.create");
    expect(ligne.entityLabel).toBe("Villa Ngor — Aminata Diallo");
    expect(ligne.details).toBe("Nouveau contrat créé pour Aminata Diallo sur le bien Villa Ngor");
  });
});

describe("chevauchement de deux baux actifs sur un même bien", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 1));
  });

  it("deux baux qui se touchent ou se suivent ne se chevauchent pas ; une vraie période commune est refusée avec son code", async () => {
    const { property, tenant, h } = await agence();
    await createContract(property.id, tenant.id, { status: "ACTIVE", startDate: jour("2026-06-01"), endDate: jour("2027-06-01") });
    const poser = (startDate: string, endDate: string) => request(app).post("/api/contracts").set(h).send(corps(property.id, tenant.id, { startDate, endDate }));

    // Entièrement avant (finit le jour où l'autre commence), entièrement après (commence le jour où l'autre finit), très en amont.
    expect((await poser("2025-06-01", "2026-06-01")).status).toBe(201);
    expect((await poser("2027-06-01", "2028-06-01")).status).toBe(201);
    expect((await poser("2024-01-01", "2025-01-01")).status).toBe(201);

    const conflit = await poser("2026-12-01", "2027-12-01");
    expect(conflit.status).toBe(409);
    expect(conflit.body.code).toBe("CONTRACT_OVERLAP_ACTIVE");
  });

  it("un bail déjà clos sur la même période ne bloque pas un nouveau bail", async () => {
    const { property, tenant, h } = await agence();
    await createContract(property.id, tenant.id, { status: "ENDED", startDate: jour("2026-06-01"), endDate: jour("2027-06-01") });

    const res = await request(app).post("/api/contracts").set(h).send(corps(property.id, tenant.id, { startDate: "2026-08-01", endDate: "2027-08-01" }));

    expect(res.status).toBe(201);
  });
});

/* ───────────────────────────── Lecture et liste ───────────────────────────── */

describe("lecture d'un contrat", () => {
  it("les factures sont rendues de la plus récente à la plus ancienne ; sans congé, activeNotice vaut null ; sans scan, rien n'est signé", async () => {
    const { property, tenant, contract, h } = await (async () => {
      const a = await agence();
      return { ...a, contract: await createContract(a.property.id, a.tenant.id) };
    })();
    await createInvoice(contract.id, { periodYear: 2026, periodMonth: 3 });
    await createInvoice(contract.id, { periodYear: 2026, periodMonth: 11 });
    await createInvoice(contract.id, { periodYear: 2025, periodMonth: 12 });
    void property;
    void tenant;

    const res = await request(app).get(`/api/contracts/${contract.id}`).set(h);

    expect(res.status).toBe(200);
    expect(res.body.invoices.map((f: { periodYear: number; periodMonth: number }) => `${f.periodYear}-${f.periodMonth}`)).toEqual(["2026-11", "2026-3", "2025-12"]);
    expect(res.body).toHaveProperty("activeNotice", null);
    expect(res.body.scannedContractUrl).toBeNull();
    expect(signer).not.toHaveBeenCalled();
  });

  it("le contrat d'un autre gestionnaire répond CONTRACT_NOT_FOUND", async () => {
    const { h } = await agence();
    const autre = await agence();
    const contrat = await createContract(autre.property.id, autre.tenant.id);

    const res = await request(app).get(`/api/contracts/${contrat.id}`).set(h);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("CONTRACT_NOT_FOUND");
  });
});

describe("liste des contrats du gestionnaire", () => {
  it("ne montre ni ne compte les contrats d'un autre gestionnaire", async () => {
    const a = await agence();
    const b = await agence();
    const contratA = await createContract(a.property.id, a.tenant.id);
    await createContract(b.property.id, b.tenant.id);

    const res = await request(app).get("/api/contracts").set(a.h);

    expect(res.status).toBe(200);
    expect(res.body.items.map((c: { id: string }) => c.id)).toEqual([contratA.id]);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toHaveProperty("activeNotice", null);
  });

  it("pagine : taille de page, page suivante, total, du plus récent au plus ancien", async () => {
    const { manager, property, tenant, h } = await agence();
    const p2 = await autreProperty(manager.id, "Studio 2");
    const p3 = await autreProperty(manager.id, "Studio 3");
    const ancien = await createContract(property.id, tenant.id, { status: "ENDED", createdAt: new Date("2026-01-01T00:00:00Z") });
    const milieu = await createContract(p2.id, tenant.id, { status: "ENDED", createdAt: new Date("2026-02-01T00:00:00Z") });
    const recent = await createContract(p3.id, tenant.id, { status: "ENDED", createdAt: new Date("2026-03-01T00:00:00Z") });

    const page1 = await request(app).get("/api/contracts?pageSize=2").set(h);
    expect(page1.body.items.map((c: { id: string }) => c.id)).toEqual([recent.id, milieu.id]);
    expect(page1.body.total).toBe(3);

    const page2 = await request(app).get("/api/contracts?pageSize=2&page=2").set(h);
    expect(page2.body.items.map((c: { id: string }) => c.id)).toEqual([ancien.id]);
    expect(page2.body.total).toBe(3);
  });

  it("compte les garants de chaque bail, nomme les colocataires du bon bail seulement", async () => {
    const { manager, property, tenant, h } = await agence();
    const p2 = await autreProperty(manager.id);
    const coloc = await createTenant(manager.id, { firstName: "Awa", lastName: "Ndiaye", email: "awa@test.local" });
    const avecGarants = await createContract(property.id, tenant.id, { status: "ENDED", createdAt: new Date("2026-02-01T00:00:00Z") });
    const sansGarant = await createContract(p2.id, tenant.id, { status: "ENDED", createdAt: new Date("2026-01-01T00:00:00Z") });
    await testDb.insert(contractGuarantors).values([
      { contractId: avecGarants.id, firstName: "Moussa", lastName: "Diop", phone: "+221771234567" },
      { contractId: avecGarants.id, firstName: "Fatou", lastName: "Sy", phone: "+221771234568" },
    ]);
    await testDb.insert(contractCotenants).values({ contractId: avecGarants.id, tenantId: coloc.id });

    const res = await request(app).get("/api/contracts").set(h);

    const ligne = (id: string) => res.body.items.find((c: { id: string }) => c.id === id);
    expect(ligne(avecGarants.id).guarantorsCount).toBe(2);
    expect(ligne(sansGarant.id).guarantorsCount).toBe(0);
    expect(ligne(avecGarants.id).cotenantNames).toEqual(["Awa Ndiaye"]);
    expect(ligne(sansGarant.id).cotenantNames).toEqual([]);
  });
});

/* ───────────────────────────── Modification ───────────────────────────── */

describe("modification d'un bail : refus et codes", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 15));
  });

  it("un contrat inconnu, le contrat d'un autre gestionnaire, un corps vide : leur code", async () => {
    const { property, tenant, h } = await agence();
    const autre = await agence();
    const contrat = await createContract(property.id, tenant.id);
    const celuiDeLAutre = await createContract(autre.property.id, autre.tenant.id);

    const inconnu = await request(app).put("/api/contracts/inconnu").set(h).send({ rent: 600 });
    expect([inconnu.status, inconnu.body.code]).toEqual([404, "CONTRACT_NOT_FOUND"]);

    const tiers = await request(app).put(`/api/contracts/${celuiDeLAutre.id}`).set(h).send({ rent: 600 });
    expect([tiers.status, tiers.body.code]).toEqual([404, "CONTRACT_NOT_FOUND"]);

    const vide = await request(app).put(`/api/contracts/${contrat.id}`).set(h).send({});
    expect([vide.status, vide.body.code]).toEqual([400, "NOTHING_TO_UPDATE"]);
  });

  it("un nouveau bien ou un nouveau locataire d'un autre gestionnaire : refus avec leur code", async () => {
    const { property, tenant, h } = await agence();
    const autre = await agence();
    const contrat = await createContract(property.id, tenant.id);

    const bien = await request(app).put(`/api/contracts/${contrat.id}`).set(h).send({ propertyId: autre.property.id });
    expect([bien.status, bien.body.code]).toEqual([404, "PROPERTY_NOT_FOUND"]);

    const locataire = await request(app).put(`/api/contracts/${contrat.id}`).set(h).send({ tenantId: autre.tenant.id });
    expect([locataire.status, locataire.body.code]).toEqual([404, "TENANT_NOT_FOUND"]);
  });

  it("modifier un autre champ conserve les mentions du logement", async () => {
    const { property, tenant, h } = await agence();
    const creation = await request(app).post("/api/contracts").set(h).send(corps(property.id, tenant.id, { housingMentions: { dpe: "D", chauffage: "Gaz" } }));
    expect(creation.status).toBe(201);

    const res = await request(app).put(`/api/contracts/${creation.body.id}`).set(h).send({ terms: "Pas d'animaux." });

    expect(res.status).toBe(200);
    expect(res.body.housingMentions).toMatchObject({ dpe: "D", chauffage: "Gaz" });
  });

  it.each([["propertyId"], ["tenantId"], ["deposit"], ["currency"], ["startDate"]])("un bail signé par le locataire ne laisse plus modifier %s", async (champ) => {
    const { manager, property, tenant, h } = await agence();
    const autreBien = await autreProperty(manager.id);
    const autreLocataire = await createTenant(manager.id, { email: "autre@test.local" });
    const contrat = await createContract(property.id, tenant.id, { signedByTenantAt: new Date(), tenantSignatureUrl: SIGNATURE, currency: "EUR" });
    const valeurs: Record<string, unknown> = {
      propertyId: autreBien.id,
      tenantId: autreLocataire.id,
      deposit: 1234,
      currency: "XOF",
      startDate: "2026-02-01",
    };

    const res = await request(app).put(`/api/contracts/${contrat.id}`).set(h).send({ [champ]: valeurs[champ] });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LEASE_SIGNED_LOCKED");
  });

  it("le verrou du bail signé passe avant les autres refus (ici : loyer d'un bail ayant des factures)", async () => {
    const { property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id, { signedByTenantAt: new Date(), tenantSignatureUrl: SIGNATURE });
    await createInvoice(contrat.id, { status: "PENDING" });

    const res = await request(app).put(`/api/contracts/${contrat.id}`).set(h).send({ rent: 999 });

    expect(res.body.code).toBe("LEASE_SIGNED_LOCKED");
  });

  it("réactiver un bail clos qui chevauche un bail actif est refusé", async () => {
    const { property, tenant, h } = await agence();
    await createContract(property.id, tenant.id, { status: "ACTIVE", startDate: jour("2026-06-01"), endDate: jour("2027-06-01") });
    const clos = await createContract(property.id, tenant.id, { status: "ENDED", startDate: jour("2026-08-01"), endDate: jour("2027-08-01") });

    const res = await request(app).put(`/api/contracts/${clos.id}`).set(h).send({ status: "ACTIVE" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONTRACT_OVERLAP_ACTIVE");
  });

  it("une date de fin égale à la date de début est refusée avec son code", async () => {
    const { property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id, { status: "ENDED", startDate: jour("2026-06-01"), endDate: jour("2027-06-01") });

    const res = await request(app).put(`/api/contracts/${contrat.id}`).set(h).send({ endDate: "2026-06-01" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CONTRACT_END_BEFORE_START");
  });

  it("la devise et le loyer : inchangés, ils passent malgré les factures ; changés, ils sont refusés avec leur code", async () => {
    const { property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id, { rent: 500, currency: "EUR" });
    await createInvoice(contrat.id, { status: "PENDING" });

    expect((await request(app).put(`/api/contracts/${contrat.id}`).set(h).send({ currency: "EUR", rent: 500 })).status).toBe(200);

    const devise = await request(app).put(`/api/contracts/${contrat.id}`).set(h).send({ currency: "XOF" });
    expect([devise.status, devise.body.code]).toEqual([409, "CONTRACT_HAS_INVOICES_CURRENCY"]);

    const loyer = await request(app).put(`/api/contracts/${contrat.id}`).set(h).send({ rent: 650 });
    expect([loyer.status, loyer.body.code]).toEqual([409, "CONTRACT_HAS_INVOICES_RENT"]);
  });

  it("des factures empêchent de changer le locataire ou la date de début, avec leur code", async () => {
    const { manager, property, tenant, h } = await agence();
    const autre = await createTenant(manager.id, { email: "autre2@test.local" });
    const contrat = await createContract(property.id, tenant.id, { startDate: jour("2026-01-01"), endDate: jour("2028-01-01") });
    await createInvoice(contrat.id, { status: "PENDING" });

    const parties = await request(app).put(`/api/contracts/${contrat.id}`).set(h).send({ tenantId: autre.id });
    expect([parties.status, parties.body.code]).toEqual([409, "CONTRACT_HAS_INVOICES_PARTIES"]);

    const debut = await request(app).put(`/api/contracts/${contrat.id}`).set(h).send({ startDate: "2026-02-01" });
    expect([debut.status, debut.body.code]).toEqual([409, "CONTRACT_HAS_INVOICES_START"]);
  });

  it("une fin qui précède un mois facturé nomme le plus ancien mois facturé, sur deux chiffres, avec son code", async () => {
    const { property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id, { startDate: jour("2026-01-01"), endDate: jour("2028-01-01") });
    await createInvoice(contrat.id, { periodYear: 2027, periodMonth: 5, status: "PENDING" });
    await createInvoice(contrat.id, { periodYear: 2027, periodMonth: 3, status: "PENDING" });

    const res = await request(app).put(`/api/contracts/${contrat.id}`).set(h).send({ endDate: "2027-02-01" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONTRACT_END_BEFORE_BILLED");
    expect(res.body.error).toContain("(03/2027)");
    expect(res.body.params).toEqual({ period: "03/2027" });
  });

  it("une fin au premier jour du dernier mois facturé est acceptée", async () => {
    const { property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id, { startDate: jour("2026-01-01"), endDate: jour("2028-01-01") });
    await createInvoice(contrat.id, { periodYear: 2027, periodMonth: 3, status: "PENDING" });

    const res = await request(app).put(`/api/contracts/${contrat.id}`).set(h).send({ endDate: "2027-03-01" });

    expect(res.status).toBe(200);
  });

  it("un colocataire d'un AUTRE bail peut devenir titulaire ; un colocataire de CE bail, non, avec son code", async () => {
    const { manager, property, tenant, h } = await agence();
    const p2 = await autreProperty(manager.id);
    const candidat = await createTenant(manager.id, { email: "candidat@test.local" });
    const colocDeCeBail = await createTenant(manager.id, { email: "coloc@test.local" });
    const contrat = await createContract(property.id, tenant.id, { startDate: jour("2026-01-01"), endDate: jour("2028-01-01") });
    const autreBail = await createContract(p2.id, tenant.id, { status: "ENDED", startDate: jour("2024-01-01"), endDate: jour("2025-01-01") });
    await testDb.insert(contractCotenants).values({ contractId: autreBail.id, tenantId: candidat.id });
    await testDb.insert(contractCotenants).values({ contractId: contrat.id, tenantId: colocDeCeBail.id });

    const refus = await request(app).put(`/api/contracts/${contrat.id}`).set(h).send({ tenantId: colocDeCeBail.id });
    expect([refus.status, refus.body.code]).toEqual([409, "TENANT_COTENANT_REMOVE_FIRST"]);

    const accepte = await request(app).put(`/api/contracts/${contrat.id}`).set(h).send({ tenantId: candidat.id });
    expect(accepte.status).toBe(200);
  });

  it("le montant du dépôt ne change plus une fois la restitution enregistrée, avec son code", async () => {
    const { property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id, { deposit: 1000, depositRefundedAt: new Date(), depositDeductions: "[]" });

    const res = await request(app).put(`/api/contracts/${contrat.id}`).set(h).send({ deposit: 900 });

    expect([res.status, res.body.code]).toEqual([409, "DEPOSIT_REFUND_LOCKED"]);
  });

  it("renvoyer la même date de fin n'est pas un raccourcissement : une facture hors période ne bloque pas l'enregistrement", async () => {
    const { property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id, { status: "ENDED", startDate: jour("2026-01-01"), endDate: jour("2027-01-01") });
    await createInvoice(contrat.id, { periodYear: 2027, periodMonth: 3, status: "PENDING" });

    const res = await request(app).put(`/api/contracts/${contrat.id}`).set(h).send({ endDate: "2027-01-01", terms: "Inchangé." });

    expect(res.status).toBe(200);
  });

  it("la restitution déjà enregistrée est signalée avant tout contrôle de chevauchement", async () => {
    const { property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id, { status: "ACTIVE", deposit: 1000, depositRefundedAt: new Date(), depositDeductions: "[]", startDate: jour("2026-06-01"), endDate: jour("2027-06-01") });
    await createContract(property.id, tenant.id, { status: "ACTIVE", startDate: jour("2026-09-01"), endDate: jour("2027-09-01") });

    const res = await request(app).put(`/api/contracts/${contrat.id}`).set(h).send({ deposit: 900 });

    expect([res.status, res.body.code]).toEqual([409, "DEPOSIT_REFUND_LOCKED"]);
  });

  it("modifier un bail actif génère ses factures manquantes", async () => {
    const { property, tenant, contrat, h } = await (async () => {
      const a = await agence();
      return { ...a, contrat: await createContract(a.property.id, a.tenant.id, { status: "ACTIVE", startDate: jour("2026-06-01"), endDate: jour("2027-06-01") }) };
    })();
    void property;
    void tenant;
    expect(await testDb.select().from(invoices).where(eq(invoices.contractId, contrat.id))).toEqual([]);

    const res = await request(app).put(`/api/contracts/${contrat.id}`).set(h).send({ terms: "Clause ajoutée." });

    expect(res.status).toBe(200);
    expect((await testDb.select().from(invoices).where(eq(invoices.contractId, contrat.id))).length).toBeGreaterThan(0);
  });
});

/* ───────────────────────────── Suppression ───────────────────────────── */

describe("suppression d'un bail : codes et périmètre", () => {
  it("un contrat inconnu ou celui d'un autre gestionnaire : CONTRACT_NOT_FOUND", async () => {
    const { h } = await agence();
    const autre = await agence();
    const celuiDeLAutre = await createContract(autre.property.id, autre.tenant.id, { status: "ENDED" });

    const inconnu = await request(app).delete("/api/contracts/inconnu").set(h);
    expect([inconnu.status, inconnu.body.code]).toEqual([404, "CONTRACT_NOT_FOUND"]);

    const tiers = await request(app).delete(`/api/contracts/${celuiDeLAutre.id}`).set(h);
    expect([tiers.status, tiers.body.code]).toEqual([404, "CONTRACT_NOT_FOUND"]);
  });

  it("ne retire du stockage que les fichiers du bail supprimé, pas ceux des congés et signalements d'un autre bail", async () => {
    const { manager, property, tenant, h } = await agence();
    const p2 = await autreProperty(manager.id);
    const supprime = await createContract(property.id, tenant.id, { status: "ENDED", startDate: jour("2024-01-01"), endDate: jour("2025-01-01") });
    const conserve = await createContract(p2.id, tenant.id, { status: "ENDED", startDate: jour("2025-01-01"), endDate: jour("2026-01-01") });
    const conge = { managerId: manager.id, givenBy: "TENANT", deliveryMode: "HAND_DELIVERY", servedAt: jour("2026-01-01"), periodValue: 1, periodUnit: "MONTHS", exitDate: jour("2026-02-01") } as const;
    await testDb.insert(leaseNotices).values([
      { ...conge, contractId: supprime.id, documentUrl: "notices/a-retirer.pdf" },
      { ...conge, contractId: conserve.id, documentUrl: "notices/a-garder.pdf" },
    ]);
    await testDb.insert(issueReports).values([
      { contractId: supprime.id, tenantId: tenant.id, title: "Fuite", description: "x", photoUrl: "issues/a-retirer.jpg" },
      { contractId: conserve.id, tenantId: tenant.id, title: "Fuite 2", description: "x", photoUrl: "issues/a-garder.jpg" },
    ] as Array<typeof issueReports.$inferInsert>);

    const res = await request(app).delete(`/api/contracts/${supprime.id}`).set(h);

    expect(res.status).toBe(204);
    // Le scan absent du bail est aussi transmis (vide) : le nettoyage l'ignore. Seuls comptent les fichiers réels.
    const retires = suppression.mock.calls.map((c: unknown[]) => c[0]).filter(Boolean).sort();
    expect(retires).toEqual(["issues/a-retirer.jpg", "notices/a-retirer.pdf"]);
  });

  it("le bien est libéré même quand un autre bien du gestionnaire a un bail actif", async () => {
    const { manager, property, tenant, h } = await agence();
    const p2 = await autreProperty(manager.id);
    await testDb.update(properties).set({ status: "OCCUPIED" }).where(eq(properties.id, property.id));
    await createContract(p2.id, tenant.id, { status: "ACTIVE" });
    const clos = await createContract(property.id, tenant.id, { status: "ENDED", startDate: jour("2024-01-01"), endDate: jour("2025-01-01") });

    const res = await request(app).delete(`/api/contracts/${clos.id}`).set(h);

    expect(res.status).toBe(204);
    expect((await bienDe(property.id)).status).toBe("AVAILABLE");
  });
});

/* ───────────────────────────── Portail locataire ───────────────────────────── */

describe("portail locataire : GET /api/contracts/mine", () => {
  it("rend les baux du plus récent au plus ancien, chaque facture du bail (la plus récente d'abord), et des listes vides plutôt qu'absentes", async () => {
    const { manager, property, tenant } = await agence();
    const p2 = await autreProperty(manager.id);
    const ancien = await createContract(property.id, tenant.id, { status: "ENDED", startDate: jour("2024-01-01"), endDate: jour("2025-01-01"), createdAt: new Date("2025-01-01T00:00:00Z") });
    const recent = await createContract(p2.id, tenant.id, { status: "ACTIVE", startDate: jour("2025-06-01"), endDate: jour("2027-06-01"), createdAt: new Date("2026-01-01T00:00:00Z") });
    await createInvoice(recent.id, { periodYear: 2026, periodMonth: 2 });
    await createInvoice(recent.id, { periodYear: 2026, periodMonth: 9 });
    await createInvoice(recent.id, { periodYear: 2025, periodMonth: 12 });

    const res = await request(app).get("/api/contracts/mine").set(authHeader(await tokenLocataire(tenant.id)));

    expect(res.status).toBe(200);
    expect(res.body.map((c: { id: string }) => c.id)).toEqual([recent.id, ancien.id]);
    expect(res.body[0].invoices.map((f: { periodYear: number; periodMonth: number }) => `${f.periodYear}-${f.periodMonth}`)).toEqual(["2026-9", "2026-2", "2025-12"]);
    expect(res.body[1].invoices).toEqual([]);
    expect(res.body[1].settlements).toEqual([]);
  });

  it("le résumé d'un solde porte sa référence, sa date de sortie et sa date d'émission", async () => {
    const { manager, property, tenant } = await agence();
    const contrat = await createContract(property.id, tenant.id);
    const [solde] = await testDb
      .insert(leaseSettlements)
      .values({ contractId: contrat.id, managerId: manager.id, exitDate: new Date(Date.UTC(2026, 5, 30)), depositAmount: 1000, balance: 100, details: "{}", createdAt: new Date(Date.UTC(2026, 6, 1)) })
      .returning();

    const res = await request(app).get("/api/contracts/mine").set(authHeader(await tokenLocataire(tenant.id)));

    const resume = res.body[0].settlements[0];
    expect(resume.reference).toBe(referenceSolde(solde));
    expect(resume.exitDate).toBe("2026-06-30T00:00:00.000Z");
    expect(resume.createdAt).toBe("2026-07-01T00:00:00.000Z");
  });
});

/* ───────────────────────────── Renouvellement ───────────────────────────── */

describe("renouvellement : refus et reprise des conditions", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 15));
  });

  it("un contrat inconnu ou celui d'un autre gestionnaire : CONTRACT_NOT_FOUND", async () => {
    const { h } = await agence();
    const autre = await agence();
    const celuiDeLAutre = await createContract(autre.property.id, autre.tenant.id, { status: "ACTIVE" });

    const inconnu = await request(app).post("/api/contracts/inconnu/renew").set(h).send({});
    expect([inconnu.status, inconnu.body.code]).toEqual([404, "CONTRACT_NOT_FOUND"]);

    const tiers = await request(app).post(`/api/contracts/${celuiDeLAutre.id}/renew`).set(h).send({});
    expect([tiers.status, tiers.body.code]).toEqual([404, "CONTRACT_NOT_FOUND"]);
  });

  it("le nouveau bail reprend le loyer, le dépôt et la devise, et génère ses factures", async () => {
    const { property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id, {
      status: "ACTIVE",
      rent: 700,
      deposit: 1400,
      currency: "XOF",
      startDate: jour("2025-06-15"),
      endDate: jour("2026-06-14"),
    });

    const res = await request(app).post(`/api/contracts/${contrat.id}/renew`).set(h).send({});

    expect(res.status).toBe(201);
    expect(res.body.rent).toBe(700);
    expect(res.body.deposit).toBe(1400);
    expect(res.body.currency).toBe("XOF");
    expect(res.body.invoices.length).toBeGreaterThan(0);
  });
});

/* ───────────────────────────── Signature ───────────────────────────── */

describe("signature du bail : codes et format de l'image", () => {
  it("un contrat inconnu, un locataire étranger au bail, un gestionnaire d'une autre agence, un administrateur : CONTRACT_NOT_FOUND", async () => {
    const { property, tenant, h } = await agence();
    const autre = await agence();
    const admin = await createAdmin();
    const contrat = await createContract(property.id, tenant.id);
    const etranger = await createTenant(autre.manager.id, { email: "etranger@test.local" });

    const inconnu = await request(app).post("/api/contracts/inconnu/sign").set(h).send({ signatureDataUrl: SIGNATURE });
    expect([inconnu.status, inconnu.body.code]).toEqual([404, "CONTRACT_NOT_FOUND"]);

    const locataire = await request(app).post(`/api/contracts/${contrat.id}/sign`).set(authHeader(await tokenLocataire(etranger.id))).send({ signatureDataUrl: SIGNATURE });
    expect([locataire.status, locataire.body.code]).toEqual([404, "CONTRACT_NOT_FOUND"]);

    const tiers = await request(app).post(`/api/contracts/${contrat.id}/sign`).set(authHeader(tokenFor(autre.manager))).send({ signatureDataUrl: SIGNATURE });
    expect([tiers.status, tiers.body.code]).toEqual([404, "CONTRACT_NOT_FOUND"]);

    const administrateur = await request(app).post(`/api/contracts/${contrat.id}/sign`).set(authHeader(tokenFor(admin))).send({ signatureDataUrl: SIGNATURE });
    expect([administrateur.status, administrateur.body.code]).toEqual([404, "CONTRACT_NOT_FOUND"]);
  });

  it.each([["data:image/webp;base64,AAAA"], ["data:image/jpeg;base64,/9j/4AAQ"], ["data:image/jpg;base64,/9j/4AAQ"]])("l'image %s est acceptée", async (image) => {
    const { property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id);

    const res = await request(app).post(`/api/contracts/${contrat.id}/sign`).set(h).send({ signatureDataUrl: image });

    expect(res.status).toBe(200);
  });

  it.each([
    ["préfixe devant le début", `x${SIGNATURE}`],
    ["caractère parasite à la fin", `${SIGNATURE}!`],
    ["image sans contenu", "data:image/png;base64,"],
  ])("une signature invalide (%s) est refusée", async (_cas, image) => {
    const { property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id);

    const res = await request(app).post(`/api/contracts/${contrat.id}/sign`).set(h).send({ signatureDataUrl: image });

    expect(res.status).toBe(400);
  });

  it("la limite de taille : exactement le maximum passe, un caractère de plus est refusé", async () => {
    const { property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id);
    const prefixe = "data:image/png;base64,";

    const trop = await request(app).post(`/api/contracts/${contrat.id}/sign`).set(h).send({ signatureDataUrl: prefixe + "A".repeat(TAILLE_MAX_SIGNATURE - prefixe.length + 1) });
    expect(trop.status).toBe(400);

    const limite = await request(app).post(`/api/contracts/${contrat.id}/sign`).set(h).send({ signatureDataUrl: prefixe + "A".repeat(TAILLE_MAX_SIGNATURE - prefixe.length) });
    expect(limite.status).toBe(200);
  });
});

/* ───────────────────────────── Restitution du dépôt ───────────────────────────── */

describe("restitution du dépôt : codes, périmètre et courriel", () => {
  it("un contrat inconnu ou celui d'un autre gestionnaire : CONTRACT_NOT_FOUND", async () => {
    const { h } = await agence();
    const autre = await agence();
    const celuiDeLAutre = await createContract(autre.property.id, autre.tenant.id);

    const inconnu = await request(app).put("/api/contracts/inconnu/deposit-refund").set(h).send({ deductions: [] });
    expect([inconnu.status, inconnu.body.code]).toEqual([404, "CONTRACT_NOT_FOUND"]);

    const tiers = await request(app).put(`/api/contracts/${celuiDeLAutre.id}/deposit-refund`).set(h).send({ deductions: [] });
    expect([tiers.status, tiers.body.code]).toEqual([404, "CONTRACT_NOT_FOUND"]);
  });

  it("seul un état des lieux de SORTIE, FINALISÉ et de CE bail autorise la restitution ; le refus porte son code", async () => {
    const { manager, property, tenant, h } = await agence();
    const p2 = await autreProperty(manager.id);
    const contrat = await createContract(property.id, tenant.id, { deposit: 1000 });
    const autreBail = await createContract(p2.id, tenant.id, { status: "ENDED", startDate: jour("2024-01-01"), endDate: jour("2025-01-01") });
    await createInspection(contrat, manager.id, { type: "ENTRY", status: "COMPLETED" });
    await createInspection(autreBail, manager.id, { type: "EXIT", status: "COMPLETED" });

    const res = await request(app).put(`/api/contracts/${contrat.id}/deposit-refund`).set(h).send({ deductions: [] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("DEPOSIT_NEEDS_EXIT_INSPECTION");
  });

  it("une retenue d'un montant nul est refusée ; le libellé est limité à 200 caractères", async () => {
    const { manager, property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id, { deposit: 1000 });
    await createInspection(contrat, manager.id, { type: "EXIT", status: "COMPLETED" });
    const envoyer = (deductions: unknown) => request(app).put(`/api/contracts/${contrat.id}/deposit-refund`).set(h).send({ deductions });

    expect((await envoyer([{ label: "Peinture", amount: 0 }])).status).toBe(400);
    expect((await envoyer([{ label: "x".repeat(201), amount: 10 }])).status).toBe(400);
    expect((await envoyer([{ label: "x".repeat(200), amount: 10 }])).status).toBe(200);
  });

  it("le courriel au locataire nomme le locataire et le bien, détaille le dépôt, la devise et pointe vers le portail", async () => {
    const { manager, property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id, { deposit: 1000, currency: "XOF" });
    await createInspection(contrat, manager.id, { type: "EXIT", status: "COMPLETED" });

    const res = await request(app).put(`/api/contracts/${contrat.id}/deposit-refund`).set(h).send({ deductions: [{ label: "Peinture", amount: 100 }] });

    expect(res.status).toBe(200);
    const [destinataire, sujet, html] = courriel.mock.calls[0] as [string, string, string];
    expect(destinataire).toBe(tenant.email);
    expect(sujet).toContain("Villa Ngor");
    expect(html).toContain("Bonjour Aminata Diallo");
    expect(html).toContain("<strong>Villa Ngor</strong>");
    expect(sansEspaces(html)).toContain("1000FCFA");
    expect(sansEspaces(html)).toContain("900FCFA");
    expect(html).toMatch(/href="[^"]+\/portail\/contrats"/);
    expect(html).not.toContain('href="/portail/contrats"');
  });
});

/* ───────────────────────────── Scan papier ───────────────────────────── */

describe("scan papier du bail : codes, dossier de stockage, réponse", () => {
  const joindre = (r: request.Test) => r.attach("scan", Buffer.from("%PDF-1.4 test contract"), { filename: "contrat.pdf", contentType: "application/pdf" });

  it("un contrat inconnu ou celui d'un autre gestionnaire : CONTRACT_NOT_FOUND", async () => {
    const { h } = await agence();
    const autre = await agence();
    const celuiDeLAutre = await createContract(autre.property.id, autre.tenant.id);

    const inconnu = await joindre(request(app).post("/api/contracts/inconnu/scan").set(h));
    expect([inconnu.status, inconnu.body.code]).toEqual([404, "CONTRACT_NOT_FOUND"]);

    const tiers = await joindre(request(app).post(`/api/contracts/${celuiDeLAutre.id}/scan`).set(h));
    expect([tiers.status, tiers.body.code]).toEqual([404, "CONTRACT_NOT_FOUND"]);
  });

  it("le fichier est rangé dans le dossier des contrats, l'ancien scan est retiré, et la réponse est le contrat complet", async () => {
    const { property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id, { scannedContractUrl: "contracts/ancien.pdf" });
    const envoi = vi.spyOn(storageService, "uploadPrivateFile").mockResolvedValue("contracts/nouveau.pdf");

    const res = await joindre(request(app).post(`/api/contracts/${contrat.id}/scan`).set(h));

    expect(res.status).toBe(200);
    expect(envoi.mock.calls[0][1]).toBe("contracts");
    expect(suppression).toHaveBeenCalledWith("contracts/ancien.pdf");
    expect(res.body.property.id).toBe(property.id);
    expect(res.body.tenant.id).toBe(tenant.id);
  });

  it("un échec du retrait de l'ancien scan ne fait pas échouer l'envoi", async () => {
    const { property, tenant, h } = await agence();
    const contrat = await createContract(property.id, tenant.id, { scannedContractUrl: "contracts/ancien.pdf" });
    suppression.mockRejectedValue(new Error("stockage coupé"));

    const res = await joindre(request(app).post(`/api/contracts/${contrat.id}/scan`).set(h));

    expect(res.status).toBe(200);
  });
});

void contracts;
