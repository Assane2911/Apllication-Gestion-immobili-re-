import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { listings } from "../db/schema";
import { createManager } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

vi.mock("../services/storage.service", () => ({
  uploadPublicFile: vi.fn().mockResolvedValue("http://test.local/mock-image.png"),
  deleteStorageObjectBestEffort: vi.fn().mockResolvedValue(undefined),
}));

/**
 * La vitrine pagine ses annonces par BOUTONS (12 par page) : au-delà de la première page, une annonce n'est atteignable par un robot
 * que par le plan du site. Celui du build n'est refait qu'à chaque déploiement du site, donc une annonce publiée entre deux
 * déploiements n'y figurait pas. Ce plan-ci est servi à la demande, avec la même règle de visibilité que la vitrine.
 */
async function creerAnnonce(managerId: string, overrides: Partial<typeof listings.$inferInsert> = {}) {
  const [annonce] = await testDb
    .insert(listings)
    .values({ managerId, title: "Villa Ngor", description: "Belle villa avec piscine", price: 250000, location: "Ngor, Dakar", country: "SN", ...overrides })
    .returning();
  return annonce;
}

describe("GET /api/listings/public/sitemap.xml", () => {
  it("répond en XML, sans authentification, et n'est pas pris pour l'identifiant d'une annonce", async () => {
    const res = await request(app).get("/api/listings/public/sitemap.xml");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/xml/);
    expect(res.text).toContain("<urlset");
  });

  it("liste les annonces visibles sur la vitrine, à l'adresse du site", async () => {
    const manager = await createManager();
    const a = await creerAnnonce(manager.id);
    const b = await creerAnnonce(manager.id, { title: "Studio Plateau" });

    const res = await request(app).get("/api/listings/public/sitemap.xml");

    expect(res.text).toContain(`<loc>https://www.immoplatformpro.com/vitrine/annonces/${a.id}</loc>`);
    expect(res.text).toContain(`<loc>https://www.immoplatformpro.com/vitrine/annonces/${b.id}</loc>`);
    expect(res.text).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}T/);
  });

  it("écarte un brouillon, une annonce modérée et celle d'un gestionnaire suspendu (comme la vitrine)", async () => {
    const actif = await createManager();
    const suspendu = await createManager({ suspendedAt: new Date(), suspensionReason: "Impayé" });
    const visible = await creerAnnonce(actif.id);
    const brouillon = await creerAnnonce(actif.id, { status: "DRAFT" });
    const moderee = await creerAnnonce(actif.id, { hiddenByAdminAt: new Date(), moderationReason: "Prix trompeur" });
    const duSuspendu = await creerAnnonce(suspendu.id);

    const { text } = await request(app).get("/api/listings/public/sitemap.xml");

    expect(text).toContain(visible.id);
    expect(text).not.toContain(brouillon.id);
    expect(text).not.toContain(moderee.id);
    expect(text).not.toContain(duSuspendu.id);
  });

  it("se met en cache côté réseau (une heure) sans servir du périmé plus d'un jour", async () => {
    const res = await request(app).get("/api/listings/public/sitemap.xml");
    expect(res.headers["cache-control"]).toMatch(/s-maxage=3600/);
    expect(res.headers["cache-control"]).toMatch(/stale-while-revalidate=86400/);
  });
});
