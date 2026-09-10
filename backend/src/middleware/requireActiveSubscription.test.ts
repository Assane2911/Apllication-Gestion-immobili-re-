import type { NextFunction, Request, Response } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { requireActiveSubscription } from "./auth";
import { createAdmin, createManager, createTenantPortalUser, createTenant, authHeader, tokenFor } from "../test/authHelpers";

// Ce middleware est le mécanisme réel qui bloque l'accès aux fonctionnalités de
// gestion (biens, contrats, factures, etc.) quand la période d'essai de 10
// jours est terminée et qu'aucun abonnement payant n'est actif. Il est monté
// sur la quasi-totalité des routes gestionnaire (property, contract, invoice,
// tenant, dashboard, expense, issue, notification, agency, activityLog,
// search) et n'avait jusqu'ici aucun test : un bug ici casserait soit la
// barrière payante (accès gratuit illimité), soit bloquerait des
// gestionnaires payants légitimes.
describe("requireActiveSubscription", () => {
  describe("via une route gestionnaire réelle (GET /api/properties)", () => {
    it("autorise l'accès pendant une période d'essai valide", async () => {
      const manager = await createManager({
        subscriptionStatus: "TRIAL",
        trialEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      });
      const res = await request(app)
        .get("/api/properties")
        .set(authHeader(tokenFor(manager)));
      expect(res.status).toBe(200);
    });

    it("bloque (402) quand la période d'essai est terminée et qu'aucun abonnement n'est actif", async () => {
      const manager = await createManager({
        subscriptionStatus: "TRIAL",
        trialEndsAt: new Date(Date.now() - 1000),
      });
      const res = await request(app)
        .get("/api/properties")
        .set(authHeader(tokenFor(manager)));
      expect(res.status).toBe(402);
      expect(res.body.error).toMatch(/période d'essai de 10 jours est terminée/);
    });

    it("autorise l'accès avec un abonnement actif dont la date de fin est future", async () => {
      const manager = await createManager({
        subscriptionStatus: "ACTIVE",
        subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
      const res = await request(app)
        .get("/api/properties")
        .set(authHeader(tokenFor(manager)));
      expect(res.status).toBe(200);
    });

    it("bloque (402) un abonnement marqué ACTIVE en base dont la date de fin est déjà passée", async () => {
      // Le statut en base peut être obsolète (ex: cron de désactivation pas encore
      // passé) : la date de fin fait foi, pas seulement le statut affiché.
      const manager = await createManager({
        subscriptionStatus: "ACTIVE",
        subscriptionEndsAt: new Date(Date.now() - 1000),
      });
      const res = await request(app)
        .get("/api/properties")
        .set(authHeader(tokenFor(manager)));
      expect(res.status).toBe(402);
    });

    it("autorise l'accès avec un abonnement actif sans date de fin (accès à vie)", async () => {
      const manager = await createManager({
        subscriptionStatus: "ACTIVE",
        subscriptionEndsAt: null,
      });
      const res = await request(app)
        .get("/api/properties")
        .set(authHeader(tokenFor(manager)));
      expect(res.status).toBe(200);
    });

    it("bloque (402) un abonnement CANCELLED même avec une ancienne date de fin future", async () => {
      const manager = await createManager({
        subscriptionStatus: "CANCELLED",
        subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
      const res = await request(app)
        .get("/api/properties")
        .set(authHeader(tokenFor(manager)));
      expect(res.status).toBe(402);
    });

    it("bloque (402) un abonnement EXPIRED", async () => {
      const manager = await createManager({
        subscriptionStatus: "EXPIRED",
        trialEndsAt: null,
        subscriptionEndsAt: null,
      });
      const res = await request(app)
        .get("/api/properties")
        .set(authHeader(tokenFor(manager)));
      expect(res.status).toBe(402);
    });

    it("renvoie 404 si l'utilisateur du token n'existe plus en base", async () => {
      const manager = await createManager();
      const token = tokenFor({ id: "utilisateur-supprime", role: "MANAGER" });
      const res = await request(app).get("/api/properties").set(authHeader(token));
      expect(res.status).toBe(404);
      // Le manager créé ne doit pas interférer : on vérifie juste qu'on ne
      // retombe pas sur un 200 accidentel via un mauvais filtrage.
      expect(manager.id).not.toBe("utilisateur-supprime");
    });
  });

  describe("appel direct de la fonction (bypass rôle non-gestionnaire)", () => {
    // Sur toutes les routes réelles, requireRole("MANAGER") est monté AVANT
    // requireActiveSubscription : un TENANT ou un ADMIN est donc toujours
    // rejeté par requireRole en premier, et la branche de bypass du
    // middleware ne peut jamais être observée via une vraie route HTTP.
    // On appelle donc la fonction directement pour isoler ce comportement.
    function fakeRes() {
      return {} as Response;
    }

    it("laisse passer un TENANT sans vérifier d'abonnement", async () => {
      const manager = await createManager();
      const tenant = await createTenant(manager.id);
      const tenantUser = await createTenantPortalUser(tenant);
      const req = { user: { userId: tenantUser.id, role: "TENANT" as const, tenantId: tenant.id } } as Request;
      const next = vi.fn();

      await requireActiveSubscription(req, fakeRes(), next as unknown as NextFunction);

      expect(next).toHaveBeenCalledWith(); // appelé sans erreur, pas d'ApiError
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("laisse passer un ADMIN sans vérifier d'abonnement", async () => {
      const admin = await createAdmin();
      const req = { user: { userId: admin.id, role: "ADMIN" as const } } as Request;
      const next = vi.fn();

      await requireActiveSubscription(req, fakeRes(), next as unknown as NextFunction);

      expect(next).toHaveBeenCalledWith();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("rejette (401) une requête sans utilisateur authentifié", async () => {
      const req = {} as Request;
      const next = vi.fn();

      await requireActiveSubscription(req, fakeRes(), next as unknown as NextFunction);

      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0][0];
      expect(err).toBeDefined();
      expect(err.statusCode).toBe(401);
    });
  });
});
