import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { db } from "../db/client";
import { users } from "../db/schema";
import { authHeader, createManager, createTeamMember, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import { ApiError } from "../utils/asyncHandler";
import { chargerCompteCourant } from "../utils/authorization";
import { requireActiveSubscription, requirePlan } from "./auth";

/**
 * Les refus de l'authentification que les autres tests n'exerçaient pas : un compte (ou un collaborateur) qui n'existe
 * plus, une requête sans identité, une panne de base pendant la vérification du jeton. Chacun doit répondre 401 (ou
 * échouer proprement) et jamais laisser passer : l'intercepteur du frontend ne vide la session que sur un 401.
 */

/** Une requête minimale : seuls `user` et `compteCourant` comptent pour ces gardes. */
const requete = (champs: Record<string, unknown>) => champs as unknown as Request;

/** Appelle un middleware et renvoie ce qu'il a passé à `next` (l'erreur, ou rien). */
async function suite(middleware: (req: Request, res: Response, next: NextFunction) => unknown, req: Request): Promise<unknown> {
  let recu: unknown = "next non appelé";
  await middleware(req, {} as Response, ((e?: unknown) => {
    recu = e;
  }) as NextFunction);
  return recu;
}

describe("chargerCompteCourant", () => {
  it("refuse (401 AUTH_REQUIRED) une requête sans identité", async () => {
    await expect(chargerCompteCourant(requete({}))).rejects.toMatchObject({ statusCode: 401, code: "AUTH_REQUIRED" });
  });

  it("relit le compte quand la requête n'est pas passée par authenticate (repli)", async () => {
    const manager = await createManager();

    const compte = await chargerCompteCourant(requete({ user: { userId: manager.id, role: "MANAGER" } }));

    expect(compte.id).toBe(manager.id);
  });

  it("refuse (401 ACCOUNT_GONE) un compte supprimé, pour que le frontend vide la session", async () => {
    const manager = await createManager();
    await testDb.delete(users).where(eq(users.id, manager.id));

    await expect(chargerCompteCourant(requete({ user: { userId: manager.id, role: "MANAGER" } }))).rejects.toMatchObject({
      statusCode: 401,
      code: "ACCOUNT_GONE",
    });
  });
});

describe("requireActiveSubscription et requirePlan : sans identité ou sans compte chargé", () => {
  it("requireActiveSubscription refuse (401) une requête sans identité", async () => {
    const erreur = (await suite(requireActiveSubscription, requete({}))) as ApiError;
    expect(erreur).toMatchObject({ statusCode: 401, code: "AUTH_REQUIRED" });
  });

  it("requireActiveSubscription refuse (401 ACCOUNT_GONE) un gestionnaire dont le compte n'a pas été chargé", async () => {
    const erreur = (await suite(requireActiveSubscription, requete({ user: { userId: "x", role: "MANAGER" } }))) as ApiError;
    expect(erreur).toMatchObject({ statusCode: 401, code: "ACCOUNT_GONE" });
  });

  it("requireActiveSubscription laisse passer un locataire sans rien charger (il doit pouvoir payer)", async () => {
    expect(await suite(requireActiveSubscription, requete({ user: { userId: "x", role: "TENANT" } }))).toBeUndefined();
  });

  it("requirePlan refuse (401) une requête sans identité", async () => {
    const erreur = (await suite(requirePlan("PRO"), requete({}))) as ApiError;
    expect(erreur).toMatchObject({ statusCode: 401, code: "AUTH_REQUIRED" });
  });

  it("requirePlan refuse (401 ACCOUNT_GONE) un gestionnaire dont le compte n'a pas été chargé", async () => {
    const erreur = (await suite(requirePlan("PRO"), requete({ user: { userId: "x", role: "MANAGER" } }))) as ApiError;
    expect(erreur).toMatchObject({ statusCode: 401, code: "ACCOUNT_GONE" });
  });

  it("requirePlan ne s'applique pas à un autre rôle que gestionnaire", async () => {
    expect(await suite(requirePlan("PRO"), requete({ user: { userId: "x", role: "TENANT" } }))).toBeUndefined();
  });
});

describe("authenticate : cas où le compte a disparu ou la base est en panne", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuse (401 ACCOUNT_GONE) un jeton de collaborateur dont le compte a été supprimé, alors que l'agence existe", async () => {
    const proprietaire = await createManager();
    const collaborateur = await createTeamMember(proprietaire.id);
    const jeton = tokenFor({ id: proprietaire.id, role: "MANAGER" }, null, null, collaborateur.id);
    await testDb.delete(users).where(eq(users.id, collaborateur.id));

    const res = await request(app).get("/api/properties").set(authHeader(jeton));

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("ACCOUNT_GONE");
  });

  it("répond 500 et ne laisse jamais passer quand la base tombe pendant la vérification du jeton", async () => {
    const manager = await createManager();
    const jeton = tokenFor({ id: manager.id, role: "MANAGER" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "select").mockImplementation((() => {
      throw new Error("Base indisponible");
    }) as unknown as typeof db.select);

    const res = await request(app).get("/api/properties").set(authHeader(jeton));

    expect(res.status).toBe(500);
    expect(res.body).not.toHaveProperty("items");
  });
});
