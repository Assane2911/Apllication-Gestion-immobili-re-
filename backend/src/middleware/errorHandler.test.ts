import * as Sentry from "@sentry/node";
import type { NextFunction, Request, Response } from "express";
import request from "supertest";
import { z, ZodError } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { ApiError } from "../utils/asyncHandler";
import { errorHandler, notFoundHandler } from "./errorHandler";

// errorHandler est le point de passage unique de TOUTES les erreurs de l'API
// vers une réponse HTTP. Il porte deux contrats jamais vérifiés jusqu'ici :
// une erreur de validation est la faute du client (400) et non du serveur
// (500), et le message brut d'une erreur inattendue ne doit JAMAIS être
// renvoyé au client — il peut contenir un nom de colonne, une contrainte SQL
// ou un chemin de fichier.

// setupTestDb.ts stub déjà @sentry/node (le SDK réel est incompatible avec le
// module runner de Vitest), mais avec de simples fonctions vides. On le
// remplace ici par des espions, pour vérifier que le flush est bien attendu
// AVANT la réponse — le correctif du bug d'événements Sentry perdus en
// serverless.
vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  setupExpressErrorHandler: vi.fn(),
  flush: vi.fn(),
}));

function fakeRes() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

const fakeReq = { method: "GET", path: "/api/test" } as Request;
const noop = vi.fn() as unknown as NextFunction;

/** Produit une vraie ZodError, plutôt que d'en simuler la forme à la main. */
function zodErrorFor(schema: z.ZodTypeAny, value: unknown): ZodError {
  const result = schema.safeParse(value);
  if (result.success) throw new Error("le schéma aurait dû rejeter cette valeur");
  return result.error;
}

describe("errorHandler", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(Sentry.flush).mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("traduit une erreur de validation Zod en 400 (faute du client) et non en 500", async () => {
    const schema = z.object({ email: z.string().email() });
    const res = fakeRes();

    await errorHandler(zodErrorFor(schema, { email: "pas-un-email" }), fakeReq, res, noop);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.error).toContain("champ concerné : email");
  });

  it("accorde le pluriel et liste tous les champs en cause", async () => {
    const schema = z.object({ email: z.string().email(), rent: z.number() });
    const res = fakeRes();

    await errorHandler(zodErrorFor(schema, { email: "x", rent: "beaucoup" }), fakeReq, res, noop);

    const body = res.json.mock.calls[0][0];
    expect(body.error).toContain("champs concernés : email, rent");
  });

  it("n'ajoute aucun suffixe de champ quand l'erreur Zod ne porte sur aucun champ nommé", async () => {
    const schema = z.string();
    const res = fakeRes();

    await errorHandler(zodErrorFor(schema, 42), fakeReq, res, noop);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.error).toBe("Requête invalide : données manquantes ou incorrectes.");
  });

  it("respecte le statut et le message d'une ApiError métier", async () => {
    const res = fakeRes();

    await errorHandler(new ApiError(402, "Votre période d'essai est terminée."), fakeReq, res, noop);

    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith({ error: "Votre période d'essai est terminée." });
  });

  it("transmet le code d'erreur d'une ApiError quand il est renseigné, et l'omet sinon", async () => {
    const avecCode = fakeRes();
    await errorHandler(new ApiError(409, "Email déjà utilisé", "EMAIL_TAKEN"), fakeReq, avecCode, noop);
    expect(avecCode.json).toHaveBeenCalledWith({ error: "Email déjà utilisé", code: "EMAIL_TAKEN" });

    const sansCode = fakeRes();
    await errorHandler(new ApiError(409, "Email déjà utilisé"), fakeReq, sansCode, noop);
    expect(sansCode.json.mock.calls[0][0]).not.toHaveProperty("code");
  });

  it("ne divulgue jamais le message brut d'une erreur inattendue au client", async () => {
    const res = fakeRes();
    const fuite = new Error(
      'duplicate key value violates unique constraint "users_email_unique" at C:\\app\\src\\db\\client.ts'
    );

    await errorHandler(fuite, fakeReq, res, noop);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Erreur interne du serveur" });
    const body = JSON.stringify(res.json.mock.calls[0][0]);
    expect(body).not.toContain("users_email_unique");
    expect(body).not.toContain("client.ts");
    // Le détail complet reste disponible dans les logs serveur pour le débogage.
    expect(console.error).toHaveBeenCalledWith(fuite);
  });

  it("répond 500 générique même si la valeur levée n'est pas une Error", async () => {
    const res = fakeRes();

    await errorHandler({ secretInterne: "mot-de-passe-admin" }, fakeReq, res, noop);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Erreur interne du serveur" });
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain("mot-de-passe-admin");
  });

  it("attend la fin de l'envoi vers Sentry avant de répondre (contexte serverless)", async () => {
    // Sur Vercel, l'exécution peut s'arrêter juste après la réponse : si le
    // flush n'était pas attendu, l'événement Sentry serait perdu.
    const flush = vi.mocked(Sentry.flush);
    const res = fakeRes();

    await errorHandler(new ApiError(500, "Boom"), fakeReq, res, noop);

    expect(flush).toHaveBeenCalledWith(2000);
    expect(flush.mock.invocationCallOrder[0]).toBeLessThan(res.json.mock.invocationCallOrder[0]);
  });

  it("répond quand même si l'envoi vers Sentry échoue", async () => {
    vi.mocked(Sentry.flush).mockRejectedValue(new Error("Sentry injoignable"));
    const res = fakeRes();

    await errorHandler(new ApiError(503, "Service de paiement indisponible"), fakeReq, res, noop);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: "Service de paiement indisponible" });
  });

  it("ne journalise ni n'attend Sentry pour une erreur métier attendue (4xx)", async () => {
    // Un 401 sur chaque requête non authentifiée, un 404 sur chaque ressource
    // absente : ce sont des réponses normales de l'API. Les journaliser comme
    // des pannes noyait les vraies erreurs dans les logs de production, et
    // attendre un flush Sentry qui n'a rien à envoyer (le prédicat
    // shouldReportToSentry les écarte) ralentissait la réponse pour rien.
    const res = fakeRes();

    await errorHandler(new ApiError(401, "Authentification requise"), fakeReq, res, noop);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Authentification requise" });
    expect(console.error).not.toHaveBeenCalled();
    expect(vi.mocked(Sentry.flush)).not.toHaveBeenCalled();
  });

  it("journalise et attend Sentry pour une ApiError serveur (5xx)", async () => {
    // À l'inverse, un 5xx explicite signale bien un défaut de l'application :
    // il doit rester tracé et remonté.
    const res = fakeRes();

    await errorHandler(new ApiError(500, "Échec de la génération du document"), fakeReq, res, noop);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(console.error).toHaveBeenCalled();
    expect(vi.mocked(Sentry.flush)).toHaveBeenCalledWith(2000);
  });

  it("ne notifie pas Sentry pour une simple erreur de validation", async () => {
    const flush = vi.mocked(Sentry.flush);
    const res = fakeRes();

    await errorHandler(zodErrorFor(z.object({ email: z.string() }), {}), fakeReq, res, noop);

    expect(flush).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("notFoundHandler", () => {
  it("renvoie 404 en précisant la méthode et le chemin demandés", () => {
    const res = fakeRes();

    notFoundHandler({ method: "POST", path: "/api/inconnu" } as Request, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Route introuvable: POST /api/inconnu" });
  });

  it("est bien branché sur l'application pour toute route inconnue", async () => {
    const response = await request(app).get("/api/route-qui-nexiste-pas");

    expect(response.status).toBe(404);
    expect(response.body.error).toContain("Route introuvable");
  });
});
