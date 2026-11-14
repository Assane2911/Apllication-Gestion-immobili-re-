import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetAnalyticsStateForTests, appliquerInterrupteurTraficInterne, estPagePublique, estTraficInterne, isAnalyticsConfigured, loadGoogleAnalytics, trackEvent, trackPageView } from "./analytics";

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

  describe("interrupteur du trafic interne", () => {
    const adresseInitiale = window.location.href;

    beforeEach(() => {
      localStorage.removeItem("trafic_interne");
    });

    afterEach(() => {
      localStorage.removeItem("trafic_interne");
      window.history.replaceState(null, "", adresseInitiale);
      vi.restoreAllMocks();
    });

    it("n'est pas marqué par défaut, et le tag de configuration n'envoie alors aucun traffic_type", () => {
      vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
      expect(estTraficInterne()).toBe(false);

      loadGoogleAnalytics();

      const config = lireAppels().find((appel) => appel[0] === "config");
      expect(config).toEqual(["config", "G-TEST123", { send_page_view: false }]);
    });

    it("?trafic_interne=1 marque ce navigateur et retire le paramètre de l'adresse, en gardant le reste", () => {
      window.history.replaceState(null, "", "/landing?ref=pub&trafic_interne=1#tarifs");

      appliquerInterrupteurTraficInterne();

      expect(estTraficInterne()).toBe(true);
      expect(window.location.pathname + window.location.search + window.location.hash).toBe("/landing?ref=pub#tarifs");
    });

    it("une fois marqué, le tag de configuration envoie traffic_type=internal, que Google range dans le trafic interne", () => {
      vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
      window.history.replaceState(null, "", "/?trafic_interne=1");
      appliquerInterrupteurTraficInterne();

      loadGoogleAnalytics();

      const config = lireAppels().find((appel) => appel[0] === "config");
      expect(config).toEqual(["config", "G-TEST123", { send_page_view: false, traffic_type: "internal" }]);
    });

    it("la marque survit à la navigation : elle est relue du stockage, pas de l'adresse", () => {
      window.history.replaceState(null, "", "/?trafic_interne=1");
      appliquerInterrupteurTraficInterne();
      window.history.replaceState(null, "", "/login");

      expect(estTraficInterne()).toBe(true);
    });

    it("?trafic_interne=0 retire la marque", () => {
      localStorage.setItem("trafic_interne", "1");
      window.history.replaceState(null, "", "/?trafic_interne=0");

      appliquerInterrupteurTraficInterne();

      expect(estTraficInterne()).toBe(false);
      expect(window.location.search).toBe("");
    });

    it("sans paramètre, ne touche ni à la marque ni à l'adresse", () => {
      localStorage.setItem("trafic_interne", "1");
      window.history.replaceState(null, "", "/landing?ref=pub");

      appliquerInterrupteurTraficInterne();

      expect(estTraficInterne()).toBe(true);
      expect(window.location.search).toBe("?ref=pub");
    });

    it("une valeur inconnue est ignorée : ni marque, ni adresse modifiée", () => {
      window.history.replaceState(null, "", "/?trafic_interne=peut-etre");

      appliquerInterrupteurTraficInterne();

      expect(estTraficInterne()).toBe(false);
      expect(window.location.search).toBe("?trafic_interne=peut-etre");
    });

    it("un stockage indisponible ne casse rien : pas de marque, pas d'exception", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("stockage bloqué");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("stockage bloqué");
      });
      window.history.replaceState(null, "", "/?trafic_interne=1");

      expect(() => appliquerInterrupteurTraficInterne()).not.toThrow();
      expect(estTraficInterne()).toBe(false);
    });
  });
});
