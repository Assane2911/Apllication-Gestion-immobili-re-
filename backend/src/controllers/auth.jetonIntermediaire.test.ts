import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { users } from "../db/schema";
import { genererCodeTotp } from "../services/totp.service";
import { authHeader, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Régression : le jeton intermédiaire émis par /login quand la 2FA est activée (« mot de passe prouvé, second
 * facteur pas encore ») est signé avec le même secret que les sessions. Il ne porte ni rôle ni numéro de
 * version, et `authenticate` lisait l'absence de version comme « version 0 » : tant que le compte n'avait
 * jamais été révoqué, ce jeton était accepté comme une vraie session. Quiconque connaissait le mot de passe
 * — c'est précisément ce que la 2FA doit empêcher — pouvait appeler toute route qui n'exige que d'être
 * authentifié, sans jamais fournir le code : lire le profil (/auth/me), fermer toutes les sessions du
 * titulaire, changer la devise, déposer une suggestion.
 */
describe("jeton intermédiaire de double authentification", () => {
  async function compteAvecDeuxFa() {
    const manager = await createManager();
    const setup = await request(app).post("/api/auth/2fa/setup").set(authHeader(tokenFor(manager)));
    await request(app)
      .post("/api/auth/2fa/confirm")
      .set(authHeader(tokenFor(manager)))
      .send({ code: await genererCodeTotp(setup.body.secret) })
      .expect(200);
    const login = await request(app).post("/api/auth/login").send({ email: manager.email, password: "Password123!" });
    expect(login.body.twoFactorRequired).toBe(true);
    return { manager, secret: setup.body.secret as string, pendingToken: login.body.pendingToken as string };
  }

  it("n'est jamais accepté comme une session", async () => {
    const { pendingToken } = await compteAvecDeuxFa();

    const appels = [
      request(app).get("/api/auth/me").set(authHeader(pendingToken)),
      request(app).post("/api/auth/logout-all").set(authHeader(pendingToken)),
      request(app).patch("/api/auth/currency").set(authHeader(pendingToken)).send({ currency: "XOF" }),
      request(app).post("/api/suggestions").set(authHeader(pendingToken)).send({ message: "Une idée pour vous" }),
    ];
    for (const appel of appels) {
      expect((await appel).status).toBe(401);
    }
  });

  it("n'a aucun effet de bord : ni révocation des sessions, ni changement de devise", async () => {
    const { manager, pendingToken } = await compteAvecDeuxFa();
    const [avant] = await testDb.select().from(users).where(eq(users.id, manager.id));

    await request(app).post("/api/auth/logout-all").set(authHeader(pendingToken));
    await request(app).patch("/api/auth/currency").set(authHeader(pendingToken)).send({ currency: "XOF" });

    const [apres] = await testDb.select().from(users).where(eq(users.id, manager.id));
    expect(apres.tokenVersion).toBe(avant.tokenVersion);
    expect(apres.currency).toBe(avant.currency);
  });

  it("reste utilisable pour ce à quoi il sert : échanger un code contre une vraie session", async () => {
    const { secret, pendingToken } = await compteAvecDeuxFa();

    const verifie = await request(app)
      .post("/api/auth/2fa/verify-login")
      .send({ pendingToken, code: await genererCodeTotp(secret) });

    expect(verifie.status).toBe(200);
    const me = await request(app).get("/api/auth/me").set(authHeader(verifie.body.token));
    expect(me.status).toBe(200);
  });
});
