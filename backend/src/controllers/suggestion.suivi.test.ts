import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { suggestions } from "../db/schema";
import { authHeader, createAdmin, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

async function adminToken() {
  return tokenFor(await createAdmin());
}

async function creerSuggestion(overrides: Partial<typeof suggestions.$inferInsert> = {}) {
  const [s] = await testDb
    .insert(suggestions)
    .values({ authorLabel: "agence@test.local", authorRole: "MANAGER", message: "Une idée utile", ...overrides })
    .returning();
  return s;
}

function modifier(id: string, token: string, body: Record<string, unknown>) {
  return request(app).patch(`/api/admin/suggestions/${id}`).set(authHeader(token)).send(body);
}

describe("suivi des suggestions : création", () => {
  it("une suggestion naît « NEW », et la réponse à l'auteur ne contient ni statut ni note interne", async () => {
    const manager = await createManager();

    const res = await request(app)
      .post("/api/suggestions")
      .set(authHeader(tokenFor(manager)))
      .send({ message: "Pouvoir exporter les quittances en lot." });

    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty("status");
    expect(res.body).not.toHaveProperty("adminNote");
    const [enBase] = await testDb.select().from(suggestions).where(eq(suggestions.id, res.body.id));
    expect(enBase.status).toBe("NEW");
    expect(enBase.adminNote).toBeNull();
  });
});

describe("GET /api/admin/suggestions : statuts et compteurs", () => {
  it("renvoie le nombre de suggestions par statut, quel que soit le filtre", async () => {
    const token = await adminToken();
    await creerSuggestion({ status: "NEW" });
    await creerSuggestion({ status: "NEW" });
    await creerSuggestion({ status: "PLANNED" });
    await creerSuggestion({ status: "DONE" });

    const tous = await request(app).get("/api/admin/suggestions").set(authHeader(token));
    expect(tous.body.counts).toEqual({ NEW: 2, PLANNED: 1, DONE: 1, DECLINED: 0, total: 4 });
    expect(tous.body.total).toBe(4);

    const filtre = await request(app).get("/api/admin/suggestions").query({ status: "NEW" }).set(authHeader(token));
    expect(filtre.body.items).toHaveLength(2);
    expect(filtre.body.total).toBe(2);
    // Les compteurs restent ceux de TOUTES les suggestions : ce sont les onglets.
    expect(filtre.body.counts).toEqual({ NEW: 2, PLANNED: 1, DONE: 1, DECLINED: 0, total: 4 });
  });

  it("expose statut et note interne à l'administration", async () => {
    const token = await adminToken();
    await creerSuggestion({ status: "PLANNED", adminNote: "Prévu T1" });

    const res = await request(app).get("/api/admin/suggestions").set(authHeader(token));

    expect(res.body.items[0]).toMatchObject({ status: "PLANNED", adminNote: "Prévu T1" });
  });

  it("pagine après filtrage", async () => {
    const token = await adminToken();
    for (let i = 0; i < 5; i++) await creerSuggestion({ status: "DONE", message: `Idée réalisée ${i}` });
    await creerSuggestion({ status: "NEW" });

    const page2 = await request(app)
      .get("/api/admin/suggestions")
      .query({ status: "DONE", page: 2, pageSize: 2 })
      .set(authHeader(token));

    expect(page2.body.total).toBe(5);
    expect(page2.body.totalPages).toBe(3);
    expect(page2.body.items).toHaveLength(2);
  });

  it("rejette un statut inconnu au lieu de l'ignorer", async () => {
    const token = await adminToken();
    const res = await request(app).get("/api/admin/suggestions").query({ status: "N_IMPORTE_QUOI" }).set(authHeader(token));
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/admin/suggestions/:id", () => {
  it("exige l'authentification et refuse un gestionnaire", async () => {
    const s = await creerSuggestion();
    expect((await request(app).patch(`/api/admin/suggestions/${s.id}`).send({ status: "DONE" })).status).toBe(401);
    const manager = await createManager();
    expect((await modifier(s.id, tokenFor(manager), { status: "DONE" })).status).toBe(403);
    expect((await testDb.select().from(suggestions).where(eq(suggestions.id, s.id)))[0].status).toBe("NEW");
  });

  it("change le statut sans toucher au message ni à l'auteur", async () => {
    const token = await adminToken();
    const s = await creerSuggestion({ message: "Texte d'origine", authorLabel: "auteur@test.local" });

    const res = await modifier(s.id, token, { status: "PLANNED" });

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(suggestions).where(eq(suggestions.id, s.id));
    expect(apres).toMatchObject({ status: "PLANNED", message: "Texte d'origine", authorLabel: "auteur@test.local" });
  });

  it("enregistre une note interne (rognée), la modifie et l'efface avec une chaîne vide", async () => {
    const token = await adminToken();
    const s = await creerSuggestion();

    await modifier(s.id, token, { adminNote: "  À discuter avec l'équipe  " });
    expect((await testDb.select().from(suggestions).where(eq(suggestions.id, s.id)))[0].adminNote).toBe("À discuter avec l'équipe");

    await modifier(s.id, token, { adminNote: "" });
    expect((await testDb.select().from(suggestions).where(eq(suggestions.id, s.id)))[0].adminNote).toBeNull();
  });

  it("modifier la note seule laisse le statut, et inversement", async () => {
    const token = await adminToken();
    const s = await creerSuggestion({ status: "PLANNED", adminNote: "Note d'origine" });

    await modifier(s.id, token, { adminNote: "Nouvelle note" });
    let [ligne] = await testDb.select().from(suggestions).where(eq(suggestions.id, s.id));
    expect(ligne).toMatchObject({ status: "PLANNED", adminNote: "Nouvelle note" });

    await modifier(s.id, token, { status: "DONE" });
    [ligne] = await testDb.select().from(suggestions).where(eq(suggestions.id, s.id));
    expect(ligne).toMatchObject({ status: "DONE", adminNote: "Nouvelle note" });
  });

  it("refuse une requête vide, un statut inconnu et une note trop longue", async () => {
    const token = await adminToken();
    const s = await creerSuggestion();
    expect((await modifier(s.id, token, {})).status).toBe(400);
    expect((await modifier(s.id, token, { status: "OUVERTE" })).status).toBe(400);
    expect((await modifier(s.id, token, { adminNote: "x".repeat(2001) })).status).toBe(400);
  });

  it("renvoie 404 pour une suggestion inconnue", async () => {
    const token = await adminToken();
    expect((await modifier("inconnue", token, { status: "DONE" })).status).toBe(404);
  });
});
