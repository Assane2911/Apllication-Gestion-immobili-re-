import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { users } from "../db/schema";
import { authHeader, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Un jeton JWT reste valide jusqu'à son expiration, y compris après la
 * suppression du compte qu'il désigne : rien, dans un jeton signé, ne dit que
 * le compte existe encore. Depuis que le gestionnaire peut supprimer son
 * compte lui-même (deleteMyAccount), ce cas n'est plus théorique — le jeton
 * qu'il détient dans son navigateur lui survit.
 *
 * Deux routes s'en tiraient par une erreur 500 : elles mettaient à jour la
 * ligne `users` désignée par le jeton, puis lisaient le résultat sans vérifier
 * qu'une ligne avait bien été touchée (`updated.currency` sur `undefined`).
 * Les autres répondaient 404, ce qui n'est pas faux mais ne sert à rien :
 * l'intercepteur du frontend ne vide la session que sur un 401 (voir
 * api/client.ts), donc l'utilisateur restait bloqué devant une application
 * qui le croit connecté.
 *
 * La réponse juste est 401 dans tous les cas : le jeton ne vaut plus rien,
 * et c'est exactement ce que le frontend sait traiter.
 */
describe("Jeton valide dont le compte n'existe plus", () => {
  async function jetonOrphelin() {
    const manager = await createManager();
    const jeton = tokenFor(manager);
    await testDb.delete(users).where(eq(users.id, manager.id));
    return jeton;
  }

  it("répond 401 à la mise à jour de la devise, et non 500", async () => {
    const jeton = await jetonOrphelin();

    const res = await request(app)
      .patch("/api/auth/currency")
      .set(authHeader(jeton))
      .send({ currency: "XOF" });

    expect(res.status).toBe(401);
  });

  it("répond 401 à la résiliation d'abonnement, et non 500", async () => {
    const jeton = await jetonOrphelin();

    const res = await request(app).post("/api/subscription/cancel").set(authHeader(jeton));

    expect(res.status).toBe(401);
  });

  it("répond 401 sur /me, pour que le frontend vide la session", async () => {
    const jeton = await jetonOrphelin();

    const res = await request(app).get("/api/auth/me").set(authHeader(jeton));

    expect(res.status).toBe(401);
  });

  it("répond 401 sur une route protégée par l'abonnement", async () => {
    const jeton = await jetonOrphelin();

    const res = await request(app).get("/api/properties").set(authHeader(jeton));

    expect(res.status).toBe(401);
  });

  it("répond 401 à la création d'un bien, qui lit la devise du gestionnaire", async () => {
    const jeton = await jetonOrphelin();

    const res = await request(app)
      .post("/api/properties")
      .set(authHeader(jeton))
      .send({ title: "Studio", address: "Dakar", rent: 100000 });

    expect(res.status).toBe(401);
  });
});
