import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { activityLogs, adminAuditLogs, agencySettings, listingLeads, listings } from "../db/schema";
import { authHeader, createAdmin, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

vi.mock("../services/storage.service", () => ({
  uploadPublicFile: vi.fn().mockResolvedValue("http://test.local/mock-image.png"),
  deleteStorageObjectBestEffort: vi.fn().mockResolvedValue(undefined),
}));

const MOTIF = "Photos sans rapport avec le bien — signalement INTERNE-7";

async function creerAnnonce(managerId: string, overrides: Partial<typeof listings.$inferInsert> = {}) {
  const [annonce] = await testDb
    .insert(listings)
    .values({
      managerId,
      title: "Villa Ngor",
      description: "Belle villa avec piscine, vue sur mer",
      price: 250000,
      location: "Ngor, Dakar",
      country: "SN",
      contactPhone: "+221770000000",
      ...overrides,
    })
    .returning();
  return annonce;
}

async function adminToken() {
  return tokenFor(await createAdmin());
}

function masquer(id: string, token: string, reason: string = MOTIF) {
  return request(app).post(`/api/admin/listings/${id}/hide`).set(authHeader(token)).send({ reason });
}

describe("accès aux routes de modération", () => {
  it("exige l'authentification et refuse un gestionnaire", async () => {
    const manager = await createManager();
    const annonce = await creerAnnonce(manager.id);
    const entetes = authHeader(tokenFor(manager));

    expect((await request(app).get("/api/admin/listings")).status).toBe(401);
    expect((await request(app).get("/api/admin/listings").set(entetes)).status).toBe(403);
    expect((await request(app).post(`/api/admin/listings/${annonce.id}/hide`).set(entetes).send({ reason: "abc" })).status).toBe(403);
    expect((await request(app).post(`/api/admin/listings/${annonce.id}/restore`).set(entetes)).status).toBe(403);
    expect((await request(app).post(`/api/admin/listings/${annonce.id}/featured`).set(entetes).send({ featured: true })).status).toBe(403);

    const [intacte] = await testDb.select().from(listings).where(eq(listings.id, annonce.id));
    expect(intacte.hiddenByAdminAt).toBeNull();
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });
});

describe("POST /api/admin/listings/:id/hide", () => {
  it("masque l'annonce, enregistre le motif et laisse une trace d'audit et d'activité", async () => {
    const admin = await createAdmin();
    const manager = await createManager();
    const annonce = await creerAnnonce(manager.id);

    const res = await masquer(annonce.id, tokenFor(admin));

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(listings).where(eq(listings.id, annonce.id));
    expect(apres.hiddenByAdminAt).not.toBeNull();
    expect(apres.moderationReason).toBe(MOTIF);
    // Le choix du gestionnaire n'est pas touché : la modération est orthogonale.
    expect(apres.status).toBe("PUBLISHED");

    const audit = await testDb.select().from(adminAuditLogs);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "listing.hide",
      adminId: admin.id,
      targetUserId: manager.id,
      targetLabel: manager.email,
    });
    expect(audit[0].details).toContain(MOTIF);
    expect(audit[0].details).toContain("Villa Ngor");

    const activite = await testDb.select().from(activityLogs).where(eq(activityLogs.managerId, manager.id));
    expect(activite).toHaveLength(1);
    expect(activite[0]).toMatchObject({ action: "listing.hide_by_admin", entityId: annonce.id });
    expect(activite[0].details).toContain(MOTIF);
  });

  it("exige un motif d'au moins 3 caractères", async () => {
    const token = await adminToken();
    const manager = await createManager();
    const annonce = await creerAnnonce(manager.id);

    expect((await masquer(annonce.id, token, "  ")).status).toBe(400);
    expect((await masquer(annonce.id, token, "ab")).status).toBe(400);
    const sansMotif = await request(app).post(`/api/admin/listings/${annonce.id}/hide`).set(authHeader(token)).send({});
    expect(sansMotif.status).toBe(400);

    const [intacte] = await testDb.select().from(listings).where(eq(listings.id, annonce.id));
    expect(intacte.hiddenByAdminAt).toBeNull();
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });

  it("renvoie 404 pour une annonce inconnue", async () => {
    const res = await masquer("annonce-inexistante", await adminToken());
    expect(res.status).toBe(404);
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });

  it("refuse (409) de masquer deux fois, sans seconde trace ni écrasement du motif", async () => {
    const token = await adminToken();
    const manager = await createManager();
    const annonce = await creerAnnonce(manager.id);

    expect((await masquer(annonce.id, token)).status).toBe(200);
    const second = await masquer(annonce.id, token, "Un autre motif");

    expect(second.status).toBe(409);
    const [apres] = await testDb.select().from(listings).where(eq(listings.id, annonce.id));
    expect(apres.moderationReason).toBe(MOTIF);
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(1);
  });
});

describe("une annonce masquée disparaît de toute la vitrine publique", () => {
  it("n'apparaît ni dans la liste, ni dans les pays, ni en fiche, et n'accepte plus de demande", async () => {
    const token = await adminToken();
    const manager = await createManager();
    const masquee = await creerAnnonce(manager.id, { title: "Masquée", country: "SN" });
    await creerAnnonce(manager.id, { title: "Visible", country: "FR" });

    expect((await masquer(masquee.id, token)).status).toBe(200);

    const liste = await request(app).get("/api/listings/public");
    expect(liste.body.items.map((l: { title: string }) => l.title)).toEqual(["Visible"]);
    expect(liste.body.total).toBe(1);

    const pays = await request(app).get("/api/listings/public/countries");
    expect(pays.body.countries).toEqual(["FR"]);

    expect((await request(app).get(`/api/listings/public/${masquee.id}`)).status).toBe(404);

    const demande = await request(app)
      .post(`/api/listings/public/${masquee.id}/leads`)
      .send({ prospectName: "Awa Sow", prospectEmail: "awa@test.local", prospectPhone: "+221771234567" });
    expect(demande.status).toBe(404);
    expect(await testDb.select().from(listingLeads)).toHaveLength(0);
  });

  it("garde les demandes déjà reçues et l'annonce visible du gestionnaire, avec le motif", async () => {
    const token = await adminToken();
    const manager = await createManager();
    const annonce = await creerAnnonce(manager.id);
    await testDb.insert(listingLeads).values({
      listingId: annonce.id,
      managerId: manager.id,
      prospectName: "Awa Sow",
      prospectEmail: "awa@test.local",
      prospectPhone: "+221771234567",
    });

    await masquer(annonce.id, token);

    const chezLeGestionnaire = await request(app).get(`/api/listings/${annonce.id}`).set(authHeader(tokenFor(manager)));
    expect(chezLeGestionnaire.status).toBe(200);
    expect(chezLeGestionnaire.body.moderationReason).toBe(MOTIF);
    expect(chezLeGestionnaire.body.hiddenByAdminAt).not.toBeNull();
    expect(await testDb.select().from(listingLeads)).toHaveLength(1);
  });

  it("n'expose jamais l'état de modération dans la réponse publique", async () => {
    const manager = await createManager();
    const annonce = await creerAnnonce(manager.id);

    const liste = await request(app).get("/api/listings/public");
    const fiche = await request(app).get(`/api/listings/public/${annonce.id}`);

    for (const objet of [liste.body.items[0], fiche.body]) {
      expect(objet).not.toHaveProperty("hiddenByAdminAt");
      expect(objet).not.toHaveProperty("moderationReason");
      expect(objet).not.toHaveProperty("managerId");
    }
  });

  it("le gestionnaire ne peut pas lever la modération, ni en republiant ni en forgeant les champs", async () => {
    const token = await adminToken();
    const manager = await createManager();
    const annonce = await creerAnnonce(manager.id);
    await masquer(annonce.id, token);

    const maj = await request(app)
      .put(`/api/listings/${annonce.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ status: "PUBLISHED", hiddenByAdminAt: null, moderationReason: null, title: "Villa Ngor v2" });

    expect(maj.status).toBe(200);
    const [apres] = await testDb.select().from(listings).where(eq(listings.id, annonce.id));
    expect(apres.title).toBe("Villa Ngor v2");
    expect(apres.hiddenByAdminAt).not.toBeNull();
    expect(apres.moderationReason).toBe(MOTIF);

    const liste = await request(app).get("/api/listings/public");
    expect(liste.body.items).toHaveLength(0);
  });
});

describe("POST /api/admin/listings/:id/restore", () => {
  it("rétablit l'annonce, efface le motif et laisse une trace", async () => {
    const admin = await createAdmin();
    const token = tokenFor(admin);
    const manager = await createManager();
    const annonce = await creerAnnonce(manager.id);
    await masquer(annonce.id, token);

    const res = await request(app).post(`/api/admin/listings/${annonce.id}/restore`).set(authHeader(token));

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(listings).where(eq(listings.id, annonce.id));
    expect(apres.hiddenByAdminAt).toBeNull();
    expect(apres.moderationReason).toBeNull();
    expect((await request(app).get(`/api/listings/public/${annonce.id}`)).status).toBe(200);

    const audit = await testDb.select().from(adminAuditLogs).where(eq(adminAuditLogs.action, "listing.restore"));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ adminId: admin.id, targetUserId: manager.id });
  });

  it("ne publie pas un brouillon : le choix du gestionnaire est respecté", async () => {
    const token = await adminToken();
    const manager = await createManager();
    const brouillon = await creerAnnonce(manager.id, { status: "DRAFT" });
    await masquer(brouillon.id, token);

    await request(app).post(`/api/admin/listings/${brouillon.id}/restore`).set(authHeader(token));

    expect((await request(app).get(`/api/listings/public/${brouillon.id}`)).status).toBe(404);
  });

  it("refuse (409) une annonce qui n'est pas masquée, sans trace", async () => {
    const token = await adminToken();
    const manager = await createManager();
    const annonce = await creerAnnonce(manager.id);

    const res = await request(app).post(`/api/admin/listings/${annonce.id}/restore`).set(authHeader(token));

    expect(res.status).toBe(409);
    expect(await testDb.select().from(adminAuditLogs)).toHaveLength(0);
  });

  it("renvoie 404 pour une annonce inconnue", async () => {
    const res = await request(app).post("/api/admin/listings/inconnue/restore").set(authHeader(await adminToken()));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/admin/listings/:id/featured", () => {
  it("retire la mise en avant, trace l'action, et reste sans effet ni trace si déjà dans cet état", async () => {
    const token = await adminToken();
    const manager = await createManager();
    const annonce = await creerAnnonce(manager.id, { featured: true });
    const retirer = () =>
      request(app).post(`/api/admin/listings/${annonce.id}/featured`).set(authHeader(token)).send({ featured: false });

    expect((await retirer()).status).toBe(200);
    expect((await retirer()).status).toBe(200);

    const [apres] = await testDb.select().from(listings).where(eq(listings.id, annonce.id));
    expect(apres.featured).toBe(false);
    const audit = await testDb.select().from(adminAuditLogs);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "listing.unfeature", targetUserId: manager.id });
  });

  it("met une annonce en avant", async () => {
    const token = await adminToken();
    const manager = await createManager();
    const annonce = await creerAnnonce(manager.id);

    const res = await request(app).post(`/api/admin/listings/${annonce.id}/featured`).set(authHeader(token)).send({ featured: true });

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(listings).where(eq(listings.id, annonce.id));
    expect(apres.featured).toBe(true);
    expect((await testDb.select().from(adminAuditLogs))[0].action).toBe("listing.feature");
  });

  it("rejette une valeur qui n'est pas un booléen, et une annonce inconnue", async () => {
    const token = await adminToken();
    const manager = await createManager();
    const annonce = await creerAnnonce(manager.id);

    const invalide = await request(app).post(`/api/admin/listings/${annonce.id}/featured`).set(authHeader(token)).send({ featured: "oui" });
    expect(invalide.status).toBe(400);
    const inconnue = await request(app).post("/api/admin/listings/inconnue/featured").set(authHeader(token)).send({ featured: true });
    expect(inconnue.status).toBe(404);
  });
});

describe("GET /api/admin/listings", () => {
  it("liste les annonces de tous les gestionnaires, avec leur gestionnaire, sans coordonnées de contact", async () => {
    const token = await adminToken();
    const m1 = await createManager();
    const m2 = await createManager();
    await creerAnnonce(m1.id, { title: "Annonce A" });
    await creerAnnonce(m2.id, { title: "Annonce B" });

    const res = await request(app).get("/api/admin/listings").set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const emails = res.body.items.map((i: { managerEmail: string }) => i.managerEmail).sort();
    expect(emails).toEqual([m1.email, m2.email].sort());
    for (const item of res.body.items) {
      expect(item).not.toHaveProperty("contactPhone");
      expect(item).not.toHaveProperty("contactEmail");
      expect(item).not.toHaveProperty("contactWhatsapp");
      expect(item).not.toHaveProperty("description");
    }
  });

  it("filtre par visibilité réelle, par statut et par recherche", async () => {
    const token = await adminToken();
    const manager = await createManager();
    const agence = await createManager();
    await testDb.insert(agencySettings).values({ userId: agence.id, agencyName: "Baobab Immo" });
    const visible = await creerAnnonce(manager.id, { title: "Visible", location: "Saly" });
    const masquee = await creerAnnonce(manager.id, { title: "Masquée", location: "Thiès" });
    await creerAnnonce(manager.id, { title: "Brouillon", status: "DRAFT" });
    await creerAnnonce(agence.id, { title: "Chez Baobab" });
    await masquer(masquee.id, token);

    const titres = async (query: string) =>
      (await request(app).get(`/api/admin/listings${query}`).set(authHeader(token))).body.items
        .map((i: { title: string }) => i.title)
        .sort();

    expect(await titres("?visibility=HIDDEN")).toEqual(["Masquée"]);
    // « Visible » = publiée ET non masquée : ni le brouillon, ni la masquée.
    expect(await titres("?visibility=VISIBLE")).toEqual(["Chez Baobab", "Visible"]);
    expect(await titres("?status=DRAFT")).toEqual(["Brouillon"]);
    expect(await titres("?search=thi%C3%A8s")).toEqual(["Masquée"]);
    expect(await titres(`?search=${encodeURIComponent(manager.email)}`)).toEqual(["Brouillon", "Masquée", "Visible"]);
    expect(await titres("?search=baobab")).toEqual(["Chez Baobab"]);
    expect(visible.id).toBeTruthy();
  });

  it("lit % et _ littéralement dans la recherche", async () => {
    const token = await adminToken();
    const manager = await createManager();
    await creerAnnonce(manager.id, { title: "Remise 100% garantie" });
    await creerAnnonce(manager.id, { title: "Autre annonce" });

    const res = await request(app).get("/api/admin/listings?search=%25").set(authHeader(token));

    expect(res.body.items.map((i: { title: string }) => i.title)).toEqual(["Remise 100% garantie"]);
  });

  it("le compteur de masquées ignore les filtres, et la liste se pagine", async () => {
    const token = await adminToken();
    const manager = await createManager();
    const a = await creerAnnonce(manager.id, { title: "A" });
    await creerAnnonce(manager.id, { title: "B" });
    await creerAnnonce(manager.id, { title: "C" });
    await masquer(a.id, token);

    const res = await request(app).get("/api/admin/listings?status=DRAFT&pageSize=2").set(authHeader(token));
    expect(res.body.total).toBe(0);
    expect(res.body.counts.hidden).toBe(1);

    const page = await request(app).get("/api/admin/listings?pageSize=2&page=2").set(authHeader(token));
    expect(page.body.items).toHaveLength(1);
    expect(page.body.total).toBe(3);
  });

  it("rejette un filtre invalide", async () => {
    const res = await request(app).get("/api/admin/listings?visibility=AUTRE").set(authHeader(await adminToken()));
    expect(res.status).toBe(400);
  });
});
