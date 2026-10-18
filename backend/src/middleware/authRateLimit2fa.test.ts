import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { genererCodeTotp, genererSecretTotp } from "../services/totp.service";
import { authHeader, createManager, tokenFor } from "../test/authHelpers";

/**
 * Limite par COMPTE sur le second facteur : sans elle, seule l'IP était bornée (20 essais / 15 min), donc un
 * attaquant qui connaît le mot de passe et dispose de plusieurs adresses pouvait deviner un code à 6 chiffres
 * (trois codes sont valides à tout instant) sans plafond. Seuls les ÉCHECS comptent : un gestionnaire qui se
 * connecte normalement ne s'en approche jamais. Ce fichier épuise volontairement son propre quota (voir le
 * commentaire sur `isolate` dans test/setupTestDb.ts).
 */
const jetonEnAttente = (userId: string) => jwt.sign({ userId, purpose: "2fa_pending" }, env.jwtSecret, { expiresIn: "5m" });

async function managerAvec2fa() {
  const secret = genererSecretTotp();
  const manager = await createManager({ totpSecret: secret, totpEnabledAt: new Date() });
  return { manager, secret };
}

describe("limite par compte du second facteur", () => {
  it("bloque un compte après 8 codes faux, même avec le bon code ensuite, sans toucher aux autres comptes", async () => {
    const cible = await managerAvec2fa();
    const autre = await managerAvec2fa();

    for (let i = 0; i < 8; i++) {
      const res = await request(app)
        .post("/api/auth/2fa/verify-login")
        .send({ pendingToken: jetonEnAttente(cible.manager.id), code: "000000" });
      expect(res.status).toBe(401);
    }

    const bloque = await request(app)
      .post("/api/auth/2fa/verify-login")
      .send({ pendingToken: jetonEnAttente(cible.manager.id), code: await genererCodeTotp(cible.secret) });
    expect(bloque.status).toBe(429);

    const intact = await request(app)
      .post("/api/auth/2fa/verify-login")
      .send({ pendingToken: jetonEnAttente(autre.manager.id), code: await genererCodeTotp(autre.secret) });
    expect(intact.status).toBe(200);
  });

  it("un jeton qui n'est pas de nous ne verrouille le compte de personne", async () => {
    const cible = await managerAvec2fa();
    const forge = jwt.sign({ userId: cible.manager.id, purpose: "2fa_pending" }, "autre-secret", { expiresIn: "5m" });

    for (let i = 0; i < 8; i++) {
      await request(app).post("/api/auth/2fa/verify-login").send({ pendingToken: forge, code: "000000" });
    }

    const res = await request(app)
      .post("/api/auth/2fa/verify-login")
      .send({ pendingToken: jetonEnAttente(cible.manager.id), code: await genererCodeTotp(cible.secret) });
    expect(res.status).toBe(200);
  });

  it("borne aussi les gestes authentifiés qui exigent le second facteur ou le mot de passe (désactivation)", async () => {
    const { manager } = await managerAvec2fa();

    for (let i = 0; i < 8; i++) {
      const res = await request(app)
        .post("/api/auth/2fa/disable")
        .set(authHeader(tokenFor(manager)))
        .send({ password: "mauvais-mot-de-passe" });
      expect(res.status).toBe(401);
    }

    const bloque = await request(app)
      .post("/api/auth/2fa/disable")
      .set(authHeader(tokenFor(manager)))
      .send({ password: "Password123!" });
    expect(bloque.status).toBe(429);
  });
});
