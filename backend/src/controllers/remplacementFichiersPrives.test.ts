import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import { contracts, tenants } from "../db/schema";
import { deleteStorageObjectBestEffort, uploadPrivateFile } from "../services/storage.service";
import {
  authHeader,
  createContract,
  createManager,
  createProperty,
  createTenant,
  tokenFor,
} from "../test/authHelpers";
import { testDb } from "../test/setupTestDb";

vi.mock("../services/storage.service", () => ({
  uploadPrivateFile: vi.fn(),
  getSignedUrl: vi.fn().mockResolvedValue("http://test.local/signed/mock.pdf"),
  deleteStorageObjectBestEffort: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Régression : remplacer la pièce d'identité d'un locataire, ou le scan d'un
 * contrat, écrivait le nouveau fichier privé sans supprimer l'ancien. Chaque
 * remplacement laissait donc à nos frais un document d'identité (donnée
 * personnelle) sans plus aucune fiche pour le référencer — et que ni la
 * suppression du locataire ni l'anonymisation ne pouvaient retrouver.
 */
describe("remplacement d'un fichier privé", () => {
  beforeEach(() => {
    vi.mocked(uploadPrivateFile).mockReset();
    vi.mocked(deleteStorageObjectBestEffort).mockReset().mockResolvedValue(undefined);
  });

  it("supprime l'ancienne pièce d'identité quand le gestionnaire en téléverse une nouvelle", async () => {
    vi.mocked(uploadPrivateFile).mockResolvedValue("tenants/nouvelle.pdf");
    const manager = await createManager();
    const tenant = await createTenant(manager.id, { idDocument: "tenants/ancienne.pdf" });

    const res = await request(app)
      .put(`/api/tenants/${tenant.id}`)
      .set(authHeader(tokenFor(manager)))
      .attach("idDocument", Buffer.from("%PDF-1.4 cni"), { filename: "cni.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(tenants).where(eq(tenants.id, tenant.id));
    expect(apres.idDocument).toBe("tenants/nouvelle.pdf");
    expect(deleteStorageObjectBestEffort).toHaveBeenCalledWith("tenants/ancienne.pdf");
  });

  it("ne supprime rien quand la fiche n'avait pas de pièce d'identité ou qu'aucun fichier n'est envoyé", async () => {
    vi.mocked(uploadPrivateFile).mockResolvedValue("tenants/nouvelle.pdf");
    const manager = await createManager();
    const sans = await createTenant(manager.id, { idDocument: null });
    const avec = await createTenant(manager.id, { idDocument: "tenants/gardee.pdf" });

    await request(app)
      .put(`/api/tenants/${sans.id}`)
      .set(authHeader(tokenFor(manager)))
      .attach("idDocument", Buffer.from("%PDF-1.4 cni"), { filename: "cni.pdf", contentType: "application/pdf" })
      .expect(200);
    await request(app)
      .put(`/api/tenants/${avec.id}`)
      .set(authHeader(tokenFor(manager)))
      .send({ firstName: "Nouveau" })
      .expect(200);

    expect(deleteStorageObjectBestEffort).not.toHaveBeenCalled();
  });

  it("garde la modification si le nettoyage de l'ancienne pièce échoue", async () => {
    vi.mocked(uploadPrivateFile).mockResolvedValue("tenants/nouvelle.pdf");
    vi.mocked(deleteStorageObjectBestEffort).mockRejectedValue(new Error("stockage indisponible"));
    const manager = await createManager();
    const tenant = await createTenant(manager.id, { idDocument: "tenants/ancienne.pdf" });

    const res = await request(app)
      .put(`/api/tenants/${tenant.id}`)
      .set(authHeader(tokenFor(manager)))
      .attach("idDocument", Buffer.from("%PDF-1.4 cni"), { filename: "cni.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(200);
  });

  it("supprime l'ancien scan quand le contrat est rescanné", async () => {
    vi.mocked(uploadPrivateFile).mockResolvedValue("contracts/nouveau.pdf");
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);
    await testDb.update(contracts).set({ scannedContractUrl: "contracts/ancien.pdf" }).where(eq(contracts.id, contract.id));

    const res = await request(app)
      .post(`/api/contracts/${contract.id}/scan`)
      .set(authHeader(tokenFor(manager)))
      .attach("scan", Buffer.from("%PDF-1.4 scan"), { filename: "scan.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(200);
    const [apres] = await testDb.select().from(contracts).where(eq(contracts.id, contract.id));
    expect(apres.scannedContractUrl).toBe("contracts/nouveau.pdf");
    expect(deleteStorageObjectBestEffort).toHaveBeenCalledWith("contracts/ancien.pdf");
  });

  it("ne supprime rien au premier scan d'un contrat", async () => {
    vi.mocked(uploadPrivateFile).mockResolvedValue("contracts/premier.pdf");
    const manager = await createManager();
    const property = await createProperty(manager.id);
    const tenant = await createTenant(manager.id);
    const contract = await createContract(property.id, tenant.id);

    await request(app)
      .post(`/api/contracts/${contract.id}/scan`)
      .set(authHeader(tokenFor(manager)))
      .attach("scan", Buffer.from("%PDF-1.4 scan"), { filename: "scan.pdf", contentType: "application/pdf" })
      .expect(200);

    expect(deleteStorageObjectBestEffort).not.toHaveBeenCalled();
  });
});
