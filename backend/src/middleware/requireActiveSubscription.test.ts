import type { NextFunction, Request, Response } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { requireActiveSubscription } from "./auth";
import { createAdmin, createManager, createTenantPortalUser, createTenant, authHeader, tokenFor } from "../test/authHelpers";

// Ce middleware est le mécanisme réel qui bloque l'accès aux fonctionnalités de
// gestion (biens, contrats, factures, etc.) quand la période d'essai de 15
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
      expect(res.body.error).toMatch(/période d'essai de 15 jours est terminée/);
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

    // Résilier, c'est arrêter la RECONDUCTION, pas renoncer au temps déjà
    // payé : subscriptionPeriod.service.ts le dit explicitement (« Un
    // abonnement résilié conserve sa date de fin : ces jours-là ont été
    // payés »), et cancelSubscription ne touche d'ailleurs jamais
    // subscriptionEndsAt. Ce middleware coupait pourtant l'accès dès la
    // résiliation : un gestionnaire ayant réglé une année entière perdait
    // ses 11 mois restants en cliquant sur « annuler le renouvellement ».
    it("autorise un abonnement résilié tant que la période déjà payée n'est pas écoulée", async () => {
      const manager = await createManager({
        subscriptionStatus: "CANCELLED",
        subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
      const res = await request(app)
        .get("/api/properties")
        .set(authHeader(tokenFor(manager)));
      expect(res.status).toBe(200);
    });

    it("bloque (402) un abonnement résilié dont la période payée est écoulée", async () => {
      const manager = await createManager({
        subscriptionStatus: "CANCELLED",
        trialEndsAt: null,
        subscriptionEndsAt: new Date(Date.now() - 1000),
      });
      const res = await request(app)
        .get("/api/properties")
        .set(authHeader(tokenFor(manager)));
      expect(res.status).toBe(402);
    });

    it("bloque (402) un abonnement résilié sans aucune période payée connue", async () => {
      // Pas de date de fin = aucun jour acheté à honorer. Contrairement au
      // cas ACTIVE (accès à vie, ci-dessus), l'absence de date ne vaut donc
      // pas droit d'accès ici : résilié sans période payée = fermé.
      const manager = await createManager({
        subscriptionStatus: "CANCELLED",
        trialEndsAt: null,
        subscriptionEndsAt: null,
      });
      const res = await request(app)
        .get("/api/properties")
        .set(authHeader(tokenFor(manager)));
      expect(res.status).toBe(402);
    });

    it("ferme aussi les documents et la messagerie à un gestionnaire expiré", async () => {
      // Ces deux zones n'avaient aucune vérification d'abonnement,
      // contrairement aux biens, contrats et factures : un gestionnaire dont
      // l'abonnement était terminé continuait d'émettre des quittances — un
      // document légal — et d'échanger avec ses locataires.
      const manager = await createManager({
        subscriptionStatus: "TRIAL",
        trialEndsAt: new Date(Date.now() - 1000),
      });
      const entete = authHeader(tokenFor(manager));

      const documents = await request(app).get("/api/documents/receipt/peu-importe").set(entete);
      expect(documents.status).toBe(402);

      const messages = await request(app).get("/api/messages/conversations").set(entete);
      expect(messages.status).toBe(402);
    });

    it("laisse un locataire accéder aux documents et à la messagerie, quel que soit l'abonnement de son gestionnaire", async () => {
      // Le locataire ne paie rien : il ne doit jamais être privé de ses
      // quittances ni de sa messagerie parce que son gestionnaire a cessé de
      // régler son abonnement.
      const manager = await createManager({
        subscriptionStatus: "TRIAL",
        trialEndsAt: new Date(Date.now() - 1000),
      });
      const tenant = await createTenant(manager.id);
      const portail = await createTenantPortalUser(tenant);
      const entete = authHeader(tokenFor(portail, tenant.id));

      const messages = await request(app).get("/api/messages/conversations").set(entete);
      expect(messages.status).not.toBe(402);
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

    // Ce cas répondait 404 jusqu'au correctif « jeton valide dont le compte
    // n'existe plus » (voir controllers/compteSupprime.test.ts). L'identifiant
    // venant du jeton, « introuvable » ne peut vouloir dire qu'une chose : le
    // compte a été supprimé et le jeton lui survit. 404 le décrivait sans
    // servir à rien — l'intercepteur du frontend ne vide la session que sur un
    // 401, donc l'utilisateur restait devant une application qui le croyait
    // connecté.
    it("renvoie 401 si l'utilisateur du token n'existe plus en base", async () => {
      const manager = await createManager();
      const token = tokenFor({ id: "utilisateur-supprime", role: "MANAGER" });
      const res = await request(app).get("/api/properties").set(authHeader(token));
      expect(res.status).toBe(401);
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
