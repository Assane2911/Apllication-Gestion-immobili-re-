import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "./app";

describe("En-têtes de sécurité HTTP (helmet)", () => {
  it("applique les en-têtes de sécurité standards sur toute réponse", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-dns-prefetch-control"]).toBe("off");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    // "X-Powered-By: Express" ne doit jamais être exposé (aide un attaquant à cibler des failles connues d'Express).
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("applique une Content-Security-Policy stricte (interdit les scripts, autorise les styles inline pour les documents)", async () => {
    const res = await request(app).get("/api/health");

    expect(res.headers["content-security-policy"]).toBeDefined();
    expect(res.headers["content-security-policy"]).toContain("script-src 'none'");
    expect(res.headers["content-security-policy"]).toContain("style-src 'self' 'unsafe-inline'");
  });
});
