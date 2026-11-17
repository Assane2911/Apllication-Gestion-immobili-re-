import crypto from "crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { ipnLimiterStore } from "./rateLimit";

const TEST_MASTER_KEY = "test-paydunya-master-key-do-not-use-in-production";
const HASH_VALIDE = crypto.createHash("sha512").update(TEST_MASTER_KEY).digest("hex");

const corps = (hash: string) => ({ data: JSON.stringify({ status: "completed", hash, invoice: { token: "t" }, custom_data: { reference: "r" } }) });

/**
 * Les routes d'IPN PayDunya sont publiques : leur seule garde est le hash, vérifié dans le contrôleur. Sans plafond, un tiers
 * pouvait les marteler sans limite, que ce soit pour deviner le hash ou pour sonder quelles agences ont un compte de paiement
 * (404 « Compte introuvable » contre 401). Seuls les REFUS D'AUTHENTIFICATION comptent (hash invalide, agence inconnue) :
 * les notifications authentiques de PayDunya, et même ses réessais pendant une panne de confirmation (502), n'usent jamais
 * ce quota, et ne risquent donc pas d'être bloqués au moment où un paiement doit être enregistré.
 */
describe("ipnLimiter (limite par IP des refus sur /api/payments/paydunya/ipn*)", () => {
  beforeEach(async () => {
    await ipnLimiterStore.resetAll();
    vi.unstubAllGlobals();
  });

  it("autorise 30 hash invalides puis bloque le suivant avec 429", async () => {
    for (let i = 0; i < 30; i++) {
      const res = await request(app).post("/api/payments/paydunya/ipn").send(corps("hash-invente"));
      expect(res.status).toBe(401);
    }
    const bloque = await request(app).post("/api/payments/paydunya/ipn").send(corps("hash-invente"));
    expect(bloque.status).toBe(429);
  });

  it("le quota est partagé avec la route des agences : sonder des agences inconnues finit bloqué", async () => {
    for (let i = 0; i < 30; i++) {
      const res = await request(app).post(`/api/payments/paydunya/ipn/agence/agence-inconnue-${i}`).send(corps("hash-invente"));
      expect(res.status).toBe(404);
    }
    const bloque = await request(app).post("/api/payments/paydunya/ipn/agence/encore-une-autre").send(corps("hash-invente"));
    expect(bloque.status).toBe(429);
  });

  it("une notification authentique n'entame pas le quota, même quand la confirmation échoue (502)", async () => {
    // PayDunya injoignable : le contrôleur répond 502 pour que PayDunya rejoue la notification plus tard.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("réseau coupé")));
    for (let i = 0; i < 40; i++) {
      const res = await request(app).post("/api/payments/paydunya/ipn").send(corps(HASH_VALIDE));
      expect(res.status).toBe(502);
    }
  });

  it("au-delà du quota, le refus 429 est renvoyé avant le contrôleur, même avec un hash valide", async () => {
    // Le quota est par adresse IP : seule l'adresse qui accumule des refus est bloquée.
    for (let i = 0; i < 30; i++) await request(app).post("/api/payments/paydunya/ipn").send(corps("hash-invente"));
    const bloque = await request(app).post("/api/payments/paydunya/ipn").send(corps(HASH_VALIDE));
    expect(bloque.status).toBe(429);
    expect(bloque.body.error).toBe("Trop de tentatives. Réessayez plus tard.");
  });
});
