import { afterEach, describe, expect, it, vi } from "vitest";
import { creerFetchAvecDelai } from "./fetchStockage";

/**
 * Le stockage de fichiers (Supabase Storage) est appelé par un client dont le `fetch` n'a aucun délai propre : un
 * stockage dont la connexion se fige laissait la requête attendre jusqu'à ce que Vercel tue la fonction (300 s) — un
 * dépôt de photo qui ne finit jamais, une suppression de compte bloquée à mi-chemin. Ce `fetch` borné rend la main
 * au bout d'un délai : l'appelant reçoit une erreur ordinaire, qu'il sait déjà traiter.
 */
afterEach(() => vi.unstubAllGlobals());

/** Un fetch qui ne répond jamais, et ne se termine que si on l'interrompt. */
function fetchFige() {
  return vi.fn((_url: unknown, init?: RequestInit) => {
    return new Promise<Response>((_resolve, rejeter) => {
      init?.signal?.addEventListener("abort", () => rejeter(init.signal?.reason));
    });
  });
}

describe("fetch du stockage avec délai", () => {
  it("interrompt un appel qui ne répond pas, au bout du délai", async () => {
    vi.stubGlobal("fetch", fetchFige());
    const debut = Date.now();
    await expect(creerFetchAvecDelai(60)("https://stockage.test/objet")).rejects.toBeTruthy();
    expect(Date.now() - debut).toBeLessThan(1000);
  });

  it("laisse passer une réponse normale, sans la modifier", async () => {
    const reponse = new Response("ok", { status: 200 });
    vi.stubGlobal("fetch", vi.fn(async () => reponse));
    await expect(creerFetchAvecDelai(5_000)("https://stockage.test/objet")).resolves.toBe(reponse);
  });

  it("garde l'interruption demandée par l'appelant : elle coupe l'appel sans attendre le délai", async () => {
    vi.stubGlobal("fetch", fetchFige());
    const controle = new AbortController();
    const appel = creerFetchAvecDelai(60_000)("https://stockage.test/objet", { signal: controle.signal });
    controle.abort(new Error("annulé par l'appelant"));
    await expect(appel).rejects.toThrow("annulé par l'appelant");
  });

  it("transmet la méthode, les en-têtes et le corps tels quels", async () => {
    const espion = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", espion);
    await creerFetchAvecDelai(5_000)("https://stockage.test/objet", { method: "POST", headers: { "x-test": "1" }, body: "contenu" });
    const [, init] = espion.mock.calls[0] as unknown as [unknown, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "x-test": "1" });
    expect(init.body).toBe("contenu");
  });
});
