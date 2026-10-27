import crypto from "crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { users } from "../db/schema";
import { authHeader, createManager, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Tout mot de passe choisi par une personne fait au moins 8 caractères, quel
 * que soit le chemin qui le pose : inscription, réinitialisation (qui sert
 * aussi à l'activation des comptes collaborateur et propriétaire invités) et
 * compte portail créé par le gestionnaire pour son locataire.
 */
const SEPT = "Abcdef1";
const HUIT = "Abcdef12";

describe("mot de passe : 8 caractères minimum sur tous les chemins", () => {
  it("inscription : refuse 7 caractères, accepte 8", async () => {
    const court = await request(app).post("/api/auth/register").send({ country: "SN", email: "court@test.local", password: SEPT });
    expect(court.status).toBe(400);
    const [absent] = await testDb.select().from(users).where(eq(users.email, "court@test.local"));
    expect(absent).toBeUndefined();

    const ok = await request(app).post("/api/auth/register").send({ country: "SN", email: "huit@test.local", password: HUIT });
    expect(ok.status).toBe(201);
  });

  it("réinitialisation (et activation d'un compte invité) : refuse 7 caractères sans consommer le lien, accepte 8", async () => {
    const manager = await createManager();
    const jeton = "jeton-de-reinitialisation-du-test";
    await testDb
      .update(users)
      .set({
        resetPasswordTokenHash: crypto.createHash("sha256").update(jeton).digest("hex"),
        resetPasswordExpiresAt: new Date(Date.now() + 3_600_000),
      })
      .where(eq(users.id, manager.id));

    const court = await request(app).post("/api/auth/reset-password").send({ token: jeton, password: SEPT });
    expect(court.status).toBe(400);

    const ok = await request(app).post("/api/auth/reset-password").send({ token: jeton, password: HUIT });
    expect(ok.status).toBe(200);
  });

  it("compte portail d'un locataire : refuse 7 caractères, accepte 8", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id, { email: "portail-min@test.local" });

    const court = await request(app)
      .post(`/api/tenants/${tenant.id}/portal-account`)
      .set(authHeader(tokenFor(manager)))
      .send({ password: SEPT });
    expect(court.status).toBe(400);

    const ok = await request(app)
      .post(`/api/tenants/${tenant.id}/portal-account`)
      .set(authHeader(tokenFor(manager)))
      .send({ password: HUIT });
    expect(ok.status).toBe(201);
  });
});
