import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { contracts } from "../db/schema";
import * as storageService from "../services/storage.service";
import { authHeader, createContract, createManager, createOwner, createProperty, createTenant, fakeJpegBuffer, tokenFor, tokenProprietaire } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

afterEach(() => vi.restoreAllMocks());

const SIGNATURE = "data:image/png;base64," + "A".repeat(60_000);
const MARQUEUR = "AAAAAAAA";

describe("Tableau de bord propriétaire — ne charge pas les baux entiers", () => {
  it("ne lit des baux que leur identifiant et leur bien (pas les clauses ni les images de signature), et le résumé reste juste", async () => {
    const manager = await createManager();
    const owner = await createOwner(manager.id);
    const property = await createProperty(manager.id, { ownerId: owner.id });
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id, { terms: "Clauses particulières. ".repeat(200), managerSignatureUrl: SIGNATURE, tenantSignatureUrl: SIGNATURE });
    const jeton = await tokenProprietaire(owner);

    // Relève les tables lues SANS liste de colonnes (`db.select().from(table)` : la ligne entière).
    const lignesEntieres: unknown[] = [];
    const origine = testDb.select.bind(testDb);
    vi.spyOn(testDb, "select").mockImplementation(((...args: unknown[]) => {
      const requete = origine(...(args as []));
      if (args.length === 0) {
        const depuis = requete.from.bind(requete);
        requete.from = (table: unknown) => {
          lignesEntieres.push(table);
          return depuis(table);
        };
      }
      return requete;
    }) as never);

    const res = await request(app).get("/api/owners/mine/dashboard").set(authHeader(jeton));

    expect(res.status).toBe(200);
    expect(lignesEntieres).not.toContain(contracts);
    // Le résumé ne change pas : le bien du propriétaire y figure, sans aucune donnée de bail.
    expect(res.body.properties).toHaveLength(1);
    expect(res.body.properties[0].propertyId).toBe(property.id);
    expect(JSON.stringify(res.body)).not.toContain(MARQUEUR);
  });
});

describe("PUT /api/properties/:id — l'image n'est stockée que si la modification est acceptée", () => {
  it("un changement de statut refusé (contrat actif) n'envoie aucune image au stockage public", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id, { status: "OCCUPIED" });
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id, { status: "ACTIVE" });
    const upload = vi.spyOn(storageService, "uploadPublicFile").mockResolvedValue("https://stockage.test/properties/x.jpg");

    const res = await request(app)
      .put(`/api/properties/${property.id}`)
      .set(authHeader(tokenFor(manager)))
      .field("status", "AVAILABLE")
      .attach("image", fakeJpegBuffer("octets"), { filename: "bien.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PROPERTY_ACTIVE_CONTRACT_STATUS");
    expect(upload).not.toHaveBeenCalled();
  });

  it("une modification acceptée envoie toujours l'image", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const upload = vi.spyOn(storageService, "uploadPublicFile").mockResolvedValue("https://stockage.test/properties/x.jpg");

    const res = await request(app)
      .put(`/api/properties/${property.id}`)
      .set(authHeader(tokenFor(manager)))
      .field("title", "Villa rénovée")
      .attach("image", fakeJpegBuffer("octets"), { filename: "bien.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(200);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(res.body.imageUrl).toBe("https://stockage.test/properties/x.jpg");
  });
});

describe("GET /api/properties/:id — l'historique des baux ne renvoie pas les images de signature", () => {
  it("garde les dates de signature et les locataires, sans les images (jusqu'à 500 000 caractères chacune, par bail)", async () => {
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    await createContract(property.id, tenant.id, { managerSignatureUrl: SIGNATURE, tenantSignatureUrl: SIGNATURE, signedByManagerAt: new Date(), signedByTenantAt: new Date() });

    const res = await request(app).get(`/api/properties/${property.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(200);
    expect(res.body.contracts).toHaveLength(1);
    expect(res.body.contracts[0].signedByTenantAt).toBeTruthy();
    expect(res.body.contracts[0].tenant.id).toBe(tenant.id);
    expect(res.body.contracts[0]).not.toHaveProperty("tenantSignatureUrl");
    expect(res.body.contracts[0]).not.toHaveProperty("managerSignatureUrl");
    expect(JSON.stringify(res.body)).not.toContain(MARQUEUR);
  });
});
