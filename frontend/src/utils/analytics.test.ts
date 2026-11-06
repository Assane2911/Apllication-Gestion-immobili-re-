import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetAnalyticsStateForTests, estPagePublique, isAnalyticsConfigured, loadGoogleAnalytics, trackEvent, trackPageView } from "./analytics";

/** Les appels poussés dans dataLayer sont des objets Arguments : on les relit comme des tableaux pour les comparer. */
function lireAppels(): unknown[][] {
  return (window.dataLayer ?? []).map((appel) => Array.from(appel as ArrayLike<unknown>));
}

describe("analytics", () => {
  beforeEach(() => {
    _resetAnalyticsStateForTests();
    document.head.querySelectorAll("script[src*='googletagmanager']").forEach((el) => el.remove());
    delete window.gtag;
    delete window.dataLayer;
    delete (window as unknown as Record<string, unknown>)["ga-disable-G-TEST123"];
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

    const appels = lireAppels();
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
    expect(lireAppels()[appels]).toEqual(["event", "page_view", { page_path: "/vitrine/annonces/abc" }]);
  });

  it("pousse dans dataLayer des objets Arguments, seuls reconnus par gtag.js (un tableau est ignoré en silence)", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
    loadGoogleAnalytics();

    expect(window.dataLayer!.length).toBeGreaterThan(0);
    for (const appel of window.dataLayer!) {
      expect(Object.prototype.toString.call(appel)).toBe("[object Arguments]");
    }
  });

  it("trackEvent n'a aucun effet tant que le visiteur n'a pas accepté la mesure", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
    trackEvent({ nom: "sign_up", params: { method: "email" } });
    expect(window.gtag).toBeUndefined();
    expect(window.dataLayer ?? []).toHaveLength(0);
  });

  it("trackEvent envoie l'événement recommandé par Google avec ses seuls paramètres, sans donnée personnelle", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
    loadGoogleAnalytics();
    const avant = window.dataLayer!.length;

    trackEvent({ nom: "generate_lead", params: { lead_type: "visit" } });
    trackEvent({ nom: "login", params: { method: "google" } });

    expect(lireAppels().slice(avant)).toEqual([
      ["event", "generate_lead", { lead_type: "visit" }],
      ["event", "login", { method: "google" }],
    ]);
  });

  describe("site public seulement", () => {
    it("distingue le site public des pages de l'application", () => {
      for (const chemin of ["/", "/landing", "/login", "/inscription", "/mot-de-passe-oublie", "/mentions-legales", "/cgu", "/confidentialite", "/vitrine", "/vitrine/annonces/abc"]) {
        expect(estPagePublique(chemin), chemin).toBe(true);
      }
      for (const chemin of [
        "/dashboard",
        "/properties",
        "/tenants",
        "/invoices",
        "/annonces",
        "/agency",
        "/portail",
        "/portail/paiements",
        "/proprietaire/crg",
        "/proprietaires/abc/crg",
        "/admin/gestionnaires/abc",
        "/pays",
        "/reinitialiser-mot-de-passe",
        "/verifier-email",
        "/vitrine-privee",
        "/loginx",
      ]) {
        expect(estPagePublique(chemin), chemin).toBe(false);
      }
    });

    it("n'envoie aucune vue de page de l'application, et coupe toute la mesure de Google pour cette page", () => {
      vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
      loadGoogleAnalytics();
      const avant = window.dataLayer!.length;

      trackPageView("/dashboard");

      expect(window.dataLayer!.length).toBe(avant);
      expect((window as unknown as Record<string, unknown>)["ga-disable-G-TEST123"]).toBe(true);
    });

    it("rétablit la mesure en revenant sur une page publique", () => {
      vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
      loadGoogleAnalytics();
      trackPageView("/dashboard");
      const avant = window.dataLayer!.length;

      trackPageView("/vitrine");

      expect((window as unknown as Record<string, unknown>)["ga-disable-G-TEST123"]).toBe(false);
      expect(lireAppels().slice(avant)).toEqual([["event", "page_view", { page_path: "/vitrine" }]]);
    });

    it("démarre coupé quand la première page affichée est une page de l'application", () => {
      vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
      window.history.pushState({}, "", "/dashboard");
      try {
        loadGoogleAnalytics();
        expect((window as unknown as Record<string, unknown>)["ga-disable-G-TEST123"]).toBe(true);
        expect(lireAppels().some((appel) => appel[0] === "event")).toBe(false);
      } finally {
        window.history.pushState({}, "", "/");
      }
    });
  });
});
