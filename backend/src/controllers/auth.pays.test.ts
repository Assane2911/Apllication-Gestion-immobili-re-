import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { users } from "../db/schema";
import {
  authHeader,
  createAdmin,
  createManager,
  createTenant,
  createTenantPortalUser,
  tokenCollaborateur,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Le pays du compte. Il fixe, pays par pays, les règles de location applicables à l'agence : il est donc choisi à
 * l'inscription, dans la zone couverte (France et UEMOA), et ne change plus ensuite. Sa devise devient celle du compte.
 */
async function compte(email: string) {
  const [u] = await testDb.select().from(users).where(eq(users.email, email));
  return u;
}

describe("POST /api/auth/register — pays obligatoire", () => {
  it("crée le compte avec le pays choisi, et la devise de ce pays (XOF pour le Sénégal)", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "dakar@test.local", password: "Password123!", country: "sn" });

    expect(res.status).toBe(201);
    const u = await compte("dakar@test.local");
    expect(u.country).toBe("SN");
    expect(u.currency).toBe("XOF");
  });

  it("met l'euro pour la France", async () => {
    await request(app).post("/api/auth/register").send({ email: "paris@test.local", password: "Password123!", country: "FR" });

    const u = await compte("paris@test.local");
    expect(u.country).toBe("FR");
    expect(u.currency).toBe("EUR");
  });

  it("refuse l'inscription sans pays, et ne crée aucun compte", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "sanspays@test.local", password: "Password123!" });

    expect(res.status).toBe(400);
    expect(await compte("sanspays@test.local")).toBeUndefined();
  });

  it("refuse un pays hors de la zone, avec un code d'erreur que l'interface traduit", async () => {
    for (const country of ["CM", "MA", "BE", "US", ""]) {
      const res = await request(app).post("/api/auth/register").send({ email: "horszone@test.local", password: "Password123!", country });

      expect(res.status, country).toBe(400);
    }
    const res = await request(app).post("/api/auth/register").send({ email: "horszone@test.local", password: "Password123!", country: "CM" });
    expect(res.body.code).toBe("COUNTRY_UNSUPPORTED");
    expect(await compte("horszone@test.local")).toBeUndefined();
  });

  it("répond de la même façon qu'une adresse soit libre ou déjà prise (pas d'énumération des comptes)", async () => {
    const libre = await request(app).post("/api/auth/register").send({ email: "enum1@test.local", password: "Password123!", country: "SN" });
    const prise = await request(app).post("/api/auth/register").send({ email: "enum1@test.local", password: "Password123!", country: "FR" });

    expect(prise.status).toBe(libre.status);
    expect(prise.body).toEqual(libre.body);
    // Une inscription sur une adresse prise ne modifie rien du compte existant.
    expect((await compte("enum1@test.local")).country).toBe("SN");
  });
});

describe("POST /api/auth/country — choix du pays après l'inscription (Google, comptes d'avant)", () => {
  it("fixe le pays et la devise d'un gestionnaire qui n'en a pas encore", async () => {
    const manager = await createManager({ country: null, currency: "EUR" });

    const res = await request(app).post("/api/auth/country").set(authHeader(tokenFor(manager))).send({ country: "ci" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, country: "CI", currency: "XOF" });
    const [u] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(u.country).toBe("CI");
    expect(u.currency).toBe("XOF");
  });

  it("ne change plus un pays déjà choisi : il décide des règles des baux déjà signés", async () => {
    const manager = await createManager({ country: "SN", currency: "XOF" });

    const res = await request(app).post("/api/auth/country").set(authHeader(tokenFor(manager))).send({ country: "FR" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("COUNTRY_ALREADY_SET");
    const [u] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(u.country).toBe("SN");
    expect(u.currency).toBe("XOF");
  });

  it("refuse un pays hors de la zone", async () => {
    const manager = await createManager({ country: null });

    const res = await request(app).post("/api/auth/country").set(authHeader(tokenFor(manager))).send({ country: "CM" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("COUNTRY_UNSUPPORTED");
    expect((await testDb.select().from(users).where(eq(users.id, manager.id)))[0].country).toBeNull();
  });

  it("exige d'être connecté", async () => {
    expect((await request(app).post("/api/auth/country").send({ country: "SN" })).status).toBe(401);
  });

  it("est réservé au gestionnaire : ni le locataire ni l'administrateur n'ont de pays", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id);
    const portail = await createTenantPortalUser(tenant);
    const admin = await createAdmin();

    expect((await request(app).post("/api/auth/country").set(authHeader(tokenFor(portail, tenant.id))).send({ country: "SN" })).status).toBe(403);
    expect((await request(app).post("/api/auth/country").set(authHeader(tokenFor(admin))).send({ country: "SN" })).status).toBe(403);
  });

  it("est celui de l'agence : seul un collaborateur « tous droits » peut le choisir, jamais un lecteur", async () => {
    const manager = await createManager({ country: null });

    const lecteur = await tokenCollaborateur(manager, { teamRole: "READ_ONLY" });
    expect((await request(app).post("/api/auth/country").set(authHeader(lecteur)).send({ country: "SN" })).status).toBe(403);
    expect((await testDb.select().from(users).where(eq(users.id, manager.id)))[0].country).toBeNull();

    const complet = await tokenCollaborateur(manager, { teamRole: "FULL" });
    expect((await request(app).post("/api/auth/country").set(authHeader(complet)).send({ country: "SN" })).status).toBe(200);
    expect((await testDb.select().from(users).where(eq(users.id, manager.id)))[0].country).toBe("SN");
  });
});

describe("le pays dans la session", () => {
  it("/api/auth/me renvoie le pays du compte, ou null tant qu'il n'est pas choisi", async () => {
    const sans = await createManager({ country: null });
    const avec = await createManager({ country: "FR", currency: "EUR" });

    expect((await request(app).get("/api/auth/me").set(authHeader(tokenFor(sans)))).body.country).toBeNull();
    expect((await request(app).get("/api/auth/me").set(authHeader(tokenFor(avec)))).body.country).toBe("FR");
  });

  it("la connexion renvoie le pays du compte", async () => {
    const manager = await createManager({ country: "BF", currency: "XOF" });

    const res = await request(app).post("/api/auth/login").send({ email: manager.email, password: "Password123!" });

    expect(res.status).toBe(200);
    expect(res.body.user.country).toBe("BF");
  });
});
