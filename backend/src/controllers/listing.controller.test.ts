import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { listingLeads, listings } from "../db/schema";
import { uploadPublicFile } from "../services/storage.service";
import { authHeader, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

vi.mock("../services/storage.service", () => ({
  uploadPublicFile: vi.fn().mockResolvedValue("http://test.local/mock-image.png"),
  // Ajouté quand la suppression s'est mise à nettoyer le stockage : un mock
  // partiel doit exposer TOUS les exports que le contrôleur utilise, sinon
  // l'accès à l'export manquant lève une erreur au lieu d'être neutre.
  deleteStorageObjectBestEffort: vi.fn().mockResolvedValue(undefined),
}));

async function createListingRow(managerId: string, overrides: Partial<typeof listings.$inferInsert> = {}) {
  const [listing] = await testDb
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
  return listing;
}

async function createLeadRow(listingId: string, managerId: string, overrides: Partial<typeof listingLeads.$inferInsert> = {}) {
  const [lead] = await testDb
    .insert(listingLeads)
    .values({
      listingId,
      managerId,
      prospectName: "Awa Sow",
      prospectEmail: "awa@test.local",
      prospectPhone: "+221771234567",
      ...overrides,
    })
    .returning();
  return lead;
}

describe("GET /api/listings/public", () => {
  it("ne renvoie que les annonces publiées, jamais les brouillons ni les archives", async () => {
    const manager = await createManager();
    await createListingRow(manager.id, { title: "Publiée", status: "PUBLISHED" });
    await createListingRow(manager.id, { title: "Brouillon", status: "DRAFT" });
    await createListingRow(manager.id, { title: "Archivée", status: "ARCHIVED" });

    const res = await request(app).get("/api/listings/public");

    expect(res.status).toBe(200);
    expect(res.body.items.map((l: { title: string }) => l.title)).toEqual(["Publiée"]);
  });

  it("n'expose pas managerId dans la réponse publique", async () => {
    const manager = await createManager();
    await createListingRow(manager.id);

    const res = await request(app).get("/api/listings/public");

    expect(res.status).toBe(200);
    expect(res.body.items[0].managerId).toBeUndefined();
  });

  it("filtre par pays", async () => {
    const manager = await createManager();
    await createListingRow(manager.id, { title: "Au Sénégal", country: "SN" });
    await createListingRow(manager.id, { title: "En France", country: "FR" });

    const res = await request(app).get("/api/listings/public?country=FR");

    expect(res.status).toBe(200);
    expect(res.body.items.map((l: { title: string }) => l.title)).toEqual(["En France"]);
  });

  it("filtre par type d'annonce", async () => {
    const manager = await createManager();
    await createListingRow(manager.id, { title: "À louer", type: "RENT" });
    await createListingRow(manager.id, { title: "À vendre", type: "SALE" });

    const res = await request(app).get("/api/listings/public?type=SALE");

    expect(res.status).toBe(200);
    expect(res.body.items.map((l: { title: string }) => l.title)).toEqual(["À vendre"]);
  });

  it("fait remonter les annonces mises en avant (featured) en premier", async () => {
    const manager = await createManager();
    await createListingRow(manager.id, { title: "Normale", featured: false });
    await createListingRow(manager.id, { title: "En avant", featured: true });

    const res = await request(app).get("/api/listings/public");

    expect(res.status).toBe(200);
    expect(res.body.items[0].title).toBe("En avant");
  });
});

describe("GET /api/listings/public/countries", () => {
  it("renvoie uniquement les pays des annonces publiées, sans doublon, triés", async () => {
    const manager = await createManager();
    await createListingRow(manager.id, { country: "SN" });
    await createListingRow(manager.id, { country: "SN" });
    await createListingRow(manager.id, { country: "FR" });
    await createListingRow(manager.id, { country: "CI", status: "DRAFT" });

    const res = await request(app).get("/api/listings/public/countries");

    expect(res.status).toBe(200);
    expect(res.body.countries).toEqual(["FR", "SN"]);
  });
});

describe("GET /api/listings/public/:id", () => {
  it("renvoie une annonce publiée", async () => {
    const manager = await createManager();
    const listing = await createListingRow(manager.id);

    const res = await request(app).get(`/api/listings/public/${listing.id}`);

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Villa Ngor");
  });

  it("renvoie 404 pour une annonce en brouillon (sans révéler son existence)", async () => {
    const manager = await createManager();
    const listing = await createListingRow(manager.id, { status: "DRAFT" });

    const res = await request(app).get(`/api/listings/public/${listing.id}`);

    expect(res.status).toBe(404);
  });

  it("renvoie 404 pour une annonce inexistante", async () => {
    const res = await request(app).get("/api/listings/public/inexistant");

    expect(res.status).toBe(404);
  });
});

describe("POST /api/listings/public/:id/leads", () => {
  it("crée une demande rattachée au gestionnaire propriétaire de l'annonce, sans authentification", async () => {
    const manager = await createManager();
    const listing = await createListingRow(manager.id);

    const res = await request(app).post(`/api/listings/public/${listing.id}/leads`).send({
      prospectName: "Awa Sow",
      prospectEmail: "awa@test.local",
      prospectPhone: "+221771234567",
      requestType: "VISIT",
      message: "Disponible ce week-end ?",
    });

    expect(res.status).toBe(201);
    const [lead] = await testDb.select().from(listingLeads).where(eq(listingLeads.listingId, listing.id));
    expect(lead.managerId).toBe(manager.id);
    expect(lead.prospectName).toBe("Awa Sow");
    expect(lead.status).toBe("NEW");
  });

  it("refuse une demande sur une annonce inexistante ou non publiée", async () => {
    const manager = await createManager();
    const listing = await createListingRow(manager.id, { status: "DRAFT" });

    const res = await request(app).post(`/api/listings/public/${listing.id}/leads`).send({
      prospectName: "Awa Sow",
      prospectEmail: "awa@test.local",
      prospectPhone: "+221771234567",
    });

    expect(res.status).toBe(404);
    const leads = await testDb.select().from(listingLeads).where(eq(listingLeads.listingId, listing.id));
    expect(leads).toHaveLength(0);
  });

  it("rejette une demande incomplète (email invalide)", async () => {
    const manager = await createManager();
    const listing = await createListingRow(manager.id);

    const res = await request(app).post(`/api/listings/public/${listing.id}/leads`).send({
      prospectName: "Awa Sow",
      prospectEmail: "pas-un-email",
      prospectPhone: "+221771234567",
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/listings — CRM gestionnaire", () => {
  it("crée une annonce rattachée au gestionnaire connecté", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/listings")
      .set(authHeader(tokenFor(manager)))
      .send({
        title: "Appartement Plateau",
        description: "3 pièces refait à neuf",
        price: 800,
        location: "Plateau, Dakar",
        country: "SN",
        type: "RENT",
      });

    expect(res.status).toBe(201);
    expect(res.body.managerId).toBe(manager.id);
    expect(res.body.status).toBe("PUBLISHED");
    expect(res.body.currency).toBe("EUR");
  });

  it("rejette une annonce sans titre ni localisation", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/listings")
      .set(authHeader(tokenFor(manager)))
      .send({ description: "Sans titre", price: 800 });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/listings — isolation entre gestionnaires", () => {
  it("ne renvoie que les annonces du gestionnaire connecté", async () => {
    const manager = await createManager();
    await createListingRow(manager.id);
    await createListingRow((await createManager()).id);

    const res = await request(app).get("/api/listings").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});

describe("GET /api/listings/:id — ownership", () => {
  it("refuse l'accès à l'annonce d'un autre gestionnaire (404)", async () => {
    const listing = await createListingRow((await createManager()).id);
    const other = await createManager();

    const res = await request(app).get(`/api/listings/${listing.id}`).set(authHeader(tokenFor(other)));

    expect(res.status).toBe(404);
  });
});

describe("PUT /api/listings/:id — ordre upload / vérification de propriété", () => {
  it("n'uploade jamais l'image quand l'annonce n'appartient pas au gestionnaire connecté", async () => {
    const manager = await createManager();
    const listing = await createListingRow(manager.id);
    const intrus = await createManager();

    const res = await request(app)
      .put(`/api/listings/${listing.id}`)
      .set(authHeader(tokenFor(intrus)))
      .attach("image", Buffer.from("contenu-image-factice"), "photo.png");

    expect(res.status).toBe(404);
    expect(uploadPublicFile).not.toHaveBeenCalled();
  });

  it("met à jour l'annonce du gestionnaire propriétaire", async () => {
    const manager = await createManager();
    const listing = await createListingRow(manager.id);

    const res = await request(app)
      .put(`/api/listings/${listing.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ price: 900, status: "ARCHIVED" });

    expect(res.status).toBe(200);
    expect(res.body.price).toBe(900);
    expect(res.body.status).toBe("ARCHIVED");
  });
});

describe("DELETE /api/listings/:id", () => {
  it("supprime l'annonce et ses demandes associées (cascade)", async () => {
    const manager = await createManager();
    const listing = await createListingRow(manager.id);
    await createLeadRow(listing.id, manager.id);

    const res = await request(app).delete(`/api/listings/${listing.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(204);
    const remainingLeads = await testDb.select().from(listingLeads).where(eq(listingLeads.listingId, listing.id));
    expect(remainingLeads).toHaveLength(0);
  });

  it("refuse de supprimer l'annonce d'un autre gestionnaire", async () => {
    const listing = await createListingRow((await createManager()).id);
    const other = await createManager();

    const res = await request(app).delete(`/api/listings/${listing.id}`).set(authHeader(tokenFor(other)));

    expect(res.status).toBe(404);
  });
});

describe("GET /api/listings/leads — CRM Leads", () => {
  it("ne renvoie que les demandes des annonces du gestionnaire connecté, avec le titre de l'annonce", async () => {
    const manager = await createManager();
    const listing = await createListingRow(manager.id, { title: "Villa Ngor" });
    await createLeadRow(listing.id, manager.id);

    const otherManager = await createManager();
    const otherListing = await createListingRow(otherManager.id, { title: "Confidentiel" });
    await createLeadRow(otherListing.id, otherManager.id, { prospectName: "Fuite" });

    const res = await request(app).get("/api/listings/leads").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].listingTitle).toBe("Villa Ngor");
    expect(res.body.items.map((l: { prospectName: string }) => l.prospectName)).not.toContain("Fuite");
  });

  it("filtre par annonce et par statut", async () => {
    const manager = await createManager();
    const listingA = await createListingRow(manager.id, { title: "A" });
    const listingB = await createListingRow(manager.id, { title: "B" });
    await createLeadRow(listingA.id, manager.id, { prospectName: "Client A1", status: "NEW" });
    await createLeadRow(listingA.id, manager.id, { prospectName: "Client A2", status: "CONVERTED" });
    await createLeadRow(listingB.id, manager.id, { prospectName: "Client B1", status: "NEW" });

    const res = await request(app)
      .get(`/api/listings/leads?listingId=${listingA.id}&status=NEW`)
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.items.map((l: { prospectName: string }) => l.prospectName)).toEqual(["Client A1"]);
  });
});

describe("PATCH /api/listings/leads/:id", () => {
  it("met à jour le statut et les notes d'une demande", async () => {
    const manager = await createManager();
    const listing = await createListingRow(manager.id);
    const lead = await createLeadRow(listing.id, manager.id);

    const res = await request(app)
      .patch(`/api/listings/leads/${lead.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ status: "CONTACTED", notes: "Rappelé, intéressé par une visite samedi" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CONTACTED");
    expect(res.body.notes).toBe("Rappelé, intéressé par une visite samedi");
  });

  it("refuse de modifier la demande rattachée à l'annonce d'un autre gestionnaire", async () => {
    const owner = await createManager();
    const listing = await createListingRow(owner.id);
    const lead = await createLeadRow(listing.id, owner.id);
    const intrus = await createManager();

    const res = await request(app)
      .patch(`/api/listings/leads/${lead.id}`)
      .set(authHeader(tokenFor(intrus)))
      .send({ status: "ARCHIVED" });

    expect(res.status).toBe(404);
  });
});
