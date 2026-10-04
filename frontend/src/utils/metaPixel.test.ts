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
      ["init", "123456789"],
      ["track", "PageView"],
    ]);
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

    expect(window.fbq!.queue!.length).toBe(appels + 1);
    expect(window.fbq!.queue![appels]).toEqual(["track", "PageView"]);
  });
});
