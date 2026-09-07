import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { users } from "../db/schema";
import { testDb } from "../test/setupTestDb";

describe("POST /api/auth/register puis /api/auth/login", () => {
  it("crée un compte non vérifié et bloque la connexion tant que l'email n'est pas confirmé", async () => {
    const registerRes = await request(app)
      .post("/api/auth/register")
      .send({ email: "nouveau@test.local", password: "Password123!" });

    expect(registerRes.status).toBe(201);
    expect(registerRes.body.pendingVerification).toBe(true);
    expect(registerRes.body.email).toBe("nouveau@test.local");

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "nouveau@test.local", password: "Password123!" });

    expect(loginRes.status).toBe(403);
    expect(loginRes.body.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("refuse l'inscription si l'email existe déjà", async () => {
    await request(app).post("/api/auth/register").send({ email: "dup@test.local", password: "Password123!" });
    const secondRes = await request(app)
      .post("/api/auth/register")
      .send({ email: "dup@test.local", password: "AutreMotDePasse1!" });

    expect(secondRes.status).toBe(409);
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
