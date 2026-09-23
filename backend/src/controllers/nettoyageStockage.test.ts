import { eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { issueReports, listings, tenants } from "../db/schema";
import * as storageService from "../services/storage.service";
import {
  authHeader,
  createContract,
  createManager,
  createProperty,
  createTenant,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

/**
 * Supprimer une ligne ne suffit pas : le FICHIER qu'elle référence doit
 * disparaître avec elle.
 *
 * Seul deleteMyAccount (auth.controller.ts) nettoyait le stockage. Partout
 * ailleurs, la ligne partait et le fichier restait — sans plus aucune
 * référence pour le retrouver, donc impossible à purger ensuite :
 *  - la pièce d'identité d'un locataire supprimé restait indéfiniment dans le
 *    bucket privé, alors que la politique de confidentialité promet sa
 *    suppression à la fin du bail ;
 *  - l'image d'un bien ou d'une annonce supprimée restait dans le bucket
 *    PUBLIC, donc accessible en permanence par son URL, sans authentification
 *    ni expiration.
 *
 * Le nettoyage est best-effort et se fait APRÈS la suppression en base (voir
 * deleteStorageObjectBestEffort) : un stockage indisponible ne doit jamais
 * faire échouer une suppression que l'utilisateur a demandée.
 */
describe("Nettoyage du stockage à la suppression", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function espionNettoyage() {
    return vi.spyOn(storageService, "deleteStorageObjectBestEffort").mockResolvedValue(undefined);
  }

  it("supprime la pièce d'identité d'un locataire supprimé", async () => {
    const nettoyage = espionNettoyage();
    const manager = await createManager();
    const tenant = await createTenant(manager.id, { idDocument: "tenants/piece-identite.jpg" });

    const res = await request(app).delete(`/api/tenants/${tenant.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(204);
    expect(nettoyage).toHaveBeenCalledWith("tenants/piece-identite.jpg");
  });

  it("supprime l'image d'un bien supprimé, qui vit dans le bucket public", async () => {
    const nettoyage = espionNettoyage();
    const manager = await createManager();
    const property = await createProperty(manager.id, {
      imageUrl: "http://test.local/storage/v1/object/public/public-uploads/properties/photo.jpg",
    });

    const res = await request(app).delete(`/api/properties/${property.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(204);
    expect(nettoyage).toHaveBeenCalledWith(
      "http://test.local/storage/v1/object/public/public-uploads/properties/photo.jpg"
    );
  });

  it("supprime le bail scanné et les photos d'incidents d'un contrat supprimé", async () => {
    const nettoyage = espionNettoyage();
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, {
      status: "ENDED",
      scannedContractUrl: "contracts/bail-scanne.pdf",
    });
    await testDb.insert(issueReports).values({
      contractId: contract.id,
      tenantId: tenant.id,
      title: "Fuite",
      description: "Fuite sous l'évier",
      photoUrl: "issues/fuite.jpg",
      additionalPhotos: JSON.stringify(["issues/fuite-2.jpg"]),
    });

    const res = await request(app).delete(`/api/contracts/${contract.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(204);
    const nettoyes = nettoyage.mock.calls.map((appel) => appel[0]);
    expect(nettoyes).toContain("contracts/bail-scanne.pdf");
    expect(nettoyes).toContain("issues/fuite.jpg");
    expect(nettoyes).toContain("issues/fuite-2.jpg");
  });

  it("supprime l'image d'une annonce supprimée", async () => {
    const nettoyage = espionNettoyage();
    const manager = await createManager();
    const [listing] = await testDb
      .insert(listings)
      .values({
        managerId: manager.id,
        title: "Studio lumineux",
        description: "Proche centre",
        price: 400,
        location: "Dakar",
        imageUrl: "http://test.local/storage/v1/object/public/public-uploads/listings/annonce.jpg",
      })
      .returning();

    const res = await request(app).delete(`/api/listings/${listing.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(204);
    expect(nettoyage).toHaveBeenCalledWith(
      "http://test.local/storage/v1/object/public/public-uploads/listings/annonce.jpg"
    );
  });

  it("ne tente aucun nettoyage quand la ligne supprimée ne portait aucun fichier", async () => {
    const nettoyage = espionNettoyage();
    const manager = await createManager();
    const tenant = await createTenant(manager.id);

    await request(app).delete(`/api/tenants/${tenant.id}`).set(authHeader(tokenFor(manager)));

    // La fonction accepte null par contrat (elle ne fait rien) : ce qui
    // importe est qu'aucun CHEMIN de fichier ne soit passé au nettoyage.
    for (const [chemin] of nettoyage.mock.calls) {
      expect(chemin).toBeFalsy();
    }
  });

  it("supprime quand même la ligne si le nettoyage du fichier échoue", async () => {
    // Le stockage est un service externe : son indisponibilité ne doit jamais
    // empêcher une suppression demandée par l'utilisateur.
    vi.spyOn(storageService, "deleteStorageObjectBestEffort").mockRejectedValue(new Error("stockage indisponible"));
    const manager = await createManager();
    const tenant = await createTenant(manager.id, { idDocument: "tenants/piece.jpg" });

    const res = await request(app).delete(`/api/tenants/${tenant.id}`).set(authHeader(tokenFor(manager)));

    expect(res.status).toBe(204);
    const restant = await testDb.select().from(tenants).where(eq(tenants.id, tenant.id));
    expect(restant).toHaveLength(0);
  });
});
