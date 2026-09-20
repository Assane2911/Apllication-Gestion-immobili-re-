import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { users } from "../db/schema";
import { createManager, createOwner, createOwnerPortalUser } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

describe("POST /api/auth/register puis /api/auth/login", () => {
  it("crée un compte non vérifié et bloque la connexion tant que l'email n'est pas confirmé", async () => {
    const registerRes = await request(app)
      .post("/api/auth/register")
      .send({ email: "nouveau@test.local", password: "Password123!" });

    expect(registerRes.status).toBe(201);
    expect(registerRes.body.pendingVerification).toBe(true);
    // `email` a volontairement disparu de la réponse : le renvoyer depuis la
    // base aurait suffi à distinguer une adresse libre d'une adresse déjà
    // prise, et rouvert l'énumération que cette réponse ferme (voir
    // enumerationComptes.test.ts).
    expect(registerRes.body).not.toHaveProperty("email");

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "nouveau@test.local", password: "Password123!" });

    expect(loginRes.status).toBe(403);
    expect(loginRes.body.code).toBe("EMAIL_NOT_VERIFIED");
  });

  // Ce test attendait un 409 « Un compte existe déjà avec cet email ». Ce
  // message permettait de tester une liste d'adresses pour savoir lesquelles
  // ont un compte ici. L'inscription répond désormais la même chose dans les
  // deux cas ; ce qui reste à garantir, c'est qu'aucun second compte n'est
  // créé et que l'existant n'est pas touché.
  it("ne crée pas de second compte si l'email existe déjà", async () => {
    await request(app).post("/api/auth/register").send({ email: "dup@test.local", password: "Password123!" });
    const secondRes = await request(app)
      .post("/api/auth/register")
      .send({ email: "dup@test.local", password: "AutreMotDePasse1!" });

    expect(secondRes.status).toBe(201);

    const comptes = await testDb.select().from(users).where(eq(users.email, "dup@test.local"));
    expect(comptes).toHaveLength(1);

    // Et le mot de passe du compte existant n'a pas été remplacé.
    await testDb.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.email, "dup@test.local"));
    const connexion = await request(app)
      .post("/api/auth/login")
      .send({ email: "dup@test.local", password: "AutreMotDePasse1!" });
    expect(connexion.status).toBe(401);
  });

  it("connecte un compte une fois l'email vérifié, avec un JWT exploitable sur /api/auth/me", async () => {
    await request(app).post("/api/auth/register").send({ email: "verifie@test.local", password: "Password123!" });

    // On simule la confirmation d'email (le flux réel passe par le lien envoyé
    // par email, hors-scope ici) en marquant directement le compte comme vérifié.
    await testDb
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(users.email, "verifie@test.local"));

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "verifie@test.local", password: "Password123!" });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeTypeOf("string");
    expect(loginRes.body.user.email).toBe("verifie@test.local");
    expect(loginRes.body.user.subscription.isTrialActive).toBe(true);

    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${loginRes.body.token}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.email).toBe("verifie@test.local");
  });

  it("refuse la connexion avec un mauvais mot de passe", async () => {
    await request(app).post("/api/auth/register").send({ email: "mdp@test.local", password: "Password123!" });
    await testDb.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.email, "mdp@test.local"));

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "mdp@test.local", password: "MauvaisMotDePasse" });

    expect(res.status).toBe(401);
  });

  it("refuse /api/auth/me sans token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/login puis /api/auth/me — compte propriétaire (Espace propriétaire)", () => {
  it("renvoie ownerId/ownerName au login et à /me, comme tenantId/tenantName pour un locataire", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id, {
      firstName: "Fatou",
      lastName: "Diop",
      email: "fatou-login@test.local",
    });
    await createOwnerPortalUser(owner);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "fatou-login@test.local", password: "Password123!" });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.role).toBe("OWNER");
    expect(loginRes.body.user.ownerId).toBe(owner.id);
    expect(loginRes.body.user.ownerName).toBe("Fatou Diop");

    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${loginRes.body.token}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.owner.id).toBe(owner.id);
  });
});
