import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { activityLogs, contracts, leaseNotices } from "../db/schema";
import { getSignedUrl, uploadPrivateFile } from "../services/storage.service";
import { authHeader, createContract, createManager, createProperty, createTeamMember, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

vi.mock("../services/storage.service", () => ({
  uploadPrivateFile: vi.fn(),
  getSignedUrl: vi.fn().mockResolvedValue("http://test.local/signed/conge.pdf"),
  getSignedUrls: vi.fn().mockResolvedValue(new Map()),
  deleteStorageObjectBestEffort: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Congé : ce que le fichier principal (leaseNotice.test.ts) ne vérifie pas — la modification d'un congé (ce qui est
 * conservé, effacé ou recalculé), son retrait deux fois, les limites de saisie, et le lien du scan. Un congé fixe la
 * date de sortie qui arrête la facturation : une date mal recalculée coûte un loyer.
 */
const jour = (annee: number, mois: number, j: number) => `${annee}-${String(mois).padStart(2, "0")}-${String(j).padStart(2, "0")}`;
const date = (iso: string) => iso.slice(0, 10);

beforeEach(() => {
  vi.mocked(getSignedUrl).mockReset().mockResolvedValue("http://test.local/signed/conge.pdf");
  vi.mocked(uploadPrivateFile).mockReset();
});

async function agence() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) });
  const property = await createProperty(manager.id, { title: "Appartement Plateau" });
  const tenant = await createTenant(manager.id, { firstName: "Awa", lastName: "Diop" });
  const contract = await createContract(property.id, tenant.id, { status: "ACTIVE", startDate: new Date(2025, 0, 1), endDate: new Date(2028, 0, 1) });
  return { manager, property, tenant, contract, h: authHeader(tokenFor(manager)) };
}
const corps = (extra: object = {}) => ({ givenBy: "LANDLORD", deliveryMode: "BAILIFF", servedAt: "2026-03-10", periodValue: 3, periodUnit: "MONTHS", bailiffName: "Étude Me Ndiaye", actReference: "ACTE-2026-0142", reason: "Reprise pour habiter", ...extra });
const enregistrer = (h: Record<string, string>, contractId: string, body: object = corps()) => request(app).post(`/api/contracts/${contractId}/notices`).set(h).send(body);
const modifier = (h: Record<string, string>, contractId: string, noticeId: string, body: object) => request(app).put(`/api/contracts/${contractId}/notices/${noticeId}`).set(h).send(body);
const retirer = (h: Record<string, string>, contractId: string, noticeId: string) => request(app).post(`/api/contracts/${contractId}/notices/${noticeId}/withdraw`).set(h).send({});
const enBase = async (id: string) => (await testDb.select().from(leaseNotices).where(eq(leaseNotices.id, id)))[0];
const journal = (managerId: string) => testDb.select().from(activityLogs).where(eq(activityLogs.managerId, managerId));

describe("liste des congés d'un bail", () => {
  it("un bail inconnu ou d'une autre agence : 404 (CONTRACT_NOT_FOUND)", async () => {
    const { contract } = await agence();
    const autre = authHeader(tokenFor(await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) })));

    const inconnu = await request(app).get("/api/contracts/bail-inconnu/notices").set((await agence()).h);
    const etranger = await request(app).get(`/api/contracts/${contract.id}/notices`).set(autre);

    for (const res of [inconnu, etranger]) {
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("CONTRACT_NOT_FOUND");
    }
  });

  it("sans congé, ou avec un congé seulement retiré : liste sans avancement de sortie ni facture signalée", async () => {
    const { contract, h } = await agence();

    const vide = await request(app).get(`/api/contracts/${contract.id}/notices`).set(h);
    expect(vide.body).toEqual({ conges: [], etapes: null, facturesApresSortie: 0 });

    const { body } = await enregistrer(h, contract.id);
    await retirer(h, contract.id, body.id).expect(200);
    const retire = await request(app).get(`/api/contracts/${contract.id}/notices`).set(h);

    expect(retire.body.conges).toHaveLength(1);
    expect(retire.body.conges[0].status).toBe("WITHDRAWN");
    expect(retire.body.etapes).toBeNull();
    expect(retire.body.facturesApresSortie).toBe(0);
  });

  it("le lien du scan : un lien web complet est rendu tel quel sans signature, un chemin est signé, et si la signature échoue le chemin est rendu", async () => {
    const { contract, h } = await agence();
    const { body } = await enregistrer(h, contract.id);
    const lien = async () => (await request(app).get(`/api/contracts/${contract.id}/notices`).set(h)).body.conges[0].documentUrl;

    await testDb.update(leaseNotices).set({ documentUrl: "https://exemple.test/acte.pdf" }).where(eq(leaseNotices.id, body.id));
    expect(await lien()).toBe("https://exemple.test/acte.pdf");
    expect(getSignedUrl).not.toHaveBeenCalled();

    await testDb.update(leaseNotices).set({ documentUrl: "contracts/acte.pdf" }).where(eq(leaseNotices.id, body.id));
    expect(await lien()).toBe("http://test.local/signed/conge.pdf");
    expect(getSignedUrl).toHaveBeenCalledWith("contracts/acte.pdf");

    vi.mocked(getSignedUrl).mockRejectedValue(new Error("stockage indisponible"));
    expect(await lien()).toBe("contracts/acte.pdf");

    await testDb.update(leaseNotices).set({ documentUrl: null }).where(eq(leaseNotices.id, body.id));
    expect(await lien()).toBeNull();
  });
});

describe("enregistrement d'un congé : limites et traces", () => {
  it("un bail inconnu : 404 (CONTRACT_NOT_FOUND)", async () => {
    const { h } = await agence();

    const res = await enregistrer(h, "bail-inconnu");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("CONTRACT_NOT_FOUND");
  });

  it("les textes facultatifs : espaces retirés, vide ou absent devient « rien »", async () => {
    const { contract, h } = await agence();

    const res = await enregistrer(h, contract.id, corps({ bailiffName: "  Étude Me Fall  ", actReference: "", reason: null }));
    const sans = await agence();
    const absent = await enregistrer(sans.h, sans.contract.id, corps({ bailiffName: undefined, actReference: undefined, reason: undefined }));

    expect(res.body).toMatchObject({ bailiffName: "Étude Me Fall", actReference: null, reason: null });
    expect(absent.body).toMatchObject({ bailiffName: null, actReference: null, reason: null });
  });

  it("limites de saisie : préavis de 1 à 120, textes bornés, unité et auteur connus, date plausible", async () => {
    const { contract, h } = await agence();
    const refuse = async (extra: object, code?: string) => {
      const res = await enregistrer(h, contract.id, corps(extra));
      expect(res.status, JSON.stringify(extra)).toBe(400);
      if (code) expect(res.body.code, JSON.stringify(extra)).toBe(code);
    };

    await refuse({ periodValue: 0 });
    await refuse({ periodValue: 121 });
    await refuse({ periodValue: 2.5 });
    await refuse({ periodUnit: "YEARS" });
    await refuse({ givenBy: "VOISIN" });
    await refuse({ deliveryMode: "PIGEON" });
    await refuse({ bailiffName: "x".repeat(201) });
    await refuse({ actReference: "x".repeat(121) });
    await refuse({ reason: "x".repeat(1001) });
    await refuse({ servedAt: "1800-01-01" }, "LEASE_DATE_OUT_OF_RANGE");
    await refuse({ servedAt: "pas une date" });
    expect(await testDb.select().from(leaseNotices).where(eq(leaseNotices.contractId, contract.id))).toEqual([]);

    expect((await enregistrer(h, contract.id, corps({ periodValue: 120, bailiffName: "x".repeat(200), actReference: "y".repeat(120), reason: "z".repeat(1000) }))).status).toBe(201);
  });

  it("une sortie antérieure à la signification, un bail qui n'est plus en cours et un second congé sont refusés, avec leur code", async () => {
    const { contract, h } = await agence();

    const avant = await enregistrer(h, contract.id, corps({ exitDate: "2026-03-01" }));
    expect(avant.status).toBe(400);
    expect(avant.body.code).toBe("LEASE_NOTICE_EXIT_BEFORE_SERVED");
    expect(await testDb.select().from(leaseNotices).where(eq(leaseNotices.contractId, contract.id))).toEqual([]);

    await enregistrer(h, contract.id).expect(201);
    const doublon = await enregistrer(h, contract.id, corps({ servedAt: "2026-05-01" }));
    expect(doublon.status).toBe(409);
    expect(doublon.body.code).toBe("LEASE_NOTICE_ALREADY_ACTIVE");
    expect(await testDb.select().from(leaseNotices).where(eq(leaseNotices.contractId, contract.id))).toHaveLength(1);

    const autre = await agence();
    await testDb.update(contracts).set({ status: "ENDED" }).where(eq(contracts.id, autre.contract.id));
    const termine = await enregistrer(autre.h, autre.contract.id);
    expect(termine.status).toBe(409);
    expect(termine.body.code).toBe("LEASE_NOTICE_CONTRACT_NOT_ACTIVE");
  });

  it("une sortie le jour même de la signification est acceptée (pas avant)", async () => {
    const { contract, h } = await agence();

    const res = await enregistrer(h, contract.id, corps({ exitDate: "2026-03-10" }));

    expect(res.status).toBe(201);
    expect(date(res.body.exitDate)).toBe("2026-03-10");
  });

  it("la trace dit qui a donné le congé, par quel moyen et pour quelle date ; le nom du locataire figure dans le libellé", async () => {
    const { manager, contract, h } = await agence();
    const bailleur = await enregistrer(h, contract.id, corps());
    await retirer(h, contract.id, bailleur.body.id).expect(200);
    await enregistrer(h, contract.id, corps({ givenBy: "TENANT", deliveryMode: "REGISTERED_MAIL", servedAt: "2026-04-01", periodValue: 1 })).expect(201);

    const lignes = (await journal(manager.id)).filter((l: { action: string }) => l.action === "contract.lease_notice");

    expect(lignes).toHaveLength(2);
    const details = lignes.map((l: { details: string | null }) => l.details ?? "");
    expect(details.some((d: string) => d.startsWith("Congé enregistré (donné par le bailleur, BAILIFF), sortie prévue le 2026-06-10"))).toBe(true);
    expect(details.some((d: string) => d.startsWith("Congé enregistré (donné par le locataire, REGISTERED_MAIL), sortie prévue le 2026-05-01"))).toBe(true);
    expect(lignes[0].entityLabel).toBe("Appartement Plateau — Awa Diop");
  });

  it("un collaborateur de l'agence peut enregistrer un congé, et c'est lui qui est consigné comme auteur", async () => {
    const { manager, contract } = await agence();
    const collaborateur = await createTeamMember(manager.id);
    const token = tokenFor({ id: manager.id, role: "MANAGER" }, null, null, collaborateur.id);

    const res = await enregistrer(authHeader(token), contract.id);

    expect(res.status).toBe(201);
    expect((await enBase(res.body.id)).createdBy).toBe(collaborateur.id);
  });
});

describe("modification d'un congé (PUT)", () => {
  async function conge() {
    const a = await agence();
    const { body } = await enregistrer(a.h, a.contract.id); // signifié le 10 mars 2026, préavis de 3 mois → sortie le 10 juin
    return { ...a, noticeId: body.id as string };
  }

  it("un congé inconnu, ou celui d'un autre bail : 404 (LEASE_NOTICE_NOT_FOUND)", async () => {
    const a = await conge();
    const autre = await agence();
    const { body: autreConge } = await enregistrer(autre.h, autre.contract.id);

    const inconnu = await modifier(a.h, a.contract.id, "conge-inconnu", { reason: "x" });
    const etranger = await modifier(a.h, a.contract.id, autreConge.id, { reason: "x" });

    for (const res of [inconnu, etranger]) {
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("LEASE_NOTICE_NOT_FOUND");
    }
  });

  it("un congé retiré ne se modifie plus (409, LEASE_NOTICE_NOT_ACTIVE)", async () => {
    const { contract, h, noticeId } = await conge();
    await retirer(h, contract.id, noticeId).expect(200);

    const res = await modifier(h, contract.id, noticeId, { reason: "Nouveau motif" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LEASE_NOTICE_NOT_ACTIVE");
    expect((await enBase(noticeId)).reason).toBe("Reprise pour habiter");
  });

  it("changer seulement le motif ne touche ni la date de sortie ni les autres champs", async () => {
    const { contract, h, noticeId } = await conge();
    const avant = await enBase(noticeId);

    const res = await modifier(h, contract.id, noticeId, { reason: "Vente du bien" });

    expect(res.status).toBe(200);
    const apres = await enBase(noticeId);
    expect(apres.reason).toBe("Vente du bien");
    expect(apres.exitDate).toEqual(avant.exitDate);
    expect(apres.servedAt).toEqual(avant.servedAt);
    expect(apres.periodValue).toBe(3);
    expect(apres.periodUnit).toBe("MONTHS");
    expect(apres.givenBy).toBe("LANDLORD");
    expect(apres.deliveryMode).toBe("BAILIFF");
    expect(apres.bailiffName).toBe("Étude Me Ndiaye");
    expect(apres.actReference).toBe("ACTE-2026-0142");
  });

  it("un champ facultatif absent est conservé, vide ou nul est effacé, un nouveau texte est enregistré", async () => {
    const { contract, h, noticeId } = await conge();

    await modifier(h, contract.id, noticeId, { bailiffName: "", actReference: null }).expect(200);
    const effaces = await enBase(noticeId);
    expect(effaces.bailiffName).toBeNull();
    expect(effaces.actReference).toBeNull();
    expect(effaces.reason).toBe("Reprise pour habiter");

    await modifier(h, contract.id, noticeId, { bailiffName: "  Étude Me Sy  " }).expect(200);
    const rempli = await enBase(noticeId);
    expect(rempli.bailiffName).toBe("Étude Me Sy");
    expect(rempli.actReference).toBeNull();
  });

  it("changer l'auteur ou le mode de remise les enregistre sans recalculer la sortie", async () => {
    const { contract, h, noticeId } = await conge();
    const avant = await enBase(noticeId);

    await modifier(h, contract.id, noticeId, { givenBy: "TENANT", deliveryMode: "HAND_DELIVERY" }).expect(200);

    const apres = await enBase(noticeId);
    expect(apres.givenBy).toBe("TENANT");
    expect(apres.deliveryMode).toBe("HAND_DELIVERY");
    expect(apres.exitDate).toEqual(avant.exitDate);
  });

  it("la date de sortie suit le préavis : changer la durée, l'unité ou la signification la recalcule", async () => {
    const { contract, h, noticeId } = await conge();

    const duree = await modifier(h, contract.id, noticeId, { periodValue: 6 });
    expect(date(duree.body.exitDate)).toBe("2026-09-10");

    const unite = await modifier(h, contract.id, noticeId, { periodValue: 45, periodUnit: "DAYS" });
    expect(date(unite.body.exitDate)).toBe("2026-04-24");

    const signification = await modifier(h, contract.id, noticeId, { servedAt: jour(2026, 5, 1) });
    expect(date(signification.body.exitDate)).toBe("2026-06-15");
    expect(date((await enBase(noticeId)).servedAt.toISOString())).toBe("2026-05-01");
  });

  it("changer seulement l'unité du préavis (3 mois devenant 3 jours) recalcule la sortie", async () => {
    const { contract, h, noticeId } = await conge();

    const res = await modifier(h, contract.id, noticeId, { periodUnit: "DAYS" });

    expect(res.status).toBe(200);
    expect(date(res.body.exitDate)).toBe("2026-03-13");
  });

  it("une sortie fixée à la main à l'enregistrement n'est PAS recalculée quand on ne modifie que le motif", async () => {
    const a = await agence();
    const { body } = await enregistrer(a.h, a.contract.id, corps({ exitDate: "2026-07-31" }));

    const res = await modifier(a.h, a.contract.id, body.id, { reason: "Nouveau motif" });

    expect(res.status).toBe(200);
    expect(date(res.body.exitDate)).toBe("2026-07-31");
    expect(date((await enBase(body.id)).exitDate.toISOString())).toBe("2026-07-31");
  });

  it("le motif s'efface avec une valeur nulle ou vide, et reste quand il est absent", async () => {
    const { contract, h, noticeId } = await conge();

    await modifier(h, contract.id, noticeId, { periodValue: 4 }).expect(200);
    expect((await enBase(noticeId)).reason).toBe("Reprise pour habiter");

    await modifier(h, contract.id, noticeId, { reason: null }).expect(200);
    expect((await enBase(noticeId)).reason).toBeNull();

    await modifier(h, contract.id, noticeId, { reason: "Autre motif" }).expect(200);
    await modifier(h, contract.id, noticeId, { reason: "" }).expect(200);
    expect((await enBase(noticeId)).reason).toBeNull();
  });

  it("une sortie fixée à la main dans la requête l'emporte sur le recalcul, même quand le préavis change", async () => {
    const { contract, h, noticeId } = await conge();

    const res = await modifier(h, contract.id, noticeId, { periodValue: 6, exitDate: jour(2026, 12, 31) });

    expect(res.status).toBe(200);
    expect(date(res.body.exitDate)).toBe("2026-12-31");
    expect((await enBase(noticeId)).periodValue).toBe(6);
  });

  it("une sortie antérieure à la signification est refusée (LEASE_NOTICE_EXIT_BEFORE_SERVED), rien n'est modifié", async () => {
    const { contract, h, noticeId } = await conge();
    const avant = await enBase(noticeId);

    const directe = await modifier(h, contract.id, noticeId, { exitDate: jour(2026, 3, 9) });
    const parSignification = await modifier(h, contract.id, noticeId, { servedAt: jour(2026, 7, 1), exitDate: jour(2026, 6, 10) });

    for (const res of [directe, parSignification]) {
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("LEASE_NOTICE_EXIT_BEFORE_SERVED");
    }
    const apres = await enBase(noticeId);
    expect(apres.exitDate).toEqual(avant.exitDate);
    expect(apres.servedAt).toEqual(avant.servedAt);
  });

  it("une sortie le jour même de la signification est acceptée", async () => {
    const { contract, h, noticeId } = await conge();

    const res = await modifier(h, contract.id, noticeId, { exitDate: jour(2026, 3, 10) });

    expect(res.status).toBe(200);
    expect(date(res.body.exitDate)).toBe("2026-03-10");
  });

  it("les limites de saisie s'appliquent aussi à la modification", async () => {
    const { contract, h, noticeId } = await conge();

    for (const extra of [{ periodValue: 0 }, { periodValue: 121 }, { periodUnit: "YEARS" }, { reason: "x".repeat(1001) }, { servedAt: "1800-01-01" }]) {
      expect((await modifier(h, contract.id, noticeId, extra)).status, JSON.stringify(extra)).toBe(400);
    }
    expect((await enBase(noticeId)).periodValue).toBe(3);
  });

  it("la trace dit la nouvelle date de sortie et la réponse signale les loyers déjà émis après la sortie", async () => {
    const { manager, contract, h, noticeId } = await conge();

    const res = await modifier(h, contract.id, noticeId, { periodValue: 1 });

    expect(res.status).toBe(200);
    expect(res.body.facturesApresSortie).toBe(0);
    const trace = (await journal(manager.id)).find((l: { action: string }) => l.action === "contract.lease_notice_update");
    expect(trace?.details).toBe("Congé modifié, sortie prévue le 2026-04-10.");
    expect(trace?.entityLabel).toBe("Appartement Plateau");
  });

  it("un locataire ou un autre gestionnaire ne peut pas modifier le congé", async () => {
    const { contract, noticeId } = await conge();
    const etranger = authHeader(tokenFor(await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) })));

    const res = await modifier(etranger, contract.id, noticeId, { reason: "Détourné" });

    expect(res.status).toBe(404);
    expect((await enBase(noticeId)).reason).toBe("Reprise pour habiter");
  });
});

describe("retrait d'un congé", () => {
  it("retirer deux fois : le second est refusé (409, LEASE_NOTICE_NOT_ACTIVE), une seule trace, la date de retrait ne bouge pas", async () => {
    const { manager, contract, h } = await agence();
    const { body } = await enregistrer(h, contract.id);

    const premier = await retirer(h, contract.id, body.id);
    const retraitLe = (await enBase(body.id)).withdrawnAt;
    const second = await retirer(h, contract.id, body.id);

    expect(premier.status).toBe(200);
    expect(premier.body.status).toBe("WITHDRAWN");
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("LEASE_NOTICE_NOT_ACTIVE");
    expect((await enBase(body.id)).withdrawnAt).toEqual(retraitLe);
    expect(retraitLe).not.toBeNull();
    const traces = (await journal(manager.id)).filter((l: { action: string }) => l.action === "contract.lease_notice_withdraw");
    expect(traces).toHaveLength(1);
    expect(traces[0].details).toBe("Congé retiré : le bail se poursuit.");
  });

  it("un congé inconnu ou d'un autre agence : 404, le congé reste en cours", async () => {
    const { contract, h } = await agence();
    const { body } = await enregistrer(h, contract.id);
    const etranger = authHeader(tokenFor(await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) })));

    expect((await retirer(h, contract.id, "conge-inconnu")).status).toBe(404);
    expect((await retirer(etranger, contract.id, body.id)).status).toBe(404);
    expect((await enBase(body.id)).status).toBe("ACTIVE");
    expect((await testDb.select().from(contracts).where(eq(contracts.id, contract.id)))[0].status).toBe("ACTIVE");
  });

  it("après un retrait, un nouveau congé peut être enregistré sur le même bail", async () => {
    const { contract, h } = await agence();
    const { body } = await enregistrer(h, contract.id);
    await retirer(h, contract.id, body.id).expect(200);

    const nouveau = await enregistrer(h, contract.id, corps({ servedAt: "2026-05-01" }));

    expect(nouveau.status).toBe(201);
    expect(nouveau.body.id).not.toBe(body.id);
  });
});

describe("document du congé : bail et congé visés", () => {
  it("un congé inconnu : 404 avant tout envoi de fichier au stockage", async () => {
    const { contract, h } = await agence();

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/notices/conge-inconnu/document`)
      .set(h)
      .attach("document", Buffer.from("%PDF-1.4 acte"), { filename: "acte.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(404);
    expect(uploadPrivateFile).not.toHaveBeenCalled();
  });
});
