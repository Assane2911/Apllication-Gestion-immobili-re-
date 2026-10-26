import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resoudreModeDemo, signalerModeDemoIgnore } from "./modeDemo";

const sentry = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock("@sentry/node", () => ({
  init: () => {},
  setupExpressErrorHandler: () => {},
  flush: async () => true,
  captureMessage: sentry.captureMessage,
}));

/**
 * Production, 26 octobre 2026 : `PAYMENTS_DEMO_MODE=true` était posé sur Vercel. Ce drapeau ne fait pas que montrer le
 * moyen de paiement « DEMO » : il court-circuite aussi Stripe et PayDunya, qui renvoient un paiement simulé au statut PAID.
 * Tout gestionnaire connecté pouvait donc activer un abonnement sans qu'un centime ne soit encaissé. (La base ne contenait
 * aucun abonnement ni paiement de démonstration : rien n'avait été exploité.)
 *
 * Le code ne se fiait déjà qu'à un « true » explicite en production ; une erreur de configuration suffisait. Désormais,
 * hors développement local et tests, `PAYMENTS_DEMO_MODE=true` est IGNORÉ et signalé : le mode démo ne peut plus être
 * rouvert par une variable d'environnement sur un déploiement.
 */
describe("resoudreModeDemo", () => {
  it("en développement local, actif par défaut, comme avant", () => {
    expect(resoudreModeDemo(undefined, false)).toEqual({ actif: true, ignore: false });
  });

  it("en développement local, « false » le désactive, « true » l'active", () => {
    expect(resoudreModeDemo("false", false)).toEqual({ actif: false, ignore: false });
    expect(resoudreModeDemo("true", false)).toEqual({ actif: true, ignore: false });
  });

  it("sur un déploiement, désactivé par défaut", () => {
    expect(resoudreModeDemo(undefined, true)).toEqual({ actif: false, ignore: false });
    expect(resoudreModeDemo("false", true)).toEqual({ actif: false, ignore: false });
  });

  it("sur un déploiement, « true » est ignoré et marqué comme tel", () => {
    expect(resoudreModeDemo("true", true)).toEqual({ actif: false, ignore: true });
  });
});

describe("signalerModeDemoIgnore", () => {
  beforeEach(() => {
    sentry.captureMessage.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("signale dans le journal et à Sentry quand la demande a été ignorée, en disant quoi faire", () => {
    signalerModeDemoIgnore(true);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(console.error).mock.calls[0][0])).toMatch(/PAYMENTS_DEMO_MODE/);
    const [message, contexte] = sentry.captureMessage.mock.calls[0];
    expect(message).toMatch(/PAYMENTS_DEMO_MODE/);
    expect(message).toMatch(/supprimez|retirez/i);
    expect(contexte).toMatchObject({ level: "error", tags: { source: "config.paymentsDemoMode" }, fingerprint: ["payments-demo-mode-ignore"] });
  });

  it("ne dit rien quand rien n'a été ignoré", () => {
    signalerModeDemoIgnore(false);
    expect(console.error).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("ne fait jamais échouer le démarrage si Sentry lève une erreur", () => {
    sentry.captureMessage.mockImplementationOnce(() => {
      throw new Error("Sentry indisponible");
    });
    expect(() => signalerModeDemoIgnore(true)).not.toThrow();
  });
});

describe("au démarrage de l'application", () => {
  const avant = { vercel: process.env.VERCEL, demo: process.env.PAYMENTS_DEMO_MODE };
  beforeEach(() => {
    sentry.captureMessage.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
  });
  afterEach(() => {
    if (avant.vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = avant.vercel;
    process.env.PAYMENTS_DEMO_MODE = avant.demo;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("sur Vercel avec PAYMENTS_DEMO_MODE=true, le mode démo reste désactivé et le problème est signalé", async () => {
    process.env.VERCEL = "1";
    process.env.PAYMENTS_DEMO_MODE = "true";
    const { env } = await import("./env");
    await import("../app");
    expect(env.payments.demoMode).toBe(false);
    expect(sentry.captureMessage.mock.calls.filter((a) => /PAYMENTS_DEMO_MODE/.test(String(a[0])))).toHaveLength(1);
  });

  it("hors déploiement (développement, tests), le mode démo demandé reste actif et rien n'est signalé", async () => {
    delete process.env.VERCEL;
    process.env.PAYMENTS_DEMO_MODE = "true";
    const { env } = await import("./env");
    await import("../app");
    expect(env.payments.demoMode).toBe(true);
    expect(sentry.captureMessage.mock.calls.filter((a) => /PAYMENTS_DEMO_MODE/.test(String(a[0])))).toHaveLength(0);
  });
});
