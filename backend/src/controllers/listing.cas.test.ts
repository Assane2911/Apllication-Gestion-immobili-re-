import { and, eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { activityLogs, listingLeads, listings } from "../db/schema";
import { deleteStorageObjectBestEffort, uploadPublicFile } from "../services/storage.service";
import { authHeader, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { MONTANT_MAXIMUM, SURFACE_MAXIMUM } from "../utils/montant";

vi.mock("../services/storage.service", () => ({
  uploadPublicFile: vi.fn().mockResolvedValue("http://test.local/mock-image.png"),
  deleteStorageObjectBestEffort: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Cas limites des annonces et des demandes : bornes de chaque champ à l'unité près, valeurs de chaque énumération, champs internes
 * jamais exposés, pagination, ordre, effet d'une modification ou d'une suppression sur les AUTRES lignes, fichiers, journal d'activité.
 */
beforeEach(() => {
  vi.mocked(uploadPublicFile).mockClear();
  vi.mocked(deleteStorageObjectBestEffort).mockClear();
  vi.mocked(deleteStorageObjectBestEffort).mockResolvedValue(undefined);
});

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

async function annonce(managerId: string, overrides: Partial<typeof listings.$inferInsert> = {}) {
  const [ligne] = await testDb
    .insert(listings)
    .values({ managerId, title: "Villa Ngor", description: "Belle villa avec piscine", price: 250000, location: "Ngor, Dakar", country: "SN", ...overrides })
    .returning();
  return ligne;
}
async function demande(listingId: string, managerId: string, overrides: Partial<typeof listingLeads.$inferInsert> = {}) {
  const [ligne] = await testDb
    .insert(listingLeads)
    .values({ listingId, managerId, prospectName: "Awa Sow", prospectEmail: "awa@test.local", prospectPhone: "+221771234567", ...overrides })
    .returning();
  return ligne;
}
const trace = async (action: string) => (await testDb.select().from(activityLogs).where(eq(activityLogs.action, action)))[0];

const corpsAnnonce = (extra: Record<string, unknown> = {}) => ({ title: "Villa Ngor", description: "Belle villa", price: 100, location: "Ngor, Dakar", ...extra });
const creer = (h: Record<string, string>, corps: Record<string, unknown>) => request(app).post("/api/listings").set(h).send(corps);
const corpsDemande = (extra: Record<string, unknown> = {}) => ({ prospectName: "Awa Sow", prospectEmail: "awa@test.local", prospectPhone: "+221771234567", ...extra });
const envoyerDemande = (listingId: string, corps: Record<string, unknown>) => request(app).post(`/api/listings/public/${listingId}/leads`).send(corps);
const lettres = (n: number, c = "a") => c.repeat(n);
const courriel = (longueur: number) => `${lettres(64)}@${lettres(63, "b")}.${lettres(63, "c")}.${lettres(longueur - 64 - 1 - 63 - 1 - 63 - 1 - 3, "d")}.fr`;

describe("énumérations et booléens d'une annonce", () => {
  it.each(["RENT", "SALE", "PROMOTION", "LAND", "OTHER"])("accepte le type %s", async (type) => {
    const h = authHeader(tokenFor(await createManager()));
    const res = await creer(h, corpsAnnonce({ type }));
    expect(res.status).toBe(201);
    expect(res.body.type).toBe(type);
  });

  it.each(["PUBLISHED", "DRAFT", "ARCHIVED"])("accepte le statut %s", async (status) => {
    const h = authHeader(tokenFor(await createManager()));
    const res = await creer(h, corpsAnnonce({ status }));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe(status);
  });

  it.each(["MONTH", "ONE_TIME"])("accepte la période de prix %s", async (pricePeriod) => {
    const h = authHeader(tokenFor(await createManager()));
    const res = await creer(h, corpsAnnonce({ pricePeriod }));
    expect(res.status).toBe(201);
    expect(res.body.pricePeriod).toBe(pricePeriod);
  });

  it.each([["type", "MAISON"], ["status", "ACTIVE"], ["pricePeriod", "YEAR"], ["currency", "XYZ"], ["country", "ZZ"]])("refuse %s = %s", async (champ, valeur) => {
    const h = authHeader(tokenFor(await createManager()));
    expect((await creer(h, corpsAnnonce({ [champ]: valeur }))).status).toBe(400);
  });

  it.each([
    [true, true],
    ["true", true],
    [false, false],
    ["false", false],
    ["oui", false],
  ])("la mise en avant %j est enregistrée comme %j", async (valeur, attendu) => {
    const h = authHeader(tokenFor(await createManager()));
    const res = await creer(h, corpsAnnonce({ featured: valeur }));
    expect(res.status).toBe(201);
    expect(res.body.featured).toBe(attendu);
  });

  it("la devise demandée est conservée, « EUR » seulement à défaut", async () => {
    const h = authHeader(tokenFor(await createManager()));
    expect((await creer(h, corpsAnnonce({ currency: "XOF" }))).body.currency).toBe("XOF");
    expect((await creer(h, corpsAnnonce())).body.currency).toBe("EUR");
  });
});

describe("bornes des champs d'une annonce", () => {
  const cas: Array<[string, Record<string, unknown>, number]> = [
    ["titre : 2 caractères", { title: "AB" }, 201],
    ["titre : 1 caractère", { title: "A" }, 400],
    ["titre : espaces autour d'une seule lettre", { title: "  A  " }, 400],
    ["titre : 200 caractères", { title: lettres(200) }, 201],
    ["titre : 201 caractères", { title: lettres(201) }, 400],
    ["description : 2 caractères", { description: "AB" }, 201],
    ["description : 1 caractère", { description: "A" }, 400],
    ["description : espaces autour d'une seule lettre", { description: "  A  " }, 400],
    ["description : 5 000 caractères", { description: lettres(5000) }, 201],
    ["description : 5 001 caractères", { description: lettres(5001) }, 400],
    ["localisation : 2 caractères", { location: "AB" }, 201],
    ["localisation : 1 caractère", { location: "A" }, 400],
    ["localisation : espaces autour d'une seule lettre", { location: "  A  " }, 400],
    ["localisation : 200 caractères", { location: lettres(200) }, 201],
    ["localisation : 201 caractères", { location: lettres(201) }, 400],
    ["prix décimal", { price: 12.5 }, 201],
    ["prix nul", { price: 0 }, 400],
    ["prix négatif", { price: -1 }, 400],
    ["prix infini (1e999)", { price: "1e999" }, 400],
    ["prix au plafond", { price: MONTANT_MAXIMUM }, 201],
    ["prix au-dessus du plafond", { price: MONTANT_MAXIMUM + 1 }, 400],
    ["surface décimale", { surface: 45.5 }, 201],
    ["surface nulle", { surface: 0 }, 400],
    ["surface infinie (1e999)", { surface: "1e999" }, 400],
    ["surface au plafond", { surface: SURFACE_MAXIMUM }, 201],
    ["surface au-dessus du plafond", { surface: SURFACE_MAXIMUM + 1 }, 400],
    ["pièces : 1000", { rooms: 1000 }, 201],
    ["pièces : 1001", { rooms: 1001 }, 400],
    ["pièces décimales", { rooms: 2.5 }, 400],
    ["pièces nulles", { rooms: 0 }, 400],
    ["téléphone : 40 caractères", { contactPhone: lettres(40, "1") }, 201],
    ["téléphone : 41 caractères", { contactPhone: lettres(41, "1") }, 400],
    ["WhatsApp : 40 caractères", { contactWhatsapp: lettres(40, "1") }, 201],
    ["WhatsApp : 41 caractères", { contactWhatsapp: lettres(41, "1") }, 400],
    ["e-mail : 254 caractères", { contactEmail: courriel(254) }, 201],
    ["e-mail : 255 caractères", { contactEmail: courriel(255) }, 400],
    ["e-mail : pas une adresse", { contactEmail: "pas-une-adresse" }, 400],
  ];

  it.each(cas)("%s", async (_nom, extra, statut) => {
    const h = authHeader(tokenFor(await createManager()));
    expect((await creer(h, corpsAnnonce(extra))).status).toBe(statut);
  });

  it("le titre, la description et la localisation sont enregistrés sans les espaces autour", async () => {
    const h = authHeader(tokenFor(await createManager()));

    const res = await creer(h, corpsAnnonce({ title: "  Villa Ngor  ", description: "  Belle villa  ", location: "  Ngor  " }));

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: "Villa Ngor", description: "Belle villa", location: "Ngor" });
  });
});

describe("vitrine publique", () => {
  it("n'expose aucun champ interne, ni dans la liste ni dans la fiche", async () => {
    const manager = await createManager();
    const a = await annonce(manager.id, { moderationReason: "Texte à reprendre" });

    const liste = await request(app).get("/api/listings/public");
    const fiche = await request(app).get(`/api/listings/public/${a.id}`);

    for (const corps of [liste.body.items[0], fiche.body]) {
      expect(corps).not.toHaveProperty("managerId");
      expect(corps).not.toHaveProperty("hiddenByAdminAt");
      expect(corps).not.toHaveProperty("moderationReason");
      expect(corps.title).toBe("Villa Ngor");
    }
  });

  it("la fiche est celle de l'annonce demandée, et un identifiant inconnu répond 404 LISTING_NOT_FOUND", async () => {
    const manager = await createManager();
    await annonce(manager.id, { title: "Première" });
    const seconde = await annonce(manager.id, { title: "Seconde" });

    const fiche = await request(app).get(`/api/listings/public/${seconde.id}`);
    const inconnue = await request(app).get("/api/listings/public/inconnue");

    expect(fiche.body.title).toBe("Seconde");
    expect(inconnue.status).toBe(404);
    expect(inconnue.body.code).toBe("LISTING_NOT_FOUND");
  });

  it("les annonces mises en avant passent d'abord, puis les plus récentes", async () => {
    const manager = await createManager();
    await annonce(manager.id, { title: "A ancienne", createdAt: new Date(2026, 0, 1) });
    await annonce(manager.id, { title: "B en avant, ancienne", featured: true, createdAt: new Date(2026, 0, 2) });
    await annonce(manager.id, { title: "C récente", createdAt: new Date(2026, 5, 1) });
    await annonce(manager.id, { title: "D en avant, récente", featured: true, createdAt: new Date(2026, 3, 1) });

    const res = await request(app).get("/api/listings/public");

    expect(res.body.items.map((i: { title: string }) => i.title)).toEqual(["D en avant, récente", "B en avant, ancienne", "C récente", "A ancienne"]);
  });

  it("pagine : taille de page, numéro de page, total et nombre de pages", async () => {
    const manager = await createManager();
    for (let i = 1; i <= 5; i++) await annonce(manager.id, { title: `Annonce ${i}`, createdAt: new Date(2026, 0, i) });

    const page2 = await request(app).get("/api/listings/public?pageSize=2&page=2");

    expect(page2.body).toMatchObject({ page: 2, pageSize: 2, total: 5, totalPages: 3 });
    expect(page2.body.items.map((i: { title: string }) => i.title)).toEqual(["Annonce 3", "Annonce 2"]);
  });

  it("les filtres refusent un code pays de plus de deux lettres et un type inconnu", async () => {
    expect((await request(app).get("/api/listings/public?country=SEN")).status).toBe(400);
    expect((await request(app).get("/api/listings/public?type=MAISON")).status).toBe(400);
    expect((await request(app).get("/api/listings/public?country=sn&type=RENT")).status).toBe(200);
  });

  it("la liste des pays est triée, sans doublon, et ignore les annonces sans pays", async () => {
    const manager = await createManager();
    await annonce(manager.id, { country: "SN" });
    await annonce(manager.id, { country: "SN" });
    await annonce(manager.id, { country: "FR" });
    await annonce(manager.id, { country: "CI" });
    await annonce(manager.id, { country: null });

    const res = await request(app).get("/api/listings/public/countries");

    expect(res.body).toEqual({ countries: ["CI", "FR", "SN"] });
  });

  it("le plan du site : XML, mis en cache une heure par le réseau, jamais en privé", async () => {
    const manager = await createManager();
    const a = await annonce(manager.id);

    const res = await request(app).get("/api/listings/public/sitemap.xml");

    expect(res.headers["content-type"]).toContain("application/xml");
    expect(res.headers["cache-control"]).toBe("public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
    expect(res.text).toContain(`/vitrine/annonces/${a.id}`);
  });
});

describe("demande envoyée depuis la vitrine", () => {
  it("est rattachée à l'annonce visée (pas à une autre) et à son gestionnaire, et enregistre chaque champ", async () => {
    const m1 = await createManager();
    const m2 = await createManager();
    await annonce(m1.id, { title: "Première" });
    const cible = await annonce(m2.id, { title: "Cible" });

    const res = await envoyerDemande(cible.id, {
      prospectName: "  Awa Sow  ",
      prospectEmail: "awa@exemple.test",
      prospectPhone: "+221 77 123 45 67",
      requestType: "INFO",
      preferredDate: "2026-12-01",
      message: "  Disponible ce week-end ?  ",
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ message: "Demande envoyée avec succès" });
    const [lead] = await testDb.select().from(listingLeads);
    expect(lead).toMatchObject({
      listingId: cible.id,
      managerId: m2.id,
      prospectName: "Awa Sow",
      prospectEmail: "awa@exemple.test",
      prospectPhone: "+221 77 123 45 67",
      requestType: "INFO",
      message: "Disponible ce week-end ?",
    });
    expect(lead.preferredDate?.toISOString().slice(0, 10)).toBe("2026-12-01");
  });

  it("un message d'espaces n'est pas enregistré, le type par défaut est une visite", async () => {
    const manager = await createManager();
    const a = await annonce(manager.id);

    await envoyerDemande(a.id, corpsDemande({ message: "     " })).expect(201);

    const [lead] = await testDb.select().from(listingLeads);
    expect(lead.message).toBeNull();
    expect(lead.requestType).toBe("VISIT");
  });

  it("une annonce inconnue répond 404 LISTING_NOT_FOUND", async () => {
    const res = await envoyerDemande("inconnue", corpsDemande());

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("LISTING_NOT_FOUND");
  });

  it("laisse une trace chez le gestionnaire de l'annonce : type de demande, nom, annonce", async () => {
    const manager = await createManager();
    const a = await annonce(manager.id, { title: "Villa Ngor" });

    await envoyerDemande(a.id, corpsDemande()).expect(201);
    await envoyerDemande(a.id, corpsDemande({ prospectName: "Ibou Fall", requestType: "INFO" })).expect(201);

    const traces = await testDb.select().from(activityLogs).where(eq(activityLogs.action, "listing_lead.create"));
    const [visite, info] = [traces.find((t: { entityLabel: string | null }) => t.entityLabel === "Awa Sow"), traces.find((t: { entityLabel: string | null }) => t.entityLabel === "Ibou Fall")];
    const leads = await testDb.select().from(listingLeads);
    expect(visite).toMatchObject({ managerId: manager.id, entityType: "listing_lead", details: "Nouvelle demande (VISIT) reçue via la vitrine pour l'annonce « Villa Ngor »" });
    expect(visite.entityId).toBe(leads.find((l: { prospectName: string }) => l.prospectName === "Awa Sow")!.id);
    expect(info.details).toBe("Nouvelle demande (INFO) reçue via la vitrine pour l'annonce « Villa Ngor »");
  });

  const cas: Array<[string, Record<string, unknown>, number]> = [
    ["nom : 2 caractères", { prospectName: "AB" }, 201],
    ["nom : 1 caractère", { prospectName: "A" }, 400],
    ["nom : espaces autour d'une seule lettre", { prospectName: "  A  " }, 400],
    ["nom : 120 caractères", { prospectName: lettres(120) }, 201],
    ["nom : 121 caractères", { prospectName: lettres(121) }, 400],
    ["e-mail : 254 caractères", { prospectEmail: courriel(254) }, 201],
    ["e-mail : 255 caractères", { prospectEmail: courriel(255) }, 400],
    ["e-mail : pas une adresse", { prospectEmail: "pas-une-adresse" }, 400],
    ["téléphone : 40 caractères", { prospectPhone: `+${lettres(39, "1")}` }, 201],
    ["téléphone : 41 caractères", { prospectPhone: `+${lettres(40, "1")}` }, 400],
    ["téléphone : 6 caractères", { prospectPhone: "123456" }, 201],
    ["téléphone : 5 caractères", { prospectPhone: "12345" }, 400],
    ["téléphone avec lettres au début", { prospectPhone: "abc 123456" }, 400],
    ["téléphone avec lettres à la fin", { prospectPhone: "123456 abc" }, 400],
    ["téléphone avec séparateurs usuels", { prospectPhone: "221 (77) 123-45.67" }, 201],
    ["type de demande : information", { requestType: "INFO" }, 201],
    ["type de demande : inconnu", { requestType: "RAPPEL" }, 400],
    ["date souhaitée valide", { preferredDate: "2026-12-01" }, 201],
    ["date souhaitée hors des années acceptées", { preferredDate: "1800-01-01" }, 400],
    ["message : 2 000 caractères", { message: lettres(2000) }, 201],
    ["message : 2 001 caractères", { message: lettres(2001) }, 400],
  ];

  it.each(cas)("%s", async (_nom, extra, statut) => {
    const manager = await createManager();
    const a = await annonce(manager.id);

    expect((await envoyerDemande(a.id, corpsDemande(extra))).status).toBe(statut);
  });
});

describe("CRM du gestionnaire : annonces", () => {
  it("le gestionnaire ne voit ni ne compte les annonces des autres, la page et la taille de page sont respectées, les plus récentes d'abord", async () => {
    const manager = await createManager();
    const autre = await createManager();
    for (let i = 1; i <= 5; i++) await annonce(manager.id, { title: `Annonce ${i}`, createdAt: new Date(2026, 0, i) });
    await annonce(autre.id, { title: "Chez l'autre" });
    const h = authHeader(tokenFor(manager));

    const res = await request(app).get("/api/listings?pageSize=2&page=2").set(h);

    expect(res.body).toMatchObject({ page: 2, pageSize: 2, total: 5, totalPages: 3 });
    expect(res.body.items.map((i: { title: string }) => i.title)).toEqual(["Annonce 3", "Annonce 2"]);
  });

  it("la fiche est celle de l'annonce demandée ; celle d'un autre ou inconnue répond 404 LISTING_NOT_FOUND", async () => {
    const manager = await createManager();
    const autre = await createManager();
    await annonce(manager.id, { title: "Première" });
    const seconde = await annonce(manager.id, { title: "Seconde" });
    const chezAutre = await annonce(autre.id);
    const h = authHeader(tokenFor(manager));

    expect((await request(app).get(`/api/listings/${seconde.id}`).set(h)).body.title).toBe("Seconde");
    for (const id of [chezAutre.id, "inconnue"]) {
      const res = await request(app).get(`/api/listings/${id}`).set(h);
      expect(res.status, id).toBe(404);
      expect(res.body.code, id).toBe("LISTING_NOT_FOUND");
    }
  });

  it("la création enregistre l'image dans le dossier des annonces, et laisse une trace", async () => {
    const manager = await createManager();
    const h = authHeader(tokenFor(manager));

    const res = await request(app).post("/api/listings").set(h).field("title", "Villa Ngor").field("description", "Belle villa").field("price", "100").field("location", "Ngor, Dakar").attach("image", PNG_1X1, { filename: "photo.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.imageUrl).toBe("http://test.local/mock-image.png");
    expect(uploadPublicFile).toHaveBeenCalledWith(expect.anything(), "listings");
    const t = await trace("listing.create");
    expect(t).toMatchObject({ managerId: manager.id, entityType: "listing", entityId: res.body.id, entityLabel: "Villa Ngor", details: "Annonce créée : Villa Ngor (Ngor, Dakar)" });
  });

  it("une image dont le contenu n'est pas celui qu'elle déclare est refusée, sans rien enregistrer ni téléverser", async () => {
    const h = authHeader(tokenFor(await createManager()));

    const res = await request(app).post("/api/listings").set(h).field("title", "Villa Ngor").field("description", "Belle villa").field("price", "100").field("location", "Ngor, Dakar").attach("image", Buffer.from("ceci n'est pas une image"), { filename: "photo.png", contentType: "image/png" });

    expect(res.status).toBe(400);
    expect(uploadPublicFile).not.toHaveBeenCalled();
    expect(await testDb.select().from(listings)).toHaveLength(0);
  });

  it("la modification ne touche que l'annonce désignée, et laisse une trace", async () => {
    const manager = await createManager();
    const cible = await annonce(manager.id, { title: "Cible", price: 100 });
    const voisine = await annonce(manager.id, { title: "Voisine", price: 100 });
    const h = authHeader(tokenFor(manager));

    const res = await request(app).put(`/api/listings/${cible.id}`).set(h).send({ price: 999 });

    expect(res.status).toBe(200);
    expect((await testDb.select().from(listings).where(eq(listings.id, voisine.id)))[0].price).toBe(100);
    expect(await trace("listing.update")).toMatchObject({ managerId: manager.id, entityType: "listing", entityId: cible.id, entityLabel: "Cible", details: "Annonce modifiée : Cible" });
  });

  it("une modification sans aucun champ ni image est refusée (400 NOTHING_TO_UPDATE)", async () => {
    const manager = await createManager();
    const a = await annonce(manager.id);
    const h = authHeader(tokenFor(manager));

    const res = await request(app).put(`/api/listings/${a.id}`).set(h).send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("NOTHING_TO_UPDATE");
  });

  it("une nouvelle image va dans le dossier des annonces ; sans ancienne image, rien n'est retiré du stockage ; une image fausse est refusée", async () => {
    const manager = await createManager();
    const a = await annonce(manager.id, { imageUrl: null });
    const h = authHeader(tokenFor(manager));

    const ok = await request(app).put(`/api/listings/${a.id}`).set(h).attach("image", PNG_1X1, { filename: "n.png", contentType: "image/png" });
    expect(ok.status).toBe(200);
    expect(uploadPublicFile).toHaveBeenCalledWith(expect.anything(), "listings");
    expect(deleteStorageObjectBestEffort).not.toHaveBeenCalled();

    vi.mocked(uploadPublicFile).mockClear();
    const faux = await request(app).put(`/api/listings/${a.id}`).set(h).attach("image", Buffer.from("pas une image"), { filename: "n.png", contentType: "image/png" });
    expect(faux.status).toBe(400);
    expect(uploadPublicFile).not.toHaveBeenCalled();
  });

  it("un stockage indisponible ne fait échouer ni le remplacement d'image ni la suppression", async () => {
    const manager = await createManager();
    const ancienne = "http://test.local/storage/v1/object/public/public-uploads/listings/ancienne.png";
    const a = await annonce(manager.id, { imageUrl: ancienne });
    const h = authHeader(tokenFor(manager));
    vi.mocked(deleteStorageObjectBestEffort).mockRejectedValue(new Error("stockage indisponible"));

    const remplacement = await request(app).put(`/api/listings/${a.id}`).set(h).attach("image", PNG_1X1, { filename: "n.png", contentType: "image/png" });
    const suppression = await request(app).delete(`/api/listings/${a.id}`).set(h);

    expect(remplacement.status).toBe(200);
    expect(suppression.status).toBe(204);
  });

  it("la suppression ne retire que l'annonce désignée et son image, et laisse une trace", async () => {
    const manager = await createManager();
    const image = "http://test.local/storage/v1/object/public/public-uploads/listings/a.png";
    const cible = await annonce(manager.id, { title: "Cible", imageUrl: image });
    const voisine = await annonce(manager.id, { title: "Voisine" });
    const h = authHeader(tokenFor(manager));

    const res = await request(app).delete(`/api/listings/${cible.id}`).set(h);

    expect(res.status).toBe(204);
    expect((await testDb.select().from(listings)).map((l: { id: string }) => l.id)).toEqual([voisine.id]);
    expect(deleteStorageObjectBestEffort).toHaveBeenCalledWith(image);
    expect(await trace("listing.delete")).toMatchObject({ managerId: manager.id, entityType: "listing", entityId: cible.id, entityLabel: "Cible", details: "Annonce supprimée : Cible" });
  });
});

describe("CRM du gestionnaire : demandes", () => {
  it("la liste ne compte que les demandes du gestionnaire, filtrées comme demandé, paginées, les plus récentes d'abord", async () => {
    const manager = await createManager();
    const autre = await createManager();
    const a = await annonce(manager.id);
    const chezAutre = await annonce(autre.id);
    for (let i = 1; i <= 4; i++) await demande(a.id, manager.id, { prospectName: `Demande ${i}`, createdAt: new Date(2026, 0, i) });
    await demande(a.id, manager.id, { prospectName: "Contactée", status: "CONTACTED", createdAt: new Date(2026, 0, 10) });
    await demande(chezAutre.id, autre.id, { prospectName: "Chez l'autre" });
    const h = authHeader(tokenFor(manager));

    const nouvelles = await request(app).get("/api/listings/leads?status=NEW&pageSize=2&page=2").set(h);
    const toutes = await request(app).get("/api/listings/leads").set(h);

    expect(nouvelles.body).toMatchObject({ page: 2, pageSize: 2, total: 4, totalPages: 2 });
    expect(nouvelles.body.items.map((i: { prospectName: string }) => i.prospectName)).toEqual(["Demande 2", "Demande 1"]);
    const premierePage = await request(app).get("/api/listings/leads?status=NEW&pageSize=2").set(h);
    expect(premierePage.body.items.map((i: { prospectName: string }) => i.prospectName)).toEqual(["Demande 4", "Demande 3"]);
    expect(toutes.body.total).toBe(5);
    expect(toutes.body.items[0]).toMatchObject({ prospectName: "Contactée", listingTitle: "Villa Ngor" });
  });

  it("refuse un statut de filtre inconnu", async () => {
    const h = authHeader(tokenFor(await createManager()));

    expect((await request(app).get("/api/listings/leads?status=PERDUE").set(h)).status).toBe(400);
  });

  it("la mise à jour ne touche que la demande désignée, accepte chaque statut, borne les notes, et laisse une trace", async () => {
    const manager = await createManager();
    const a = await annonce(manager.id);
    await demande(a.id, manager.id, { prospectName: "Première" });
    const cible = await demande(a.id, manager.id, { prospectName: "Cible" });
    const h = authHeader(tokenFor(manager));

    const res = await request(app).patch(`/api/listings/leads/${cible.id}`).set(h).send({ status: "CONTACTED", notes: "Rappelée" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: cible.id, status: "CONTACTED", notes: "Rappelée" });
    const lignes = await testDb.select().from(listingLeads);
    expect(lignes.find((l: { prospectName: string }) => l.prospectName === "Première")).toMatchObject({ status: "NEW", notes: null });
    expect(await trace("listing_lead.update")).toMatchObject({
      managerId: manager.id,
      entityType: "listing_lead",
      entityId: cible.id,
      entityLabel: "Cible",
      details: "Demande mise à jour : Cible → CONTACTED",
    });
    for (const status of ["VISITED", "CONVERTED", "ARCHIVED"]) {
      expect((await request(app).patch(`/api/listings/leads/${cible.id}`).set(h).send({ status })).status, status).toBe(200);
    }
    expect((await request(app).patch(`/api/listings/leads/${cible.id}`).set(h).send({ notes: lettres(2000) })).status).toBe(200);
    expect((await request(app).patch(`/api/listings/leads/${cible.id}`).set(h).send({ notes: lettres(2001) })).status).toBe(400);
    expect((await request(app).patch(`/api/listings/leads/${cible.id}`).set(h).send({ status: "PERDUE" })).status).toBe(400);
  });

  it("une mise à jour sans champ est refusée (400 NOTHING_TO_UPDATE)", async () => {
    const manager = await createManager();
    const a = await annonce(manager.id);
    const lead = await demande(a.id, manager.id);
    const h = authHeader(tokenFor(manager));

    const res = await request(app).patch(`/api/listings/leads/${lead.id}`).set(h).send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("NOTHING_TO_UPDATE");
  });

  it("une demande inconnue ou d'un autre gestionnaire répond 404 REQUEST_NOT_FOUND, à la mise à jour comme à la suppression", async () => {
    const manager = await createManager();
    const autre = await createManager();
    const chezAutre = await demande((await annonce(autre.id)).id, autre.id);
    const h = authHeader(tokenFor(manager));

    for (const id of ["inconnue", chezAutre.id]) {
      const maj = await request(app).patch(`/api/listings/leads/${id}`).set(h).send({ status: "CONTACTED" });
      const sup = await request(app).delete(`/api/listings/leads/${id}`).set(h);
      for (const res of [maj, sup]) {
        expect(res.status, id).toBe(404);
        expect(res.body.code, id).toBe("REQUEST_NOT_FOUND");
      }
    }
    expect((await testDb.select().from(listingLeads)).map((l: { id: string }) => l.id)).toEqual([chezAutre.id]);
  });

  it("la suppression ne retire que la demande désignée, et laisse une trace", async () => {
    const manager = await createManager();
    const a = await annonce(manager.id);
    const voisine = await demande(a.id, manager.id, { prospectName: "Voisine" });
    const cible = await demande(a.id, manager.id, { prospectName: "Cible" });
    const h = authHeader(tokenFor(manager));

    const res = await request(app).delete(`/api/listings/leads/${cible.id}`).set(h);

    expect(res.status).toBe(204);
    expect((await testDb.select().from(listingLeads)).map((l: { id: string }) => l.id)).toEqual([voisine.id]);
    expect(await trace("listing_lead.delete")).toMatchObject({
      managerId: manager.id,
      entityType: "listing_lead",
      entityId: cible.id,
      entityLabel: "Cible",
      details: "Demande supprimée : Cible",
    });
    void and;
  });
});
