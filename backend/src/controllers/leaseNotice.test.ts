import { and, eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { activityLogs, contracts, invoices, leaseNotices } from "../db/schema";
import { calculerDateDeSortie } from "../services/conge.service";
import { generateInvoicesForContract } from "../services/invoice.service";
import { deleteStorageObjectBestEffort, uploadPrivateFile } from "../services/storage.service";
import {
  authHeader,
  createContract,
  createInspection,
  createManager,
  createProperty,
  createTenant,
  tokenFor,
  tokenLocataire,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

vi.mock("../services/storage.service", () => ({
  uploadPrivateFile: vi.fn(),
  getSignedUrl: vi.fn().mockResolvedValue("http://test.local/signed/conge.pdf"),
  // La liste des baux signe les scans en lot.
  getSignedUrls: vi.fn().mockResolvedValue(new Map()),
  deleteStorageObjectBestEffort: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Congé : l'application ENREGISTRE un congé donné par un autre moyen (acte d'huissier, lettre recommandée…), avec la date de
 * signification, la durée du préavis (saisie, jamais devinée) et le scan du document remis au locataire. Elle ne le notifie pas.
 */
const jour = (annee: number, mois: number, j: number) => new Date(Date.UTC(annee, mois - 1, j));

describe("calculerDateDeSortie", () => {
  it("ajoute des jours civils", () => {
    expect(calculerDateDeSortie(jour(2026, 1, 15), 30, "DAYS")).toEqual(jour(2026, 2, 14));
  });

  it("ajoute des mois de calendrier, au même quantième", () => {
    expect(calculerDateDeSortie(jour(2026, 1, 15), 3, "MONTHS")).toEqual(jour(2026, 4, 15));
    expect(calculerDateDeSortie(jour(2026, 11, 20), 3, "MONTHS")).toEqual(jour(2027, 2, 20));
  });

  it("un quantième absent du mois d'arrivée retombe sur son dernier jour, jamais sur le mois suivant", () => {
    expect(calculerDateDeSortie(jour(2026, 1, 31), 1, "MONTHS")).toEqual(jour(2026, 2, 28));
    expect(calculerDateDeSortie(jour(2028, 1, 31), 1, "MONTHS")).toEqual(jour(2028, 2, 29));
    expect(calculerDateDeSortie(jour(2026, 8, 31), 6, "MONTHS")).toEqual(jour(2027, 2, 28));
  });
});

async function agence() {
  const manager = await createManager();
  const property = await createProperty(manager.id, { title: "Appartement Plateau" });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Diop" });
  const contract = await createContract(property.id, tenant.id, { status: "ACTIVE", startDate: new Date(2025, 0, 1), endDate: new Date(2028, 0, 1) });
  return { manager, property, tenant, contract, h: authHeader(tokenFor(manager)) };
}

const corps = (extra: object = {}) => ({
  givenBy: "LANDLORD",
  deliveryMode: "BAILIFF",
  servedAt: "2026-03-10",
  periodValue: 3,
  periodUnit: "MONTHS",
  bailiffName: "Étude Me Ndiaye",
  actReference: "ACTE-2026-0142",
  ...extra,
});
const enregistrer = (h: Record<string, string>, contractId: string, body: object = corps()) =>
  request(app).post(`/api/contracts/${contractId}/notices`).set(h).send(body);

describe("POST /api/contracts/:id/notices", () => {
  beforeEach(() => {
    vi.mocked(uploadPrivateFile).mockReset();
    vi.mocked(deleteStorageObjectBestEffort).mockReset().mockResolvedValue(undefined);
  });

  it("enregistre un congé signifié par huissier et calcule la date de sortie", async () => {
    const { contract, h } = await agence();
    const res = await enregistrer(h, contract.id);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      givenBy: "LANDLORD",
      deliveryMode: "BAILIFF",
      bailiffName: "Étude Me Ndiaye",
      actReference: "ACTE-2026-0142",
      status: "ACTIVE",
    });
    expect(res.body.exitDate.slice(0, 10)).toBe("2026-06-10");
    const [trace] = await testDb.select().from(activityLogs).where(eq(activityLogs.action, "contract.lease_notice"));
    expect(trace.details).toContain("2026-06-10");
  });

  it("garde la date de sortie fixée par le gestionnaire quand il en donne une", async () => {
    const { contract, h } = await agence();
    const res = await enregistrer(h, contract.id, corps({ exitDate: "2026-07-31" }));
    expect(res.status).toBe(201);
    expect(res.body.exitDate.slice(0, 10)).toBe("2026-07-31");
  });

  it("n'impose aucune durée : sans durée de préavis, la requête est refusée", async () => {
    const { contract, h } = await agence();
    const { periodValue: _v, ...sansDuree } = corps();
    expect((await enregistrer(h, contract.id, sansDuree)).status).toBe(400);
  });

  it("refuse une sortie antérieure à la signification", async () => {
    const { contract, h } = await agence();
    const res = await enregistrer(h, contract.id, corps({ exitDate: "2026-03-01" }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LEASE_NOTICE_EXIT_BEFORE_SERVED");
  });

  it("un seul congé en cours par bail", async () => {
    const { contract, h } = await agence();
    await enregistrer(h, contract.id).expect(201);
    const second = await enregistrer(h, contract.id);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("LEASE_NOTICE_ALREADY_ACTIVE");
  });

  it("refuse un bail qui n'est plus en cours", async () => {
    const { contract, h } = await agence();
    await testDb.update(contracts).set({ status: "ENDED" }).where(eq(contracts.id, contract.id));
    const res = await enregistrer(h, contract.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LEASE_NOTICE_CONTRACT_NOT_ACTIVE");
  });

  it("répond 404 pour le bail d'une autre agence, et 403 pour un locataire", async () => {
    const { contract } = await agence();
    const autre = authHeader(tokenFor(await createManager()));
    expect((await enregistrer(autre, contract.id)).status).toBe(404);
    const { tenant } = await agence();
    const locataire = authHeader(await tokenLocataire(tenant));
    expect((await enregistrer(locataire, contract.id)).status).toBe(403);
  });
});

describe("modification, retrait et historique", () => {
  it("recalcule la sortie quand le préavis change, la garde quand le gestionnaire la fixe", async () => {
    const { contract, h } = await agence();
    const { body } = await enregistrer(h, contract.id);

    const recalcule = await request(app).put(`/api/contracts/${contract.id}/notices/${body.id}`).set(h).send({ periodValue: 2 });
    expect(recalcule.status).toBe(200);
    expect(recalcule.body.exitDate.slice(0, 10)).toBe("2026-05-10");

    const fixee = await request(app).put(`/api/contracts/${contract.id}/notices/${body.id}`).set(h).send({ exitDate: "2026-09-30" });
    expect(fixee.body.exitDate.slice(0, 10)).toBe("2026-09-30");
  });

  it("retire le congé : il reste dans l'historique et un nouveau peut être enregistré", async () => {
    const { contract, h } = await agence();
    const { body } = await enregistrer(h, contract.id);

    const retire = await request(app).post(`/api/contracts/${contract.id}/notices/${body.id}/withdraw`).set(h);
    expect(retire.status).toBe(200);
    expect(retire.body.status).toBe("WITHDRAWN");

    const deuxieme = await request(app).post(`/api/contracts/${contract.id}/notices/${body.id}/withdraw`).set(h);
    expect(deuxieme.status).toBe(409);
    expect((await request(app).put(`/api/contracts/${contract.id}/notices/${body.id}`).set(h).send({ periodValue: 1 })).status).toBe(409);

    await enregistrer(h, contract.id, corps({ servedAt: "2026-05-01" })).expect(201);
    const liste = await request(app).get(`/api/contracts/${contract.id}/notices`).set(h);
    expect(liste.body.conges).toHaveLength(2);
    expect(liste.body.conges.map((c: { status: string }) => c.status).sort()).toEqual(["ACTIVE", "WITHDRAWN"]);
  });

  it("n'agit que sur les congés du bail demandé", async () => {
    const a = await agence();
    const b = await agence();
    const { body } = await enregistrer(a.h, a.contract.id);
    const res = await request(app).post(`/api/contracts/${b.contract.id}/notices/${body.id}/withdraw`).set(b.h);
    expect(res.status).toBe(404);
  });

  it("indique l'avancement de la sortie : état des lieux de sortie et dépôt restitué", async () => {
    const { contract, manager, h } = await agence();
    await enregistrer(h, contract.id).expect(201);

    let liste = await request(app).get(`/api/contracts/${contract.id}/notices`).set(h);
    expect(liste.body.etapes).toEqual({ etatDesLieuxDeSortie: "NONE", depotRestitue: false });

    await createInspection(contract, manager.id, { type: "EXIT", status: "COMPLETED" });
    liste = await request(app).get(`/api/contracts/${contract.id}/notices`).set(h);
    expect(liste.body.etapes.etatDesLieuxDeSortie).toBe("COMPLETED");
  });
});

describe("document remis au locataire (scan)", () => {
  beforeEach(() => {
    vi.mocked(uploadPrivateFile).mockReset();
    vi.mocked(deleteStorageObjectBestEffort).mockReset().mockResolvedValue(undefined);
  });

  it("joint le scan, puis supprime l'ancien quand il est remplacé", async () => {
    vi.mocked(uploadPrivateFile).mockResolvedValueOnce("contracts/acte-1.pdf").mockResolvedValueOnce("contracts/acte-2.pdf");
    const { contract, h } = await agence();
    const { body } = await enregistrer(h, contract.id);

    const premier = await request(app)
      .post(`/api/contracts/${contract.id}/notices/${body.id}/document`)
      .set(h)
      .attach("document", Buffer.from("%PDF-1.4 acte"), { filename: "acte.pdf", contentType: "application/pdf" });
    expect(premier.status).toBe(200);
    expect(premier.body.documentUrl).toBe("http://test.local/signed/conge.pdf");
    expect(deleteStorageObjectBestEffort).not.toHaveBeenCalled();
    const [enBase] = await testDb.select().from(leaseNotices).where(eq(leaseNotices.id, body.id));
    expect(enBase.documentUrl).toBe("contracts/acte-1.pdf");

    await request(app)
      .post(`/api/contracts/${contract.id}/notices/${body.id}/document`)
      .set(h)
      .attach("document", Buffer.from("%PDF-1.4 acte 2"), { filename: "acte2.pdf", contentType: "application/pdf" })
      .expect(200);
    expect(deleteStorageObjectBestEffort).toHaveBeenCalledWith("contracts/acte-1.pdf");
  });

  it("refuse une requête sans fichier", async () => {
    const { contract, h } = await agence();
    const { body } = await enregistrer(h, contract.id);
    const res = await request(app).post(`/api/contracts/${contract.id}/notices/${body.id}/document`).set(h);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LEASE_NOTICE_DOCUMENT_REQUIRED");
  });

  it("supprimer le bail purge aussi le scan du congé", async () => {
    vi.mocked(uploadPrivateFile).mockResolvedValue("contracts/acte.pdf");
    const { contract, h } = await agence();
    const { body } = await enregistrer(h, contract.id);
    await request(app)
      .post(`/api/contracts/${contract.id}/notices/${body.id}/document`)
      .set(h)
      .attach("document", Buffer.from("%PDF-1.4 acte"), { filename: "acte.pdf", contentType: "application/pdf" })
      .expect(200);

    // Un bail en cours ne se supprime pas : il est d'abord clos.
    await testDb.update(contracts).set({ status: "ENDED" }).where(eq(contracts.id, contract.id));
    await request(app).delete(`/api/contracts/${contract.id}`).set(h).expect(204);
    expect(deleteStorageObjectBestEffort).toHaveBeenCalledWith("contracts/acte.pdf");
  });
});

describe("facturation d'un bail dont le congé est en cours", () => {
  it("n'émet plus aucun loyer après le mois de la sortie, le mois de la sortie restant facturé en entier", async () => {
    const { contract, h } = await agence();
    const bail = { ...contract, startDate: new Date(2025, 0, 1), endDate: new Date(2028, 0, 1) };
    await enregistrer(h, contract.id, corps({ servedAt: "2025-02-01", periodValue: 2, periodUnit: "MONTHS", exitDate: "2025-04-15" })).expect(201);

    await generateInvoicesForContract(bail);
    const factures = await testDb.select().from(invoices).where(eq(invoices.contractId, contract.id));
    const periodes = factures.map((f: { periodMonth: number; periodYear: number }) => f.periodYear * 100 + f.periodMonth).sort();
    expect(periodes).toEqual([202501, 202502, 202503, 202504]);
    expect(factures.every((f: { amount: number }) => f.amount === 500)).toBe(true);
  });

  it("reprend la facturation quand le congé est retiré", async () => {
    const { contract, h } = await agence();
    const bail = { ...contract, startDate: new Date(2025, 0, 1), endDate: new Date(2028, 0, 1) };
    const { body } = await enregistrer(h, contract.id, corps({ servedAt: "2025-02-01", exitDate: "2025-04-15" }));
    await generateInvoicesForContract(bail);
    await request(app).post(`/api/contracts/${contract.id}/notices/${body.id}/withdraw`).set(h).expect(200);

    await generateInvoicesForContract(bail);
    const factures = await testDb.select().from(invoices).where(and(eq(invoices.contractId, contract.id)));
    expect(factures.length).toBeGreaterThan(4);
  });

  it("signale les factures déjà émises après la sortie, sans les annuler", async () => {
    const { contract, h } = await agence();
    const bail = { ...contract, startDate: new Date(2025, 0, 1), endDate: new Date(2028, 0, 1) };
    await generateInvoicesForContract(bail);
    const avant = (await testDb.select().from(invoices).where(eq(invoices.contractId, contract.id))).length;

    const res = await enregistrer(h, contract.id, corps({ servedAt: "2025-02-01", exitDate: "2025-04-15" }));
    expect(res.body.facturesApresSortie).toBe(avant - 4);
    const apres = await testDb.select().from(invoices).where(eq(invoices.contractId, contract.id));
    expect(apres).toHaveLength(avant);
    expect(apres.every((f: { status: string }) => f.status !== "CANCELLED")).toBe(true);
  });
});

describe("liste des baux et sorties à venir", () => {
  it("expose le congé en cours dans la liste des baux et dans le détail", async () => {
    const { contract, h } = await agence();
    await enregistrer(h, contract.id).expect(201);

    const liste = await request(app).get("/api/contracts").set(h);
    const bail = liste.body.items.find((c: { id: string }) => c.id === contract.id);
    expect(bail.activeNotice).toMatchObject({ givenBy: "LANDLORD", deliveryMode: "BAILIFF" });
    const detail = await request(app).get(`/api/contracts/${contract.id}`).set(h);
    expect(detail.body.activeNotice.exitDate.slice(0, 10)).toBe("2026-06-10");
  });

  it("liste les sorties de l'agence, la plus proche d'abord, sans celles d'une autre agence ni les congés retirés", async () => {
    const a = await agence();
    const b = await agence();
    const c = await agence();
    await enregistrer(a.h, a.contract.id, corps({ exitDate: "2026-09-30" })).expect(201);
    await enregistrer(b.h, b.contract.id).expect(201);
    const retire = await enregistrer(c.h, c.contract.id);
    await request(app).post(`/api/contracts/${c.contract.id}/notices/${retire.body.id}/withdraw`).set(c.h).expect(200);

    const sorties = await request(app).get("/api/contracts/exits").set(a.h);
    expect(sorties.status).toBe(200);
    expect(sorties.body).toHaveLength(1);
    expect(sorties.body[0]).toMatchObject({ contractId: a.contract.id, propertyTitle: "Appartement Plateau", tenantName: "Awa Diop" });
    expect(sorties.body[0].etapes).toEqual({ etatDesLieuxDeSortie: "NONE", depotRestitue: false });
  });

  it("le tableau de bord compte les sorties à préparer (congés en cours sur des baux en cours)", async () => {
    const a = await agence();
    const b = await agence();
    const sans = await request(app).get("/api/dashboard/stats").set(a.h);
    expect(sans.body.upcomingExits).toBe(0);

    await enregistrer(a.h, a.contract.id).expect(201);
    await enregistrer(b.h, b.contract.id).expect(201);
    const avec = await request(app).get("/api/dashboard/stats").set(a.h);
    expect(avec.body.upcomingExits).toBe(1);

    // Congé retiré, ou bail clos : plus rien à préparer.
    const { body } = await request(app).get(`/api/contracts/${a.contract.id}/notices`).set(a.h);
    await request(app).post(`/api/contracts/${a.contract.id}/notices/${body.conges[0].id}/withdraw`).set(a.h).expect(200);
    expect((await request(app).get("/api/dashboard/stats").set(a.h)).body.upcomingExits).toBe(0);
    await testDb.update(contracts).set({ status: "ENDED" }).where(eq(contracts.id, b.contract.id));
    expect((await request(app).get("/api/dashboard/stats").set(b.h)).body.upcomingExits).toBe(0);
  });
});
