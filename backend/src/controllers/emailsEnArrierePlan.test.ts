import * as Sentry from "@sentry/node";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import * as emailService from "../services/email.service";
import { createManager } from "../test/authHelpers";
import { enArrierePlan } from "../utils/arrierePlan";

// Le reste de Sentry reste réel : l'application s'en sert au démarrage (setupExpressErrorHandler).
vi.mock("@sentry/node", async (importOriginal) => ({ ...(await importOriginal<typeof import("@sentry/node")>()), captureException: vi.fn() }));

/**
 * Production, 26 octobre 2026 : « mot de passe oublié » posait bien son jeton en base, répondait 200, mais l'e-mail
 * n'arrivait jamais — et rien n'apparaissait dans les journaux, ni succès ni échec.
 *
 * Cause : l'envoi était lancé « en arrière-plan », sans `await`, pour que la réponse ne dépende pas de sa durée (sans
 * quoi une adresse connue répondrait plus lentement qu'une adresse inconnue : fuite d'énumération). En local, Node
 * finit ce travail. Sur Vercel, une fonction peut être figée dès que la réponse est partie : l'envoi SMTP, en cours de
 * route, n'aboutit jamais. Vercel fournit pour cela `waitUntil`, qui prolonge la vie de la fonction jusqu'à la fin de la
 * promesse sans retarder la réponse. Il est lu dans le contexte de requête que Vercel place dans un symbole global.
 */
const CONTEXTE_VERCEL = Symbol.for("@vercel/request-context");
const global_ = globalThis as unknown as Record<symbol, unknown>;

/** Un contrôle manuel de la promesse d'envoi : on décide quand « SMTP » répond. */
function envoiManuel() {
  let terminer!: (valeur: { simulated: boolean }) => void;
  let echouer!: (erreur: Error) => void;
  const promesse = new Promise<{ simulated: boolean }>((resolve, reject) => {
    terminer = resolve;
    echouer = reject;
  });
  const espion = vi.spyOn(emailService, "sendEmail").mockImplementation(() => promesse as never);
  return { espion, terminer, echouer };
}

describe("enArrierePlan", () => {
  afterEach(() => {
    delete global_[CONTEXTE_VERCEL];
  });

  it("confie la promesse à waitUntil de Vercel, pour que la fonction vive jusqu'à sa fin", () => {
    const recues: Promise<unknown>[] = [];
    global_[CONTEXTE_VERCEL] = { get: () => ({ waitUntil: (p: Promise<unknown>) => recues.push(p) }) };
    const promesse = Promise.resolve(1);

    enArrierePlan(promesse);

    expect(recues).toEqual([promesse]);
  });

  it("ne fait rien hors de Vercel (local, tests) : la promesse continue seule, sans erreur", () => {
    expect(() => enArrierePlan(Promise.resolve(1))).not.toThrow();
  });

  it("ne fait jamais échouer la requête, même si le contexte de Vercel se comporte mal", () => {
    global_[CONTEXTE_VERCEL] = {
      get: () => {
        throw new Error("contexte indisponible");
      },
    };
    expect(() => enArrierePlan(Promise.resolve(1))).not.toThrow();

    global_[CONTEXTE_VERCEL] = { get: () => ({ waitUntil: "pas une fonction" }) };
    expect(() => enArrierePlan(Promise.resolve(1))).not.toThrow();
  });
});

describe("envois d'e-mails lancés en arrière-plan : la fonction est maintenue en vie", () => {
  let confiees: Promise<unknown>[];

  beforeEach(() => {
    confiees = [];
    global_[CONTEXTE_VERCEL] = { get: () => ({ waitUntil: (p: Promise<unknown>) => confiees.push(p) }) };
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    delete global_[CONTEXTE_VERCEL];
    vi.restoreAllMocks();
  });

  it.each([
    ["mot de passe oublié", "/api/auth/forgot-password", () => createManager({ email: "oubli-ap@test.local" }), "oubli-ap@test.local"],
    ["renvoi du lien de confirmation", "/api/auth/resend-verification", () => createManager({ email: "renvoi-ap@test.local", emailVerifiedAt: null }), "renvoi-ap@test.local"],
  ])("%s : la réponse part sans attendre l'envoi, et l'envoi est confié à waitUntil", async (_nom, route, creer, email) => {
    await creer();
    const { espion, terminer } = envoiManuel();

    const res = await request(app).post(route).send({ email });

    // Réponse rendue alors que l'envoi n'est pas fini : un temps de réponse identique pour une adresse inconnue.
    expect(res.status).toBe(200);
    expect(espion).toHaveBeenCalledTimes(1);
    expect(confiees).toHaveLength(1);
    let fini = false;
    void confiees[0].then(() => (fini = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(fini).toBe(false);

    // Quand « SMTP » répond, la promesse confiée à Vercel se termine.
    terminer({ simulated: false });
    await confiees[0];
    expect(fini).toBe(true);
  });

  it.each([
    ["mot de passe oublié", "/api/auth/forgot-password"],
    ["renvoi du lien de confirmation", "/api/auth/resend-verification"],
  ])("%s : une adresse inconnue ne déclenche ni envoi ni attente", async (_nom, route) => {
    const { espion } = envoiManuel();
    const res = await request(app).post(route).send({ email: "inconnu@test.local" });
    expect(res.status).toBe(200);
    expect(espion).not.toHaveBeenCalled();
    expect(confiees).toHaveLength(0);
  });

  it("un envoi qui échoue est journalisé, et la promesse confiée à Vercel ne se termine pas en erreur", async () => {
    await createManager({ email: "echec-ap@test.local" });
    const { echouer } = envoiManuel();

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "echec-ap@test.local" });
    expect(res.status).toBe(200);

    echouer(new Error("SMTP indisponible"));
    await expect(confiees[0]).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), { tags: { source: "auth.controller.forgotPassword" } });
  });
});
