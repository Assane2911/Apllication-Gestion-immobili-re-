import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAvecDelai } from "./fetchAvecDelai";

/**
 * Un appel à un prestataire (Meta, Stripe, PayDunya) qui ne répond jamais ne doit pas bloquer la fonction
 * jusqu'à ce que Vercel la tue : le budget de temps du cron ne protège qu'ENTRE deux éléments.
 */
describe("fetchAvecDelai", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Un `fetch` qui n'aboutit jamais, sauf si on l'interrompt — comme une connexion qui se fige. */
  function fetchQuiSeFige() {
    return vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });
    });
  }

  it("interrompt un appel qui ne répond pas dans le délai imparti", async () => {
    vi.stubGlobal("fetch", fetchQuiSeFige());

    const debut = Date.now();
    await expect(fetchAvecDelai("https://exemple.test/lent", {}, 30)).rejects.toBeDefined();

    expect(Date.now() - debut).toBeLessThan(2000);
  });

  it("laisse passer un appel qui répond à temps, avec ses options intactes", async () => {
    const reponse = { ok: true, status: 200 } as Response;
    const fetchMock = vi.fn().mockResolvedValue(reponse);
    vi.stubGlobal("fetch", fetchMock);

    const resultat = await fetchAvecDelai("https://exemple.test/ok", { method: "POST", body: "x" }, 5000);

    expect(resultat).toBe(reponse);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://exemple.test/ok");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("x");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("applique par défaut un délai inférieur à la marge laissée par le budget du cron (300 s − 240 s)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);
    const { DELAI_APPEL_EXTERNE_MS } = await import("./fetchAvecDelai");

    expect(DELAI_APPEL_EXTERNE_MS).toBeGreaterThan(0);
    expect(DELAI_APPEL_EXTERNE_MS).toBeLessThanOrEqual(20_000);
  });
});
