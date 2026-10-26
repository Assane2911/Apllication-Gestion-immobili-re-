import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { problemeSecretJwt, verifierSecretJwt } from "./secretJwt";

const sentry = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock("@sentry/node", () => ({
  init: () => {},
  setupExpressErrorHandler: () => {},
  flush: async () => true,
  captureMessage: sentry.captureMessage,
}));

/**
 * `JWT_SECRET` signe tous les jetons de connexion. Le code vérifiait seulement qu'il existait : une valeur courte, ou le
 * texte d'exemple de `backend/.env.example` (public, le dépôt l'est), était acceptée sans un mot — et quiconque connaît
 * le secret peut fabriquer un jeton valide, y compris pour un compte administrateur.
 *
 * En production, une valeur faible est maintenant signalée (journal + Sentry) à chaque démarrage à froid. Elle n'empêche
 * PAS de démarrer : changer le secret déconnecte tout le monde, la décision revient à la personne qui gère le déploiement.
 * La valeur n'apparaît jamais dans ce qui est écrit ou envoyé.
 */
describe("problemeSecretJwt", () => {
  it("reconnaît le texte d'exemple du dépôt, quelle que soit la casse", () => {
    expect(problemeSecretJwt("changez-cette-cle-secrete-en-production")).toBe("exemple");
    expect(problemeSecretJwt("CHANGEZ-CETTE-CLE-SECRETE-EN-PRODUCTION")).toBe("exemple");
  });

  it("reconnaît une valeur trop courte (moins de 32 caractères)", () => {
    expect(problemeSecretJwt("secret")).toBe("court");
    expect(problemeSecretJwt("a".repeat(31))).toBe("court");
  });

  it("accepte une vraie valeur aléatoire (openssl rand -base64 48 fait 64 caractères)", () => {
    expect(problemeSecretJwt("a".repeat(32))).toBeNull();
    expect(problemeSecretJwt("k3Jf9Xw0pQ7zLm2VbN8cR5tYhG1dS4aUeO6iWx3Z+Pq9TnBvC0yMjAr7KlHs2FuD")).toBeNull();
  });
});

describe("verifierSecretJwt", () => {
  beforeEach(() => {
    sentry.captureMessage.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("en production, un secret court est signalé dans le journal et à Sentry", () => {
    verifierSecretJwt("secretcourt123", true);

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(console.error).mock.calls[0][0])).toMatch(/JWT_SECRET/);
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [message, contexte] = sentry.captureMessage.mock.calls[0];
    expect(message).toMatch(/JWT_SECRET/);
    expect(contexte).toMatchObject({ level: "error", tags: { source: "config.jwtSecret", cause: "court" }, fingerprint: ["jwt-secret-faible", "court"] });
  });

  it("en production, le texte d'exemple est signalé sous la cause « exemple »", () => {
    verifierSecretJwt("changez-cette-cle-secrete-en-production", true);
    expect((sentry.captureMessage.mock.calls[0][1] as { fingerprint: string[] }).fingerprint).toEqual(["jwt-secret-faible", "exemple"]);
  });

  it("n'écrit ni n'envoie jamais la valeur du secret", () => {
    verifierSecretJwt("secretcourt123", true);
    const tout = JSON.stringify([vi.mocked(console.error).mock.calls, sentry.captureMessage.mock.calls]);
    expect(tout).not.toContain("secretcourt123");
  });

  it("ne dit rien en production pour un secret solide", () => {
    verifierSecretJwt("k3Jf9Xw0pQ7zLm2VbN8cR5tYhG1dS4aUeO6iWx3Z+Pq9TnBvC0yMjAr7KlHs2FuD", true);
    expect(console.error).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("ne dit rien hors production (développement, tests) : un secret court y est normal", () => {
    verifierSecretJwt("secret", false);
    expect(console.error).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("ne fait jamais échouer le démarrage, même si Sentry lève une erreur", () => {
    sentry.captureMessage.mockImplementationOnce(() => {
      throw new Error("Sentry indisponible");
    });
    expect(() => verifierSecretJwt("secret", true)).not.toThrow();
  });
});

describe("au démarrage de l'application", () => {
  const avant = { vercel: process.env.VERCEL, jwt: process.env.JWT_SECRET };
  beforeEach(() => {
    sentry.captureMessage.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
  });
  afterEach(() => {
    if (avant.vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = avant.vercel;
    process.env.JWT_SECRET = avant.jwt;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("sur Vercel avec un secret faible, l'application démarre quand même et signale le problème", async () => {
    process.env.VERCEL = "1";
    process.env.JWT_SECRET = "secretcourt123";
    const { app } = await import("../app");
    expect(app).toBeDefined();
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it("hors Vercel (développement, tests), rien n'est signalé", async () => {
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "secretcourt123";
    await import("../app");
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });
});
