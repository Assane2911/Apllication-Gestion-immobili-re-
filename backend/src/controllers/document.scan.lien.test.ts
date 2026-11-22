import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import * as storageService from "../services/storage.service";
import { authHeader, createContract, createManager, createProperty, createTenant, tokenFor } from "../test/authHelpers";

/**
 * Contrat papier scanné : le lien rendu dépend de ce qui est stocké. Un chemin de stockage est signé (lien temporaire) ;
 * un lien complet déjà public (import) est rendu tel quel, sans repasser par la signature.
 */
afterEach(() => vi.restoreAllMocks());

async function bailAvecScan(scannedContractUrl: string) {
  const manager = await createManager();
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id, { scannedContractUrl } as never);
  return { contract, h: authHeader(tokenFor(manager)) };
}

describe("GET /api/documents/lease-scan/:contractId : forme du lien rendu", () => {
  it("un chemin de stockage est signé, et c'est le lien signé qui est rendu", async () => {
    const signer = vi.spyOn(storageService, "getSignedUrl").mockResolvedValue("https://stockage.test/signe?sig=abc");
    const { contract, h } = await bailAvecScan("contracts/scan.pdf");

    const res = await request(app).get(`/api/documents/lease-scan/${contract.id}`).set(h);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: "https://stockage.test/signe?sig=abc" });
    expect(signer).toHaveBeenCalledWith("contracts/scan.pdf");
  });

  it.each(["https://exemple.test/scan.pdf", "http://exemple.test/scan.pdf", "HTTPS://EXEMPLE.TEST/SCAN.PDF"])("le lien complet %s est rendu tel quel, sans signature", async (lien) => {
    const signer = vi.spyOn(storageService, "getSignedUrl").mockResolvedValue("https://ne-doit-pas-servir.test");
    const { contract, h } = await bailAvecScan(lien);

    const res = await request(app).get(`/api/documents/lease-scan/${contract.id}`).set(h);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: lien });
    expect(signer).not.toHaveBeenCalled();
  });

  it.each(["httpsfoo/scan.pdf", "dossier/http://scan.pdf", "ftp://exemple.test/scan.pdf"])("« %s » n'est pas un lien web complet : il est signé comme un chemin de stockage", async (chemin) => {
    const signer = vi.spyOn(storageService, "getSignedUrl").mockResolvedValue("https://stockage.test/signe");
    const { contract, h } = await bailAvecScan(chemin);

    const res = await request(app).get(`/api/documents/lease-scan/${contract.id}`).set(h);

    expect(res.body.url).toBe("https://stockage.test/signe");
    expect(signer).toHaveBeenCalledTimes(1);
  });
});
