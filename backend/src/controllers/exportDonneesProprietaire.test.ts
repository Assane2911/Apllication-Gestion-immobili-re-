import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { activityLogs, agencySettings, ownerFeeRates, ownerMessages, ownerPayouts, owners } from "../db/schema";
import * as emailService from "../services/email.service";
import * as storageService from "../services/storage.service";
import { authHeader, createContract, createManager, createOwner, createProperty, createTenant, tokenFor, tokenProprietaire } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)]);

beforeEach(() => {
  vi.spyOn(emailService, "sendEmail").mockResolvedValue(undefined as never);
  vi.spyOn(storageService, "uploadPrivateFile").mockResolvedValue("messages/secret-chemin.webm");
  vi.spyOn(storageService, "getSignedUrl").mockResolvedValue("https://stockage.test/signe");
});
afterEach(() => vi.restoreAllMocks());

/**
 * Droit d'accès (RGPD art. 15) et portabilité (art. 20) pour un PROPRIÉTAIRE : le même droit que celui du locataire, deux
 * portes — l'agence, responsable de traitement, et le propriétaire lui-même depuis son espace.
 */
describe("Export des données d'un propriétaire", () => {
  async function dossier() {
    const manager = await createManager();
    await testDb.insert(agencySettings).values({ userId: manager.id, agencyName: "Agence du Port", phone: "+221770000000" });
    const owner = await createOwner(manager.id, { firstName: "Fatou", lastName: "Diop", iban: "SN08SN0100152000048500003035", notes: "Préfère être jointe le matin" });
    const bien = await createProperty(manager.id, { title: "Villa Baobab", ownerId: owner.id });
    const tenant = await createTenant(manager.id, { firstName: "Locataire", lastName: "Confidentiel", email: "tiers@test.local" });
    await createContract(bien.id, tenant.id);
    await testDb.insert(ownerPayouts).values({ ownerId: owner.id, periodMonth: 6, periodYear: 2026, currency: "XOF", amount: 400000, paidAt: new Date(), method: "MOBILE_MONEY", reference: "WAVE-123" });
    await testDb.insert(ownerFeeRates).values({ ownerId: owner.id, effectiveYear: 2026, effectiveMonth: 1, rate: 8 });
    await testDb.insert(activityLogs).values({ managerId: manager.id, actorLabel: "agence", action: "owner.create", entityType: "owner", entityId: owner.id, entityLabel: "Fatou Diop", details: "Propriétaire créé : Fatou Diop" });
    const tokenOwner = await tokenProprietaire(owner);
    const tokenManager = tokenFor(manager);
    await request(app).post(`/api/owner-messages/${owner.id}`).set(authHeader(tokenManager)).send({ content: "Votre virement est parti" });
    await request(app)
      .post("/api/owner-messages/mine/audio")
      .set(authHeader(tokenOwner))
      .field("durationSec", "8")
      .attach("audio", WEBM, { filename: "v.webm", contentType: "audio/webm" });
    return { manager, owner, bien, tenant, tokenOwner, tokenManager };
  }

  it("le propriétaire emporte sa fiche, ses biens, ses versements, son taux, sa discussion et son journal", async () => {
    const { owner, tokenOwner } = await dossier();
    const res = await request(app).get("/api/owners/mine/export").set(authHeader(tokenOwner));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="donnees-fatou-diop-\d{4}-\d{2}-\d{2}\.json"$/);
    const d = JSON.parse(res.text);
    expect(d.proprietaire).toMatchObject({ id: owner.id, firstName: "Fatou", lastName: "Diop", iban: "SN08SN0100152000048500003035", notes: "Préfère être jointe le matin", compteDePortail: true });
    expect(d.responsableDuTraitement).toMatchObject({ agencyName: "Agence du Port", telephone: "+221770000000" });
    expect(d.biens.map((b: { title: string }) => b.title)).toEqual(["Villa Baobab"]);
    expect(d.versements).toHaveLength(1);
    expect(d.versements[0]).toMatchObject({ amount: 400000, currency: "XOF", reference: "WAVE-123" });
    expect(d.historiqueDuTauxDeCommission).toHaveLength(1);
    expect(d.journalActivite.map((j: { action: string }) => j.action)).toEqual(["owner.create"]);
    expect(d.discussionAvecLAgence.map((m: { senderRole: string }) => m.senderRole).sort()).toEqual(["MANAGER", "OWNER"]);
  });

  it("n'expose ni le chemin de stockage des vocaux, ni les identifiants internes des auteurs", async () => {
    const { tokenOwner } = await dossier();
    const res = await request(app).get("/api/owners/mine/export").set(authHeader(tokenOwner));
    expect(res.text).not.toContain("secret-chemin");
    expect(res.text).not.toContain("audioPath");
    const d = JSON.parse(res.text);
    const vocal = d.discussionAvecLAgence.find((m: { vocal: boolean }) => m.vocal);
    expect(vocal).toMatchObject({ senderRole: "OWNER", audioDurationSec: 8, audioMime: "audio/webm" });
    for (const m of d.discussionAvecLAgence) {
      expect(m.senderId).toBeUndefined();
      expect(m.managerId).toBeUndefined();
    }
  });

  it("ne livre aucune donnée des locataires de ses biens (des tiers)", async () => {
    const { tokenOwner } = await dossier();
    const res = await request(app).get("/api/owners/mine/export").set(authHeader(tokenOwner));
    expect(res.text).not.toContain("Confidentiel");
    expect(res.text).not.toContain("tiers@test.local");
  });

  it("n'inclut que SES données : ni les biens, ni les versements, ni la discussion d'un autre propriétaire de la même agence", async () => {
    const { manager, tokenOwner, tokenManager } = await dossier();
    const autre = await createOwner(manager.id, { firstName: "Moussa", lastName: "Sy" });
    await createProperty(manager.id, { title: "Immeuble de Moussa", ownerId: autre.id });
    await testDb.insert(ownerPayouts).values({ ownerId: autre.id, periodMonth: 6, periodYear: 2026, currency: "XOF", amount: 999999, paidAt: new Date(), method: "CASH" });
    await tokenProprietaire(autre);
    await request(app).post(`/api/owner-messages/${autre.id}`).set(authHeader(tokenManager)).send({ content: "Secret de Moussa" });

    const res = await request(app).get("/api/owners/mine/export").set(authHeader(tokenOwner));
    expect(res.text).not.toContain("Moussa");
    expect(res.text).not.toContain("999999");
    expect(res.text).not.toContain("Secret de Moussa");
  });

  it("l'agence exporte les données de SON propriétaire — jamais celles d'un propriétaire d'une autre agence", async () => {
    const { owner, tokenManager } = await dossier();
    const ok = await request(app).get(`/api/owners/${owner.id}/export`).set(authHeader(tokenManager));
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.text).proprietaire.id).toBe(owner.id);

    const autre = await createManager();
    const refus = await request(app).get(`/api/owners/${owner.id}/export`).set(authHeader(tokenFor(autre)));
    expect(refus.status).toBe(404);
    expect(refus.text).not.toContain("Fatou");
  });

  it("refuse les autres rôles et les requêtes sans jeton ; un compte sans fiche reçoit un 403 explicite", async () => {
    const { owner, tokenOwner, tokenManager } = await dossier();
    expect((await request(app).get("/api/owners/mine/export")).status).toBe(401);
    expect((await request(app).get("/api/owners/mine/export").set(authHeader(tokenManager))).status).toBe(403);
    // Le propriétaire ne passe pas par la porte de l'agence, même avec l'identifiant de sa propre fiche.
    expect((await request(app).get(`/api/owners/${owner.id}/export`).set(authHeader(tokenOwner))).status).toBe(403);

    await testDb.update(owners).set({ userId: null }).where((await import("drizzle-orm")).eq(owners.id, owner.id));
    const detache = await request(app).get("/api/owners/mine/export").set(authHeader(tokenOwner));
    expect(detache.status).toBe(403);
    expect(detache.body.code).toBe("OWNER_NOT_LINKED");
  });

  it("une fiche sans bien, sans versement ni discussion donne un export vide mais valide", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id);
    const res = await request(app).get("/api/owners/mine/export").set(authHeader(await tokenProprietaire(owner)));
    expect(res.status).toBe(200);
    const d = JSON.parse(res.text);
    expect(d.biens).toEqual([]);
    expect(d.versements).toEqual([]);
    expect(d.discussionAvecLAgence).toEqual([]);
    expect(d.proprietaire.id).toBe(owner.id);
  });
});
