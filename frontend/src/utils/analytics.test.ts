import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetAnalyticsStateForTests, isAnalyticsConfigured, loadGoogleAnalytics, trackPageView } from "./analytics";

describe("analytics", () => {
  beforeEach(() => {
    _resetAnalyticsStateForTests();
    document.head.querySelectorAll("script[src*='googletagmanager']").forEach((el) => el.remove());
    delete window.gtag;
    delete window.dataLayer;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("n'est pas configuré sans VITE_GA_MEASUREMENT_ID", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "");
    expect(isAnalyticsConfigured()).toBe(false);
  });

  it("est configuré quand VITE_GA_MEASUREMENT_ID est défini", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
    expect(isAnalyticsConfigured()).toBe(true);
  });

  it("ne charge aucun script si aucun ID n'est configuré", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "");
    loadGoogleAnalytics();
    expect(document.head.querySelector("script[src*='googletagmanager']")).toBeNull();
    expect(window.gtag).toBeUndefined();
  });

  it("charge gtag.js avec le bon ID une fois configuré", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
    loadGoogleAnalytics();

    const script = document.head.querySelector("script[src*='googletagmanager']");
    expect(script).not.toBeNull();
    expect(script?.getAttribute("src")).toContain("id=G-TEST123");
    expect(window.gtag).toBeTypeOf("function");
  });

  it("accorde le consentement de mesure avant de configurer le tag, sans quoi Google abandonne silencieusement les événements", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
    loadGoogleAnalytics();

    const appels = window.dataLayer!;
    const indexConsent = appels.findIndex((appel) => (appel as unknown[])[0] === "consent");
    const indexConfig = appels.findIndex((appel) => (appel as unknown[])[0] === "config");

    expect(indexConsent).toBeGreaterThanOrEqual(0);
    expect(indexConsent).toBeLessThan(indexConfig);
    expect(appels[indexConsent]).toEqual(["consent", "default", expect.objectContaining({ analytics_storage: "granted" })]);
  });

  it("ne charge le script qu'une seule fois même appelé plusieurs fois", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
    loadGoogleAnalytics();
    loadGoogleAnalytics();
    expect(document.head.querySelectorAll("script[src*='googletagmanager']").length).toBe(1);
  });

  it("trackPageView n'a aucun effet tant que le script n'est pas chargé", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
    trackPageView("/vitrine");
    expect(window.gtag).toBeUndefined();
  });

  it("trackPageView envoie un événement page_view une fois le script chargé", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
    loadGoogleAnalytics();
    const appels = window.dataLayer!.length;

    trackPageView("/vitrine/annonces/abc");

    expect(window.dataLayer!.length).toBe(appels + 1);
    expect(window.dataLayer![appels]).toEqual(["event", "page_view", { page_path: "/vitrine/annonces/abc" }]);
  });
});
