import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetLinkedInStateForTests, isLinkedInConfigured, loadLinkedInInsightTag } from "./linkedinInsight";

describe("linkedinInsight", () => {
  beforeEach(() => {
    _resetLinkedInStateForTests();
    document.head.querySelectorAll("script[src*='licdn']").forEach((el) => el.remove());
    delete window.lintrk;
    delete window._linkedin_partner_id;
    delete window._linkedin_data_partner_ids;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("n'est pas configuré sans VITE_LINKEDIN_PARTNER_ID", () => {
    vi.stubEnv("VITE_LINKEDIN_PARTNER_ID", "");
    expect(isLinkedInConfigured()).toBe(false);
  });

  it("est configuré quand VITE_LINKEDIN_PARTNER_ID est défini", () => {
    vi.stubEnv("VITE_LINKEDIN_PARTNER_ID", "1234567");
    expect(isLinkedInConfigured()).toBe(true);
  });

  it("ne charge aucun script si aucun ID n'est configuré", () => {
    vi.stubEnv("VITE_LINKEDIN_PARTNER_ID", "");
    loadLinkedInInsightTag();
    expect(document.head.querySelector("script[src*='licdn']")).toBeNull();
    expect(window.lintrk).toBeUndefined();
  });

  it("charge l'Insight Tag avec le bon ID de partenaire une fois configuré", () => {
    vi.stubEnv("VITE_LINKEDIN_PARTNER_ID", "1234567");
    loadLinkedInInsightTag();

    const script = document.head.querySelector("script[src*='licdn']");
    expect(script).not.toBeNull();
    expect(window._linkedin_partner_id).toBe("1234567");
    expect(window._linkedin_data_partner_ids).toEqual(["1234567"]);
    expect(window.lintrk).toBeTypeOf("function");
  });

  it("ne charge le script qu'une seule fois même appelé plusieurs fois", () => {
    vi.stubEnv("VITE_LINKEDIN_PARTNER_ID", "1234567");
    loadLinkedInInsightTag();
    loadLinkedInInsightTag();
    expect(document.head.querySelectorAll("script[src*='licdn']").length).toBe(1);
    expect(window._linkedin_data_partner_ids).toEqual(["1234567"]);
  });
});
