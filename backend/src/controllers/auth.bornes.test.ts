import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";

/**
 * Routes publiques (sans compte) : rien de ce qui y arrive ne doit pouvoir peser plusieurs mégaoctets
 * dans la base ou dans le hachage d'un mot de passe.
 */
const emailLong = `${"a".repeat(250)}@example.com`;

describe("inscription — bornes", () => {
  it("refuse un email démesuré", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: emailLong, password: "Password123!" });
    expect(res.status).toBe(400);
  });

  it("refuse un mot de passe démesuré", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "long@test.local", password: "P".repeat(129) });
    expect(res.status).toBe(400);
  });

  it("refuse un code de parrainage démesuré", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "parrain@test.local", password: "Password123!", referralCode: "R".repeat(65) });
    expect(res.status).toBe(400);
  });

  it("accepte une inscription ordinaire", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "ordinaire@test.local", password: "Password123!" });
    expect(res.status).toBe(201);
  });
});

describe("connexion et mot de passe oublié — bornes", () => {
  it("refuse un mot de passe de connexion démesuré, sans le hacher", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "x@test.local", password: "P".repeat(2000) });
    expect(res.status).toBe(400);
  });

  it("refuse un email démesuré à la connexion, à la demande de lien et au renvoi de confirmation", async () => {
    for (const route of ["/api/auth/login", "/api/auth/forgot-password", "/api/auth/resend-verification"]) {
      const res = await request(app).post(route).send({ email: emailLong, password: "Password123!" });
      expect(res.status, route).toBe(400);
    }
  });

  it("refuse un nouveau mot de passe démesuré à la réinitialisation", async () => {
    const res = await request(app).post("/api/auth/reset-password").send({ token: "jeton", password: "P".repeat(129) });
    expect(res.status).toBe(400);
  });
});
