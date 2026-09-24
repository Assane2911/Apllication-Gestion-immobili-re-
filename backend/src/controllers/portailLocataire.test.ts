import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import {
  authHeader,
  createContract,
  createInvoice,
  createManager,
  createPortalUser,
  createProperty,
  createTenant,
  createTenantPortalUser,
  tokenFor,
} from "../test/authHelpers";

/**
 * Même règle que pour le portail propriétaire : la base tranche, pas le jeton.
 *
 * Une douzaine de routes du portail locataire s'appuyaient sur le `tenantId`
 * porté par le JWT sans jamais confronter la fiche au compte. Le jeton est
 * signé, donc infalsifiable, mais il reste valable sept jours et sa version
 * n'est pas incrémentée quand une agence réaffecte ou détache une fiche : son
 * porteur continuait de lire baux, quittances, factures et messagerie de la
 * fiche visée, fût-elle celle d'une autre agence.
 *
 * La fenêtre est plus étroite que pour les propriétaires — `tenants.userId`
 * est unique, et l'anonymisation supprime le compte, ce qui invalide le jeton
 * — mais le principe est le même, et une règle appliquée à un portail sur
 * deux est une règle qu'on oubliera d'appliquer au troisième.
 */
describe("Portail locataire — la fiche est résolue par le compte", () => {
  async function deuxAgences() {
    const managerA = await createManager();
    const managerB = await createManager();

    const ficheA = await createTenant(managerA.id, { lastName: "Sarr" });
    const bienA = await createProperty(managerA.id, { title: "Studio de mon agence" });
    const bailA = await createContract(bienA.id, ficheA.id);
    await createInvoice(bailA.id, { status: "PAID" });

    const ficheB = await createTenant(managerB.id, { lastName: "Autre" });
    const bienB = await createProperty(managerB.id, { title: "Villa de l'autre agence" });
    const bailB = await createContract(bienB.id, ficheB.id);
    const factureB = await createInvoice(bailB.id, { status: "PAID" });

    const compte = await createTenantPortalUser(ficheA);
    return { ficheA, ficheB, bailB, factureB, compte };
  }

  it("sert bien ses propres baux au locataire", async () => {
    const { ficheA, compte } = await deuxAgences();

    const res = await request(app).get("/api/contracts/mine").set(authHeader(tokenFor(compte, ficheA.id)));

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain("Studio de mon agence");
  });

  it("ne livre jamais les baux d'un autre locataire, même désignés par le jeton", async () => {
    const { ficheB, compte } = await deuxAgences();

    const res = await request(app).get("/api/contracts/mine").set(authHeader(tokenFor(compte, ficheB.id)));

    expect(JSON.stringify(res.body)).not.toContain("Villa de l'autre agence");
  });

  it("ne livre jamais les factures d'un autre locataire", async () => {
    const { ficheB, compte } = await deuxAgences();

    const res = await request(app).get("/api/invoices/mine").set(authHeader(tokenFor(compte, ficheB.id)));

    expect(JSON.stringify(res.body)).not.toContain("Villa de l'autre agence");
  });

  it("ne livre jamais la quittance d'un autre locataire", async () => {
    // Une quittance nomme le locataire, le bien et le montant : c'est la pièce
    // la plus parlante que ce chemin exposait.
    const { factureB, ficheB, compte } = await deuxAgences();

    const res = await request(app)
      .get(`/api/documents/receipt/${factureB.id}`)
      .set(authHeader(tokenFor(compte, ficheB.id)));

    expect(res.status).toBe(403);
  });

  it("ne livre jamais le bail d'un autre locataire désigné par le jeton", async () => {
    const { ficheB, bailB, compte } = await deuxAgences();

    const res = await request(app)
      .get(`/api/documents/lease/${bailB.id}`)
      .set(authHeader(tokenFor(compte, ficheB.id)));

    expect(res.status).toBe(403);
  });

  it("ne livre jamais la messagerie d'un autre locataire", async () => {
    const { ficheB, compte } = await deuxAgences();

    const res = await request(app).get("/api/messages").set(authHeader(tokenFor(compte, ficheB.id)));

    expect(JSON.stringify(res.body)).not.toContain("Villa de l'autre agence");
  });

  it("refuse un compte portail qui n'est rattaché à aucune fiche", async () => {
    const { ficheA } = await deuxAgences();
    const orphelin = await createPortalUser("TENANT");

    const res = await request(app).get("/api/contracts/mine").set(authHeader(tokenFor(orphelin, ficheA.id)));

    expect(res.status).toBe(403);
  });

  it("continue de servir la fiche quand le jeton ne porte aucun tenantId", async () => {
    const { compte } = await deuxAgences();

    const res = await request(app).get("/api/contracts/mine").set(authHeader(tokenFor(compte)));

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain("Studio de mon agence");
  });
});
