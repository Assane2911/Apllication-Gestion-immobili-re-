import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { users } from "../db/schema";
import { authHeader, createManager, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Un JWT est autoporteur : le serveur le croit sur signature, sans rien
 * consulter. Tant que rien ne le contredit, un jeton volé reste utilisable
 * jusqu'à son expiration — sept jours par défaut ici. Changer son mot de
 * passe n'y changeait rien : l'attaquant qui détenait déjà un jeton gardait
 * l'accès une semaine, précisément dans la situation où la victime croit
 * avoir repris la main.
 *
 * `users.tokenVersion` sert de contre-signature : le numéro est recopié dans
 * le jeton à l'émission, et comparé à chaque requête. L'incrémenter invalide
 * d'un coup tous les jetons émis auparavant, sur tous les appareils.
 *
 * Un jeton émis AVANT l'introduction du mécanisme ne porte aucun numéro : il
 * est lu comme la version 0, c'est-à-dire accepté tant qu'aucune révocation
 * n'a eu lieu. Déployer ce changement ne déconnecte donc personne — mais la
 * première révocation, elle, portera bien sur ces jetons-là aussi.
 */
describe("Révocation des jetons par version", () => {
  it("accepte un jeton sans numéro de version tant qu'aucune révocation n'a eu lieu", async () => {
    const manager = await createManager();

    const res = await request(app).get("/api/auth/me").set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
  });

  it("refuse un jeton dont le numéro de version est dépassé", async () => {
    const manager = await createManager();
    const jeton = tokenFor(manager);

    await testDb.update(users).set({ tokenVersion: 1 }).where(eq(users.id, manager.id));

    const res = await request(app).get("/api/auth/me").set(authHeader(jeton));

    expect(res.status).toBe(401);
  });

  it("invalide les jetons existants quand le mot de passe est réinitialisé", async () => {
    const manager = await createManager();
    const jetonAvant = tokenFor(manager);

    // Le flux complet passe par forgotPassword : on demande le lien, puis on
    // relit l'empreinte stockée pour rejouer resetPassword comme le ferait le
    // destinataire de l'email. Le jeton en clair n'existe que dans cet email,
    // donc on court-circuite en réécrivant nous-mêmes l'empreinte.
    const jetonDeReinitialisation = "jeton-de-test-reinitialisation";
    const empreinte = await import("crypto").then((c) =>
      c.createHash("sha256").update(jetonDeReinitialisation).digest("hex")
    );
    await testDb
      .update(users)
      .set({
        resetPasswordTokenHash: empreinte,
        resetPasswordExpiresAt: new Date(Date.now() + 3_600_000),
      })
      .where(eq(users.id, manager.id));

    const reinit = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: jetonDeReinitialisation, password: "NouveauMotDePasse123!" });
    expect(reinit.status).toBe(200);

    const res = await request(app).get("/api/auth/me").set(authHeader(jetonAvant));
    expect(res.status).toBe(401);
  });

  it("déconnecte tous les appareils sur demande, y compris celui qui la formule", async () => {
    const manager = await createManager();
    const jetonA = tokenFor(manager);
    const jetonB = tokenFor(manager);

    const demande = await request(app).post("/api/auth/logout-all").set(authHeader(jetonA));
    expect(demande.status).toBe(200);

    // Les deux jetons sont invalidés : se déconnecter partout inclut l'appareil
    // depuis lequel on le demande — c'est le sens de « partout ».
    expect((await request(app).get("/api/auth/me").set(authHeader(jetonA))).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set(authHeader(jetonB))).status).toBe(401);
  });

  it("délivre à la connexion suivante un jeton portant le nouveau numéro", async () => {
    const manager = await createManager({ email: "revocation@test.local" });
    await request(app).post("/api/auth/logout-all").set(authHeader(tokenFor(manager)));

    const connexion = await request(app)
      .post("/api/auth/login")
      .send({ email: "revocation@test.local", password: "Password123!" });

    expect(connexion.status).toBe(200);
    const res = await request(app).get("/api/auth/me").set(authHeader(connexion.body.token));
    expect(res.status).toBe(200);
  });
});
