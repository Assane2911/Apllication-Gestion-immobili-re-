import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { tenants } from "../db/schema";
import { authHeader, createManager, createPortalUser, createTenant, tokenFor } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * L'écran des échéances est la contrepartie d'un choix : le Service ne détruit
 * pas les données locatives de ses clients. Pour elles, le Gestionnaire est
 * responsable de traitement et le Service sous-traitant ; un sous-traitant qui
 * effacerait de sa propre initiative sortirait de son rôle, et la règle de
 * durée dépend de faits que la plateforme ignore — gestion directe ou
 * déléguée, litige en cours qui suspend l'effacement.
 *
 * La route est donc en lecture seule, par construction, et ces tests
 * verrouillent cette propriété autant que son contenu.
 */
describe("GET /api/conservation/echeances", () => {
  it("renvoie les fiches concernées au gestionnaire connecté", async () => {
    const manager = await createManager();
    await createTenant(manager.id, {
      lastName: "Ancien",
      createdAt: new Date(Date.now() - 200 * 24 * 3_600_000),
    });

    const res = await request(app)
      .get("/api/conservation/echeances")
      .set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.fichesSansBail).toHaveLength(1);
    expect(res.body.total).toBe(1);
    // Les durées voyagent avec le résultat : l'écran doit pouvoir dire
    // POURQUOI une fiche est signalée, pas seulement qu'elle l'est.
    expect(res.body.durees.ficheSansBailJours).toBe(90);
  });

  it("ne supprime rien — c'est une lecture", async () => {
    const manager = await createManager();
    const tenant = await createTenant(manager.id, {
      createdAt: new Date(Date.now() - 200 * 24 * 3_600_000),
    });

    await request(app).get("/api/conservation/echeances").set(authHeader(tokenFor(manager)));

    const restant = await testDb.select().from(tenants);
    expect(restant).toHaveLength(1);
    expect(restant[0].id).toBe(tenant.id);
    expect(restant[0].anonymizedAt).toBeNull();
  });

  it("n'expose aucune donnée d'une autre agence", async () => {
    const manager = await createManager();
    const autre = await createManager();
    await createTenant(autre.id, {
      lastName: "AutreAgence",
      createdAt: new Date(Date.now() - 200 * 24 * 3_600_000),
    });

    const res = await request(app)
      .get("/api/conservation/echeances")
      .set(authHeader(tokenFor(manager)));

    expect(res.body.total).toBe(0);
  });

  it("refuse l'accès à un locataire", async () => {
    const locataire = await createPortalUser("TENANT");

    const res = await request(app)
      .get("/api/conservation/echeances")
      .set(authHeader(tokenFor(locataire)));

    expect(res.status).toBe(403);
  });

  it("n'offre aucun verbe destructeur sur cette route", async () => {
    // Le jour où quelqu'un voudra « juste ajouter un bouton purger », il
    // devra passer par ce test.
    const manager = await createManager();
    const entete = authHeader(tokenFor(manager));

    for (const appel of [
      request(app).post("/api/conservation/echeances").set(entete),
      request(app).delete("/api/conservation/echeances").set(entete),
    ]) {
      const res = await appel;
      expect(res.status).toBe(404);
    }
  });
});
