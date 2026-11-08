import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetMetaPixelStateForTests, isMetaPixelConfigured, loadMetaPixel, trackMetaPageView } from "./metaPixel";

describe("metaPixel", () => {
  beforeEach(() => {
    _resetMetaPixelStateForTests();
    document.head.querySelectorAll("script[src*='fbevents']").forEach((el) => el.remove());
    delete window.fbq;
    delete window._fbq;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("n'est pas configuré sans VITE_META_PIXEL_ID", () => {
    vi.stubEnv("VITE_META_PIXEL_ID", "");
    expect(isMetaPixelConfigured()).toBe(false);
  });

  it("est configuré quand VITE_META_PIXEL_ID est défini", () => {
    vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
    expect(isMetaPixelConfigured()).toBe(true);
  });

  it("ne charge aucun script si aucun ID n'est configuré", () => {
    vi.stubEnv("VITE_META_PIXEL_ID", "");
    loadMetaPixel();
    expect(document.head.querySelector("script[src*='fbevents']")).toBeNull();
    expect(window.fbq).toBeUndefined();
  });

  it("charge fbevents.js et initialise le pixel avec le bon ID une fois configuré", () => {
    vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
    loadMetaPixel();

    const script = document.head.querySelector("script[src*='fbevents']");
    expect(script).not.toBeNull();
    expect(window.fbq).toBeTypeOf("function");
    expect(window.fbq!.queue).toEqual([
      ["consent", "grant"],
      ["init", "123456789"],
      ["track", "PageView"],
    ]);
  });

  // Même règle que Google Analytics : le site public est mesuré, l'application ne l'est pas. Le pixel envoie aussi des
  // mesures automatiques (clics sur les boutons, correspondance avancée) : seul « consent » les coupe.
  it("sur une page de l'application : mesure coupée avant l'initialisation, aucune vue de page", () => {
    vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
    loadMetaPixel("/dashboard");
    expect(window.fbq!.queue).toEqual([
      ["consent", "revoke"],
      ["init", "123456789"],
    ]);
  });

  it("rétablit la mesure en revenant sur une page publique, et la coupe en entrant dans l'application", () => {
    vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
    loadMetaPixel("/login");
    const depart = window.fbq!.queue!.length;

    trackMetaPageView("/dashboard");
    trackMetaPageView("/tenants");
    trackMetaPageView("/landing");

    expect(window.fbq!.queue!.slice(depart)).toEqual([
      ["consent", "revoke"],
      ["consent", "revoke"],
      ["consent", "grant"],
      ["track", "PageView"],
    ]);
  });

  it("ne mesure ni les pages à jeton (réinitialisation du mot de passe, vérification d'e-mail) ni les portails", () => {
    vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
    loadMetaPixel("/");
    const depart = window.fbq!.queue!.length;

    for (const chemin of ["/reinitialiser-mot-de-passe/abc", "/portail/paiements", "/admin"]) trackMetaPageView(chemin);

    expect(window.fbq!.queue!.slice(depart).filter((a) => (a as unknown[])[0] === "track")).toEqual([]);
  });

  it("ne charge le script qu'une seule fois même appelé plusieurs fois", () => {
    vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
    loadMetaPixel();
    loadMetaPixel();
    expect(document.head.querySelectorAll("script[src*='fbevents']").length).toBe(1);
  });

  it("trackMetaPageView n'a aucun effet tant que le pixel n'est pas chargé", () => {
    vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
    trackMetaPageView();
    expect(window.fbq).toBeUndefined();
  });

  it("trackMetaPageView envoie un événement PageView une fois le pixel chargé", () => {
    vi.stubEnv("VITE_META_PIXEL_ID", "123456789");
    loadMetaPixel();
    const appels = window.fbq!.queue!.length;

    trackMetaPageView();

    expect(window.fbq!.queue!.slice(appels)).toEqual([
      ["consent", "grant"],
      ["track", "PageView"],
    ]);
  });
});
