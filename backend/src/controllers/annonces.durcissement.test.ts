import { is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { listingLeads, listings, rateLimitHits } from "../db/schema";
import { authHeader, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

vi.mock("../services/storage.service", () => ({
  uploadPublicFile: vi.fn().mockResolvedValue("http://test.local/mock-image.png"),
  deleteStorageObjectBestEffort: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => vi.restoreAllMocks());

async function agence() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) });
  const [annonce] = await testDb
    .insert(listings)
    .values({ managerId: manager.id, title: "Villa Ngor", description: "Belle villa avec piscine " + "x".repeat(3000), price: 250000, location: "Ngor, Dakar", country: "SN", status: "PUBLISHED" })
    .returning();
  return { manager, annonce, h: authHeader(tokenFor(manager)) };
}

const demande = { prospectName: "Awa Sow", prospectEmail: "awa@test.local", prospectPhone: "+221771234567" };

describe("Annonces — une modification sans aucun champ est refusée proprement (400) au lieu d'une erreur 500", () => {
  it("PUT /api/listings/:id avec un corps vide répond 400 et ne touche pas l'annonce", async () => {
    const { annonce, h } = await agence();

    const res = await request(app).put(`/api/listings/${annonce.id}`).set(h).send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("NOTHING_TO_UPDATE");
    expect((await testDb.select().from(listings).where(eq(listings.id, annonce.id)))[0].title).toBe("Villa Ngor");
  });

  it("l'annonce d'une autre agence répond toujours 404 (l'appartenance passe avant)", async () => {
    const { annonce } = await agence();
    const autre = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) });

    const res = await request(app).put(`/api/listings/${annonce.id}`).set(authHeader(tokenFor(autre))).send({});

    expect(res.status).toBe(404);
  });

  it("une modification réelle fonctionne toujours", async () => {
    const { annonce, h } = await agence();

    const res = await request(app).put(`/api/listings/${annonce.id}`).set(h).send({ title: "Villa Almadies" });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Villa Almadies");
  });

  it("PATCH /api/listings/leads/:id avec un corps vide répond 400 et ne touche pas la demande", async () => {
    const { manager, annonce, h } = await agence();
    const [lead] = await testDb.insert(listingLeads).values({ listingId: annonce.id, managerId: manager.id, ...demande }).returning();

    const res = await request(app).patch(`/api/listings/leads/${lead.id}`).set(h).send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("NOTHING_TO_UPDATE");
    expect((await testDb.select().from(listingLeads).where(eq(listingLeads.id, lead.id)))[0].status).toBe("NEW");
  });
});

describe("Annonces — un texte fait d'espaces n'est pas un texte", () => {
  it("une demande de visite sans nom réel est refusée (400), et un nom valide est enregistré sans espaces autour", async () => {
    const { annonce } = await agence();

    const blanc = await request(app).post(`/api/listings/public/${annonce.id}/leads`).send({ ...demande, prospectName: "     " });
    const bon = await request(app).post(`/api/listings/public/${annonce.id}/leads`).send({ ...demande, prospectName: "  Awa Sow  ", message: "    " });

    expect(blanc.status).toBe(400);
    expect(bon.status).toBe(201);
    const leads = await testDb.select().from(listingLeads).where(eq(listingLeads.listingId, annonce.id));
    expect(leads).toHaveLength(1);
    expect(leads[0].prospectName).toBe("Awa Sow");
    expect(leads[0].message ?? null).toBeNull();
  });

  it("une annonce dont le titre, la description ou le lieu n'est que des espaces est refusée (400)", async () => {
    const { h } = await agence();

    const res = await request(app).post("/api/listings").set(h).field("title", "   ").field("description", "        ").field("price", "10").field("location", "   ");

    expect(res.status).toBe(400);
    expect(await testDb.select().from(listings)).toHaveLength(1); // seule l'annonce de départ
  });

  it("le titre d'une annonce valide est enregistré sans espaces autour", async () => {
    const { h } = await agence();

    const res = await request(app).post("/api/listings").set(h).field("title", "  Terrain à Saly  ").field("description", "Beau terrain viabilisé").field("price", "10").field("location", "Saly");

    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Terrain à Saly");
  });
});

describe("Annonces — la limite des demandes publiques est partagée entre les instances", () => {
  it("chaque demande incrémente un compteur en base (et non en mémoire de l'instance)", async () => {
    const { annonce } = await agence();
    expect(await testDb.select().from(rateLimitHits)).toHaveLength(0);

    const res = await request(app).post(`/api/listings/public/${annonce.id}/leads`).send(demande);

    expect(res.status).toBe(201);
    expect(await testDb.select().from(rateLimitHits)).toHaveLength(1);
  });

  it("la onzième demande de la même adresse dans la fenêtre est refusée (429)", async () => {
    const { annonce } = await agence();
    for (let i = 0; i < 10; i++) expect((await request(app).post(`/api/listings/public/${annonce.id}/leads`).send(demande)).status).toBe(201);

    const refusee = await request(app).post(`/api/listings/public/${annonce.id}/leads`).send(demande);

    expect(refusee.status).toBe(429);
    expect(await testDb.select().from(listingLeads).where(eq(listingLeads.listingId, annonce.id))).toHaveLength(10);
  });
});

describe("Annonces — la liste des demandes ne charge pas les annonces entières", () => {
  it("GET /api/listings/leads ne lit pas la table des annonces en entier et garde le titre de l'annonce", async () => {
    const { manager, annonce, h } = await agence();
    await testDb.insert(listingLeads).values({ listingId: annonce.id, managerId: manager.id, ...demande });
    const entieres: unknown[] = [];
    const origine = testDb.select.bind(testDb);
    vi.spyOn(testDb, "select").mockImplementation(((...args: unknown[]) => {
      const requete = origine(...(args as []));
      const champs = args[0] as Record<string, unknown> | undefined;
      if (champs) {
        for (const valeur of Object.values(champs)) if (valeur && is(valeur as never, PgTable)) entieres.push(valeur);
      } else {
        const depuis = requete.from.bind(requete);
        requete.from = (table: unknown) => {
          entieres.push(table);
          return depuis(table);
        };
      }
      return requete;
    }) as never);

    const res = await request(app).get("/api/listings/leads").set(h);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].listingTitle).toBe("Villa Ngor");
    expect(res.body.items[0].prospectName).toBe("Awa Sow");
    expect(entieres).not.toContain(listings);
  });
});
