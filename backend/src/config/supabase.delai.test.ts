import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Le client Supabase Storage doit recevoir le `fetch` borné (voir utils/fetchStockage.ts). Les autres tests remplacent
 * ../config/supabase par un stub : celui-ci charge le vrai fichier (`importActual`) pour vérifier ce qu'il passe à
 * `createClient`.
 */
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn(() => ({ storage: {} })) }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

let options: { global?: { fetch?: typeof fetch } };

// Le module est évalué une seule fois : on relève ce qu'il a passé à createClient à ce moment-là.
beforeAll(async () => {
  await vi.importActual("./supabase");
  options = (createClient.mock.calls[0] as unknown[])[2] as typeof options;
});

describe("client Supabase", () => {
  it("est créé avec un fetch qui interrompt un stockage figé", () => {
    expect(typeof options.global?.fetch).toBe("function");
  });

  it("ce fetch pose un signal d'interruption sur chaque appel", async () => {
    const espion = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", espion);
    try {
      await options.global!.fetch!("https://stockage.test/objet");
      const [, init] = espion.mock.calls[0] as unknown as [unknown, RequestInit];
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.signal?.aborted).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
