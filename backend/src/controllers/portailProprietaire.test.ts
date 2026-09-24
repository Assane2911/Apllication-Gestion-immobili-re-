import { eq } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { owners } from "../db/schema";
import {
  authHeader,
  createManager,
  createOwner,
  createOwnerPortalUser,
  createPortalUser,
  createProperty,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * La base tranche, pas le jeton.
 *
 * Le portail locataire applique déjà cette règle — voir exporterMesDonnees et
 * son commentaire. Le portail propriétaire, lui, lisait l'`ownerId` porté par
 * le JWT et servait la fiche correspondante sans jamais vérifier qu'elle
 * appartient au compte connecté.
 *
 * Un jeton reste valable sept jours et sa version n'est pas incrémentée quand
 * une agence retire un accès ou réaffecte une fiche : le porteur continuait
 * donc de lire le compte-rendu de gestion visé — IBAN, taux de commission,
 * loyers encaissés bien par bien. Et `owners.userId` n'ayant aucune contrainte
 * d'unicité, un même compte pouvait être lié à deux fiches de deux agences
 * différentes, le `login` en choisissant une sans ordre défini.
 *
 * Trois routes étaient concernées : le tableau de bord propriétaire et les
 * deux formes du compte-rendu de gestion.
 */
describe("Portail propriétaire — la fiche est résolue par le compte", () => {
  async function deuxAgences() {
    const managerA = await createManager();
    const managerB = await createManager();
    const ficheA = await createOwner(managerA.id, { lastName: "Sarr" });
    const ficheB = await createOwner(managerB.id, { lastName: "Autre" });
    await createProperty(managerB.id, { ownerId: ficheB.id, title: "Villa de l'autre agence" });
    const compte = await createOwnerPortalUser(ficheA);
    return { ficheA, ficheB, compte };
  }

  it("sert bien sa propre fiche au propriétaire", async () => {
    const { ficheA, compte } = await deuxAgences();

    const res = await request(app)
      .get("/api/owners/mine/dashboard")
      .set(authHeader(tokenFor(compte, null, ficheA.id)));

    expect(res.status).toBe(200);
  });

  it("ne sert jamais la fiche d'une autre agence, même désignée par le jeton", async () => {
    // Le cœur du sujet : le jeton est valide et signé, mais il pointe une
    // fiche qui n'est pas celle du compte. Le service répond — c'est bien le
    // propriétaire connecté — mais avec SA fiche, pas celle du jeton.
    const { ficheA, ficheB, compte } = await deuxAgences();

    const res = await request(app)
      .get("/api/owners/mine/dashboard")
      .set(authHeader(tokenFor(compte, null, ficheB.id)));

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("Villa de l'autre agence");
    expect(JSON.stringify(res.body)).not.toContain(ficheB.lastName);
    expect(JSON.stringify(res.body)).toContain(ficheA.lastName);
  });

  it("ne livre jamais le compte-rendu de gestion d'une autre agence", async () => {
    const { ficheA, ficheB, compte } = await deuxAgences();

    const res = await request(app).get("/api/crg/mine").set(authHeader(tokenFor(compte, null, ficheB.id)));

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("Villa de l'autre agence");
    expect(JSON.stringify(res.body)).toContain(ficheA.lastName);
  });

  it("n'exporte jamais le compte-rendu d'une autre agence — IBAN et commission compris", async () => {
    const { ficheA, ficheB, compte } = await deuxAgences();

    const res = await request(app).get("/api/crg/mine/export").set(authHeader(tokenFor(compte, null, ficheB.id)));

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("Villa de l'autre agence");
    expect(res.text).toContain(ficheA.lastName);
    expect(ficheB.id).toBeDefined();
  });

  it("refuse un compte portail qui n'est rattaché à aucune fiche", async () => {
    // Le jeton porte un ownerId réel, mais le compte n'est lié à rien : c'est
    // la situation d'un accès retiré dont le jeton n'a pas encore expiré.
    const { ficheA } = await deuxAgences();
    const orphelin = await createPortalUser("OWNER");

    const res = await request(app)
      .get("/api/owners/mine/dashboard")
      .set(authHeader(tokenFor(orphelin, null, ficheA.id)));

    expect(res.status).toBe(403);
  });

  it("continue de servir la fiche quand le jeton ne porte aucun ownerId", async () => {
    // Un jeton émis avant l'ajout du champ, ou par un autre chemin : c'est la
    // base qui sait, le jeton n'est plus qu'un indice.
    const { compte } = await deuxAgences();

    const res = await request(app).get("/api/owners/mine/dashboard").set(authHeader(tokenFor(compte)));

    expect(res.status).toBe(200);
  });

  it("un même compte ne peut pas être rattaché à deux fiches", async () => {
    // La contrainte qui rend la règle tenable : sans elle, « la fiche du
    // compte » resterait ambigu et le login en choisirait une sans ordre
    // défini. tenants.userId la porte déjà.
    const { ficheA, ficheB, compte } = await deuxAgences();

    await expect(
      testDb.update(owners).set({ userId: compte.id }).where(eq(owners.id, ficheB.id))
    ).rejects.toThrow();
    expect(ficheA.id).toBeDefined();
  });
});
