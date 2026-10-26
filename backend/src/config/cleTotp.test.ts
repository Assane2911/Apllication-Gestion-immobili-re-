import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signalerCleTotp } from "./cleTotp";

const sentry = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock("@sentry/node", () => ({
  init: () => {},
  setupExpressErrorHandler: () => {},
  flush: async () => true,
  captureMessage: sentry.captureMessage,
}));

/** En production, tant que les secrets de double authentification sont stockés en clair, le démarrage le signale (sans le bloquer). */
describe("signalerCleTotp", () => {
  beforeEach(() => {
    sentry.captureMessage.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("en production sans clé : journal et Sentry (niveau avertissement), avec la commande pour la générer", () => {
    signalerCleTotp(true, null, false);
    expect(String(vi.mocked(console.error).mock.calls[0][0])).toMatch(/TOTP_ENCRYPTION_KEY est absente/);
    const [message, contexte] = sentry.captureMessage.mock.calls[0];
    expect(message).toMatch(/openssl rand -base64 32/);
    expect(contexte).toMatchObject({ level: "warning", tags: { source: "config.totpEncryptionKey" }, fingerprint: ["totp-encryption-key", "absente"] });
  });

  it("en production avec une clé de mauvaise forme : signalé comme invalide", () => {
    signalerCleTotp(true, null, true);
    expect(sentry.captureMessage.mock.calls[0][0]).toMatch(/invalide/);
    expect((sentry.captureMessage.mock.calls[0][1] as { fingerprint: string[] }).fingerprint).toEqual(["totp-encryption-key", "invalide"]);
  });

  it("ne dit rien quand la clé est posée, ni hors production", () => {
    signalerCleTotp(true, crypto.randomBytes(32), false);
    signalerCleTotp(false, null, false);
    expect(console.error).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("ne fait jamais échouer le démarrage si Sentry lève une erreur", () => {
    sentry.captureMessage.mockImplementationOnce(() => {
      throw new Error("Sentry indisponible");
    });
    expect(() => signalerCleTotp(true, null, false)).not.toThrow();
  });
});

describe("au démarrage de l'application", () => {
  const avant = { vercel: process.env.VERCEL, cle: process.env.TOTP_ENCRYPTION_KEY };
  beforeEach(() => {
    sentry.captureMessage.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
  });
  afterEach(() => {
    if (avant.vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = avant.vercel;
    if (avant.cle === undefined) delete process.env.TOTP_ENCRYPTION_KEY;
    else process.env.TOTP_ENCRYPTION_KEY = avant.cle;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  const signalements = () => sentry.captureMessage.mock.calls.filter((a) => /TOTP_ENCRYPTION_KEY/.test(String(a[0])));

  it("sur Vercel sans clé, l'application démarre et le signale", async () => {
    process.env.VERCEL = "1";
    delete process.env.TOTP_ENCRYPTION_KEY;
    const { app } = await import("../app");
    expect(app).toBeDefined();
    expect(signalements()).toHaveLength(1);
  });

  it("sur Vercel avec une clé valide, rien n'est signalé et la clé est lue", async () => {
    process.env.VERCEL = "1";
    process.env.TOTP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    const { env } = await import("./env");
    await import("../app");
    expect(env.totpEncryptionKey).toHaveLength(32);
    expect(signalements()).toHaveLength(0);
  });
});
