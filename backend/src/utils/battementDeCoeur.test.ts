import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signalerBattementDeCoeur } from "./battementDeCoeur";

/**
 * Rien ne prévenait si la tâche quotidienne cessait de tourner (cron Vercel désactivé, secret absent, déploiement
 * cassé) : une sonde d'accueil ne voit que ce qui répond, pas ce qui ne s'exécute pas. Après une exécution entièrement
 * réussie, la tâche signale sa réussite à une adresse de « battement de cœur » (une sonde externe qui alerte quand le
 * signal manque). Sans adresse configurée, rien ne se passe.
 *
 * L'adresse contient un jeton : elle ne doit jamais apparaître dans les journaux.
 */
const ADRESSE = "https://heartbeat.uptimerobot.com/m-jeton-tres-secret";

let fetchEspion: ReturnType<typeof vi.fn>;
let avertissements: string[];

beforeEach(() => {
  fetchEspion = vi.fn(async () => new Response("ok", { status: 200 }));
  vi.stubGlobal("fetch", fetchEspion);
  avertissements = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => void avertissements.push(args.join(" ")));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("battement de cœur de la tâche quotidienne", () => {
  it("ne fait rien sans adresse configurée", async () => {
    vi.stubEnv("CRON_HEARTBEAT_URL", "");
    await signalerBattementDeCoeur();
    expect(fetchEspion).not.toHaveBeenCalled();
  });

  it("appelle l'adresse configurée, une fois, avec un délai borné", async () => {
    vi.stubEnv("CRON_HEARTBEAT_URL", ADRESSE);
    await signalerBattementDeCoeur();
    expect(fetchEspion).toHaveBeenCalledTimes(1);
    const [url, init] = fetchEspion.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ADRESSE);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("refuse une adresse qui n'est pas en https, sans la citer", async () => {
    vi.stubEnv("CRON_HEARTBEAT_URL", "http://heartbeat.test/m-jeton-tres-secret");
    await signalerBattementDeCoeur();
    expect(fetchEspion).not.toHaveBeenCalled();
    expect(avertissements.join("\n")).not.toContain("jeton-tres-secret");
    expect(avertissements.length).toBeGreaterThan(0);
  });

  it("ne lève jamais d'erreur si la sonde ne répond pas, et ne cite pas l'adresse", async () => {
    vi.stubEnv("CRON_HEARTBEAT_URL", ADRESSE);
    fetchEspion.mockRejectedValueOnce(new Error(`connect ECONNREFUSED ${ADRESSE}`));
    await expect(signalerBattementDeCoeur()).resolves.toBeUndefined();
    expect(avertissements.join("\n")).not.toContain("jeton-tres-secret");
  });

  it("note, sans lever d'erreur, une réponse d'erreur de la sonde", async () => {
    vi.stubEnv("CRON_HEARTBEAT_URL", ADRESSE);
    fetchEspion.mockResolvedValueOnce(new Response("non", { status: 500 }));
    await expect(signalerBattementDeCoeur()).resolves.toBeUndefined();
    expect(avertissements.join("\n")).not.toContain("jeton-tres-secret");
    expect(avertissements.length).toBeGreaterThan(0);
  });
});
