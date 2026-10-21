import { describe, expect, it } from "vitest";
import { formaterDateHeure } from "./dateHeure";

describe("formaterDateHeure", () => {
  it("donne la date ET l'heure, dans la langue demandée", () => {
    expect(formaterDateHeure("2026-10-21T15:07:48.385Z", "fr", "UTC")).toBe("21/10/2026 15:07");
    expect(formaterDateHeure("2026-10-21T15:07:48.385Z", "en", "UTC")).toMatch(/10\/21\/26.*3:07\s?PM/);
  });

  it("respecte le fuseau demandé (même instant, heure locale différente)", () => {
    expect(formaterDateHeure("2026-10-21T15:07:00Z", "fr", "Africa/Dakar")).toBe("21/10/2026 15:07");
    expect(formaterDateHeure("2026-10-21T15:07:00Z", "fr", "Europe/Paris")).toBe("21/10/2026 17:07");
  });

  it("laisse passer minuit : l'heure change le jour affiché", () => {
    expect(formaterDateHeure("2026-10-21T23:30:00Z", "fr", "Europe/Paris")).toBe("22/10/2026 01:30");
  });
});
