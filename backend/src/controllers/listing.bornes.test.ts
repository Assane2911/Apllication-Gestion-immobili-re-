import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { listings } from "../db/schema";
import { authHeader, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

vi.mock("../services/storage.service", () => ({
  uploadPublicFile: vi.fn().mockResolvedValue("http://test.local/mock-image.png"),
  deleteStorageObjectBestEffort: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Une annonce est lue par des visiteurs sans compte : un prix infini, un titre de plusieurs mégaoctets
 * ou un nombre de pièces absurde ne doivent jamais y arriver.
 */
const base = { title: "Appartement Plateau", description: "3 pièces refait à neuf", price: 800, location: "Plateau, Dakar", country: "SN", type: "RENT" };

describe("POST /api/listings — bornes de saisie", () => {
  it.each([
    ["prix infini", { price: "1e999" }],
    ["prix au-delà du plafond", { price: 2e12 }],
    ["surface infinie", { surface: "1e999" }],
    ["surface au-delà du plafond", { surface: 10_000_000 }],
    ["nombre de pièces démesuré", { rooms: 100_000 }],
    ["titre démesuré", { title: "T".repeat(201) }],
    ["description démesurée", { description: "D".repeat(5001) }],
    ["localisation démesurée", { location: "L".repeat(201) }],
    ["téléphone démesuré", { contactPhone: "1".repeat(41) }],
    ["email de contact démesuré", { contactEmail: `${"a".repeat(250)}@example.com` }],
  ])("refuse %s", async (_nom, surcharge) => {
    const manager = await createManager();
    const res = await request(app).post("/api/listings").set(authHeader(tokenFor(manager))).send({ ...base, ...surcharge });
    expect(res.status).toBe(400);
  });

  it("accepte une annonce ordinaire", async () => {
    const manager = await createManager();
    const res = await request(app)
      .post("/api/listings")
      .set(authHeader(tokenFor(manager)))
      .send({ ...base, surface: 64, rooms: 3, contactPhone: "+221 77 123 45 67", contactEmail: "agence@example.com" });
    expect(res.status).toBe(201);
  });

  it("applique les mêmes bornes à la modification", async () => {
    const manager = await createManager();
    const cree = await request(app).post("/api/listings").set(authHeader(tokenFor(manager))).send(base);
    const res = await request(app)
      .put(`/api/listings/${cree.body.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ price: "1e999" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/listings/public/:id/leads — téléphone borné", () => {
  it("refuse un numéro de téléphone démesuré", async () => {
    const manager = await createManager();
    const [annonce] = await testDb
      .insert(listings)
      .values({ managerId: manager.id, title: "Villa Ngor", description: "Belle villa", price: 250000, location: "Ngor, Dakar", country: "SN", status: "PUBLISHED" })
      .returning();

    const res = await request(app)
      .post(`/api/listings/public/${annonce.id}/leads`)
      .send({ prospectName: "Awa Sow", prospectEmail: "awa@example.com", prospectPhone: "7".repeat(500) });

    expect(res.status).toBe(400);
  });
});

