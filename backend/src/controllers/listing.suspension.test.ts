import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { listingLeads, listings } from "../db/schema";
import { authHeader, createAdmin, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

vi.mock("../services/storage.service", () => ({
  uploadPublicFile: vi.fn().mockResolvedValue("http://test.local/mock-image.png"),
  deleteStorageObjectBestEffort: vi.fn().mockResolvedValue(undefined),
}));

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
      ...overrides,
    })
    .returning();
  return annonce;
}

const suspendu = () => createManager({ suspendedAt: new Date(), suspensionReason: "Impayé" });

const titresPublics = async () =>
  (await request(app).get("/api/listings/public")).body.items.map((l: { title: string }) => l.title).sort();

describe("les annonces d'un gestionnaire suspendu quittent la vitrine publique", () => {
  it("disparaissent de la liste, du total et des pays, sans toucher aux annonces des autres", async () => {
    const compteSuspendu = await suspendu();
    const compteActif = await createManager();
    await creerAnnonce(compteSuspendu.id, { title: "Suspendu", country: "SN" });
    await creerAnnonce(compteActif.id, { title: "Actif", country: "FR" });

    const liste = await request(app).get("/api/listings/public");
    const pays = await request(app).get("/api/listings/public/countries");

    expect(liste.body.items.map((l: { title: string }) => l.title)).toEqual(["Actif"]);
    expect(liste.body.total).toBe(1);
    expect(pays.body.countries).toEqual(["FR"]);
  });

  it("répondent 404 en fiche et n'acceptent plus de demande de contact", async () => {
    const compteSuspendu = await suspendu();
    const annonce = await creerAnnonce(compteSuspendu.id);

    expect((await request(app).get(`/api/listings/public/${annonce.id}`)).status).toBe(404);
    const demande = await request(app)
      .post(`/api/listings/public/${annonce.id}/leads`)
      .send({ prospectName: "Awa Sow", prospectEmail: "awa@test.local", prospectPhone: "+221771234567" });

    expect(demande.status).toBe(404);
    expect(await testDb.select().from(listingLeads)).toHaveLength(0);
  });

  it("ne modifient pas les annonces : rien n'est écrit à la suspension", async () => {
    const admin = await createAdmin();
    const manager = await createManager();
    const annonce = await creerAnnonce(manager.id);

    const res = await request(app)
      .post(`/api/admin/managers/${manager.id}/suspend`)
      .set(authHeader(tokenFor(admin)))
      .send({ reason: "Facture impayée" });

    expect(res.status).toBe(200);
    expect(await titresPublics()).toEqual([]);
    const [apres] = await testDb.select().from(listings).where(eq(listings.id, annonce.id));
    expect(apres).toMatchObject({ status: "PUBLISHED", hiddenByAdminAt: null, moderationReason: null });
  });

  it("reviennent à la levée de la suspension, sans rétablir ce que le gestionnaire ou l'administration avaient écarté", async () => {
    const admin = await createAdmin();
    const manager = await createManager();
    await creerAnnonce(manager.id, { title: "Publiée" });
    await creerAnnonce(manager.id, { title: "Brouillon", status: "DRAFT" });
    await creerAnnonce(manager.id, { title: "Modérée", hiddenByAdminAt: new Date(), moderationReason: "Prix trompeur" });
    const entetes = authHeader(tokenFor(admin));

    await request(app).post(`/api/admin/managers/${manager.id}/suspend`).set(entetes).send({ reason: "Facture impayée" });
    expect(await titresPublics()).toEqual([]);

    await request(app).post(`/api/admin/managers/${manager.id}/reactivate`).set(entetes);
    expect(await titresPublics()).toEqual(["Publiée"]);
  });
});

describe("GET /api/admin/listings — gestionnaire suspendu", () => {
  it("exclut ses annonces de la visibilité réelle, les signale, et les garde dans la liste complète", async () => {
    const token = tokenFor(await createAdmin());
    const compteSuspendu = await suspendu();
    const compteActif = await createManager();
    await creerAnnonce(compteSuspendu.id, { title: "Suspendu" });
    await creerAnnonce(compteActif.id, { title: "Actif" });

    const visibles = await request(app).get("/api/admin/listings?visibility=VISIBLE").set(authHeader(token));
    const toutes = await request(app).get("/api/admin/listings").set(authHeader(token));

    expect(visibles.body.items.map((i: { title: string }) => i.title)).toEqual(["Actif"]);
    const ligneSuspendue = toutes.body.items.find((i: { title: string }) => i.title === "Suspendu");
    const ligneActive = toutes.body.items.find((i: { title: string }) => i.title === "Actif");
    expect(ligneSuspendue.managerSuspendedAt).not.toBeNull();
    expect(ligneActive.managerSuspendedAt).toBeNull();
    // Le compteur « masquées » ne parle que de la modération : une suspension n'y entre pas.
    expect(toutes.body.counts.hidden).toBe(0);
  });
});
