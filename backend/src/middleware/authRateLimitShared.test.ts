import { sql } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { rateLimitHits } from "../db/schema";
import { testDb } from "../test/setupTestDb";
import { PostgresRateLimitStore } from "./rateLimitStore";

/**
 * De bout en bout : les limiteurs de /api/auth/* comptent en base, donc une
 * nouvelle instance du serveur (autre démarrage à froid) hérite du compteur au
 * lieu de repartir de zéro.
 */
describe("limiteurs d'authentification : compteur partagé en base", () => {
  it("enregistre les tentatives par email en base, et une autre instance les retrouve", async () => {
    const email = "partage-cible@test.local";
    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/auth/forgot-password").send({ email });
    }

    const lignes = await testDb.select().from(rateLimitHits);
    // Deux compteurs : par adresse IP et par email ciblé, tous deux en base.
    expect(lignes).toHaveLength(2);
    expect(lignes.map((l: { hits: number }) => l.hits)).toEqual([5, 5]);

    // Une autre instance (démarrage à froid) lit le même compteur.
    const autreInstance = new PostgresRateLimitStore("auth-email");
    autreInstance.init({ windowMs: 15 * 60 * 1000 } as never);
    expect((await autreInstance.increment(`email:${email}`)).totalHits).toBe(6);
  });

  it("bloque la 9e tentative sur un email même si le compteur a été alimenté par d'autres instances", async () => {
    const email = "autres-instances@test.local";
    // Sept tentatives déjà comptées par d'AUTRES instances (même clé, même base).
    const autres = new PostgresRateLimitStore("auth-email");
    autres.init({ windowMs: 15 * 60 * 1000 } as never);
    for (let i = 0; i < 7; i++) await autres.increment(`email:${email}`);

    const huitieme = await request(app).post("/api/auth/forgot-password").send({ email });
    const neuvieme = await request(app).post("/api/auth/forgot-password").send({ email });

    expect(huitieme.status).toBe(200);
    expect(neuvieme.status).toBe(429);
    expect(neuvieme.body.error).toBe("Trop de tentatives pour ce compte. Réessayez dans quelques minutes.");
  });

  it("n'enregistre ni l'email ni l'IP en clair dans la table", async () => {
    await request(app).post("/api/auth/forgot-password").send({ email: "prive@test.local" });

    const brut = await testDb.execute(sql`SELECT string_agg(cle, ',') AS cles FROM rate_limit_hits`);
    const texte = JSON.stringify(brut);
    expect(texte).not.toContain("prive@test.local");
    expect(texte).not.toContain("127.0.0.1");
  });
});
