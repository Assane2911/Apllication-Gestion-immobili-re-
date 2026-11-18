import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La tâche quotidienne n'émet son battement de cœur que lorsque TOUTES ses étapes ont réussi : une étape en échec, ou
 * une exécution qui n'a pas lieu, laisse le signal manquer et la sonde externe alerte.
 */
const { panne } = vi.hoisted(() => ({ panne: { active: false } }));
vi.mock("../services/conservation.service", async () => {
  const actual = await vi.importActual<typeof import("../services/conservation.service")>("../services/conservation.service");
  return {
    ...actual,
    purgerDonneesDeLaPlateforme: async () => {
      if (panne.active) throw new Error("panne simulée");
      return actual.purgerDonneesDeLaPlateforme();
    },
  };
});

import { app } from "../app";

const ADRESSE = "https://heartbeat.uptimerobot.com/m-jeton-tres-secret";
const lancer = () => request(app).get("/api/cron/daily").set({ Authorization: `Bearer ${process.env.CRON_SECRET}` });

let fetchEspion: ReturnType<typeof vi.fn>;
beforeEach(() => {
  panne.active = false;
  fetchEspion = vi.fn(async () => new Response("ok", { status: 200 }));
  vi.stubEnv("CRON_HEARTBEAT_URL", ADRESSE);
  vi.stubGlobal("fetch", fetchEspion);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const appelsDeLaSonde = () => fetchEspion.mock.calls.filter((c) => String(c[0]) === ADRESSE);

describe("/api/cron/daily — battement de cœur", () => {
  it("le signale après une exécution entièrement réussie", async () => {
    const res = await lancer();
    expect(res.status).toBe(200);
    expect(appelsDeLaSonde()).toHaveLength(1);
  });

  it("ne le signale pas quand une étape a échoué (la sonde alertera)", async () => {
    panne.active = true;
    const res = await lancer();
    expect(res.status).toBe(500);
    expect(appelsDeLaSonde()).toHaveLength(0);
  });

  it("n'appelle aucune sonde quand aucune adresse n'est configurée", async () => {
    vi.stubEnv("CRON_HEARTBEAT_URL", "");
    const res = await lancer();
    expect(res.status).toBe(200);
    expect(appelsDeLaSonde()).toHaveLength(0);
  });
});
