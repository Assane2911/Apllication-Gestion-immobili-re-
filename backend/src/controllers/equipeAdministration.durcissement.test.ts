import { is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { users } from "../db/schema";
import * as emailService from "../services/email.service";
import { authHeader, createAdmin, createManager, createTeamMember, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

afterEach(() => vi.restoreAllMocks());

async function agenceEntreprise() {
  const manager = await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE", subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) });
  return { manager, h: authHeader(tokenFor(manager)) };
}

describe("Équipe — les e-mails d'invitation sont plafonnés", () => {
  it("la 31e invitation de l'heure est refusée (429) et aucun e-mail ne part", async () => {
    const { manager, h } = await agenceEntreprise();
    const envoi = vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
    for (let i = 0; i < 30; i++) {
      const res = await request(app).post("/api/team").set(h).send({ email: `collab${i}@test.local`, role: "AGENT" });
      expect(res.status, `invitation ${i + 1}`).toBe(201);
    }
    envoi.mockClear();

    const refusee = await request(app).post("/api/team").set(h).send({ email: "de-trop@test.local", role: "AGENT" });

    expect(refusee.status).toBe(429);
    expect(refusee.body.code).toBe("TEAM_INVITE_RATE_LIMITED");
    expect(envoi).not.toHaveBeenCalled();
    expect(await testDb.select().from(users).where(eqEmail("de-trop@test.local"))).toHaveLength(0);
    expect(manager.id).toBeTruthy();
  }, 60_000);

  it("renvoyer l'invitation compte dans la même limite", async () => {
    const { manager, h } = await agenceEntreprise();
    vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
    const membre = await createTeamMember(manager.id, { email: "attente@test.local", resetPasswordTokenHash: "en-attente", hasPassword: false });
    for (let i = 0; i < 30; i++) expect((await request(app).post(`/api/team/${membre.id}/resend`).set(h)).status, `renvoi ${i + 1}`).toBe(200);

    const refusee = await request(app).post(`/api/team/${membre.id}/resend`).set(h);

    expect(refusee.status).toBe(429);
    expect(refusee.body.code).toBe("TEAM_INVITE_RATE_LIMITED");
  }, 60_000);

  it("la limite est propre à chaque agence", async () => {
    const a = await agenceEntreprise();
    const b = await agenceEntreprise();
    vi.spyOn(emailService, "sendEmail").mockResolvedValue({ simulated: true } as never);
    for (let i = 0; i < 30; i++) await request(app).post("/api/team").set(a.h).send({ email: `a${i}@test.local`, role: "AGENT" });

    const autreAgence = await request(app).post("/api/team").set(b.h).send({ email: "b@test.local", role: "AGENT" });

    expect(autreAgence.status).toBe(201);
  }, 60_000);
});

import { eq } from "drizzle-orm";
function eqEmail(email: string) {
  return eq(users.email, email);
}

/**
 * Relève les tables lues EN ENTIER : `db.select().from(table)`, ou une table passée telle quelle dans la liste des colonnes
 * (`db.select({ user: users })`). Une liste de colonnes (`{ id: users.id }`) n'en fait pas partie.
 */
function surveillerLecturesEntieres() {
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
  return entieres;
}

describe("Administration — les listes de gestionnaires ne chargent pas les comptes entiers (hash de mot de passe, secrets 2FA)", () => {
  async function plateforme() {
    const admin = await createAdmin();
    await createManager({ subscriptionStatus: "ACTIVE", subscriptionPlan: "PRO", subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) });
    await createManager();
    return { admin, h: authHeader(tokenFor(admin)) };
  }

  // Une lecture entière de `users` est celle de l'authentification de l'administrateur lui-même, à chaque requête : pas d'autre.
  const lecturesDeUsers = (entieres: unknown[]) => entieres.filter((t) => t === users).length;

  it("GET /api/admin/managers garde le résultat et ne lit en entier que le compte de l'administrateur", async () => {
    const { h } = await plateforme();
    const entieres = surveillerLecturesEntieres();

    const res = await request(app).get("/api/admin/managers").set(h);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toHaveProperty("email");
    expect(res.body.items[0]).toHaveProperty("plan");
    expect(res.body.items[0]).toHaveProperty("status");
    expect(res.body.items[0]).toHaveProperty("createdAt");
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    expect(lecturesDeUsers(entieres)).toBe(1);
  });

  it("l'export CSV des gestionnaires ne lit en entier que le compte de l'administrateur", async () => {
    const { h } = await plateforme();
    const entieres = surveillerLecturesEntieres();

    const res = await request(app).get("/api/admin/exports/managers.csv").set(h);

    expect(res.status).toBe(200);
    expect(res.text.split("\n").length).toBeGreaterThanOrEqual(3);
    expect(lecturesDeUsers(entieres)).toBe(1);
  });

  it("le tableau de bord de la plateforme garde ses totaux et ne lit en entier que le compte de l'administrateur", async () => {
    const { h } = await plateforme();
    const entieres = surveillerLecturesEntieres();

    const res = await request(app).get("/api/admin/dashboard/stats").set(h);

    expect(res.status).toBe(200);
    expect(res.body.managers.total).toBe(2);
    expect(res.body.managers.subscriptionActive).toBe(1);
    expect(res.body.managers.trialActive).toBe(1);
    expect(lecturesDeUsers(entieres)).toBe(1);
  });
});
