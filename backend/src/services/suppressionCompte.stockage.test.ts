import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { issueReports, leaseNotices, messages, ownerMessages, storedDocuments, users } from "../db/schema";
import { createContract, createManager, createOwner, createProperty, createTenant } from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";
import * as storageService from "./storage.service";
import { supprimerCompteGestionnaire } from "./suppressionCompte.service";

/**
 * Supprimer un compte « définitivement » doit faire disparaître AUSSI les fichiers : les lignes partent par cascade, mais
 * leurs fichiers (bucket privé : pièces, scans, documents, messages vocaux ; bucket public : images) n'ont plus aucune
 * référence pour être retrouvés ensuite. Ces cas n'étaient pas exercés à la suppression d'un compte : les photos
 * d'incident (dont une liste illisible), les scans de congés, les documents rangés et les messages vocaux.
 */
describe("suppression d'un compte gestionnaire : nettoyage des fichiers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("supprime les photos d'incident (principale et supplémentaires), les scans de congé, les documents rangés et les messages vocaux", async () => {
    const nettoyage = vi.spyOn(storageService, "deleteStorageObjectBestEffort").mockResolvedValue(undefined);
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const owner = await createOwner(manager.id);
    const contract = await createContract(property.id, tenant.id, { status: "ACTIVE" });

    await testDb.insert(issueReports).values({
      contractId: contract.id,
      tenantId: tenant.id,
      title: "Fuite",
      description: "Fuite sous l'évier",
      photoUrl: "issues/fuite.jpg",
      additionalPhotos: JSON.stringify(["issues/fuite-2.jpg", "issues/fuite-3.jpg"]),
    });
    await testDb.insert(leaseNotices).values({
      contractId: contract.id,
      managerId: manager.id,
      givenBy: "TENANT",
      deliveryMode: "REGISTERED_MAIL",
      servedAt: new Date(Date.UTC(2026, 0, 10)),
      periodValue: 2,
      periodUnit: "MONTHS",
      exitDate: new Date(Date.UTC(2026, 2, 10)),
      documentUrl: "notices/conge-scanne.pdf",
    });
    await testDb.insert(storedDocuments).values({
      managerId: manager.id,
      title: "Diagnostic",
      category: "DIAGNOSTIC",
      filePath: "documents/diagnostic.pdf",
      fileName: "diagnostic.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1000,
    });
    await testDb.insert(messages).values({ contractId: contract.id, senderId: manager.id, senderRole: "MANAGER", content: "Vocal", audioPath: "audio/gestionnaire.webm" });
    await testDb.insert(ownerMessages).values({ ownerId: owner.id, managerId: manager.id, senderId: manager.id, senderRole: "MANAGER", content: "Vocal", audioPath: "audio/proprietaire.webm" });
    const [compte] = await testDb.select().from(users).where(eq(users.id, manager.id));

    await supprimerCompteGestionnaire(compte);

    const nettoyes = nettoyage.mock.calls.map((appel) => appel[0]);
    for (const chemin of [
      "issues/fuite.jpg",
      "issues/fuite-2.jpg",
      "issues/fuite-3.jpg",
      "notices/conge-scanne.pdf",
      "documents/diagnostic.pdf",
      "audio/gestionnaire.webm",
      "audio/proprietaire.webm",
    ]) {
      expect(nettoyes, `fichier non nettoyé : ${chemin}`).toContain(chemin);
    }
    expect(await testDb.select().from(users).where(eq(users.id, manager.id))).toHaveLength(0);
  });

  it("ignore une liste de photos illisible sans faire échouer la suppression, et nettoie quand même les autres fichiers", async () => {
    const nettoyage = vi.spyOn(storageService, "deleteStorageObjectBestEffort").mockResolvedValue(undefined);
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id, { status: "ACTIVE" });
    await testDb.insert(issueReports).values({
      contractId: contract.id,
      tenantId: tenant.id,
      title: "Dégât",
      description: "Photos abîmées",
      photoUrl: "issues/degat.jpg",
      additionalPhotos: "ceci { n'est pas du json",
    });
    const [compte] = await testDb.select().from(users).where(eq(users.id, manager.id));

    await expect(supprimerCompteGestionnaire(compte)).resolves.not.toThrow();

    expect(nettoyage.mock.calls.map((appel) => appel[0])).toContain("issues/degat.jpg");
    expect(await testDb.select().from(users).where(eq(users.id, manager.id))).toHaveLength(0);
  });
});
