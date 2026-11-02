import { describe, expect, it, vi } from "vitest";
import { estNouvelleVersion, lireVersionPubliee } from "./versionPubliee";

const reponse = (corps: unknown, ok = true) => ({ ok, json: async () => corps }) as Response;

describe("lireVersionPubliee", () => {
  it("lit l'identifiant publié, en demandant toujours une réponse fraîche", async () => {
    const chercher = vi.fn().mockResolvedValue(reponse({ version: "abc123" }));
    expect(await lireVersionPubliee(chercher as unknown as typeof fetch)).toBe("abc123");
    const [url, options] = chercher.mock.calls[0];
    expect(url).toMatch(/^\/version\.json\?t=\d+$/);
    expect(options).toMatchObject({ cache: "no-store" });
  });

  it("ne se fie à rien d'autre qu'un identifiant : erreur serveur, page HTML, corps vide, mauvais type", async () => {
    const lire = (r: Response | Error) => lireVersionPubliee((r instanceof Error ? vi.fn().mockRejectedValue(r) : vi.fn().mockResolvedValue(r)) as unknown as typeof fetch);
    expect(await lire(reponse({ version: "x" }, false))).toBeNull();
    // Le site renvoie index.html pour une adresse inconnue : ce n'est pas du JSON.
    expect(await lire({ ok: true, json: async () => { throw new SyntaxError("Unexpected token <"); } } as unknown as Response)).toBeNull();
    expect(await lire(reponse(null))).toBeNull();
    expect(await lire(reponse({}))).toBeNull();
    expect(await lire(reponse({ version: "  " }))).toBeNull();
    expect(await lire(reponse({ version: 42 }))).toBeNull();
    expect(await lire(new TypeError("Failed to fetch"))).toBeNull();
  });
});

describe("estNouvelleVersion", () => {
  it("vrai seulement quand l'identifiant publié diffère de celui de l'onglet", () => {
    expect(estNouvelleVersion("abc", "def")).toBe(true);
    expect(estNouvelleVersion("abc", "abc")).toBe(false);
  });
  it("jamais sans réponse exploitable, ni en développement", () => {
    expect(estNouvelleVersion("abc", null)).toBe(false);
    expect(estNouvelleVersion("dev", "def")).toBe(false);
  });
});
