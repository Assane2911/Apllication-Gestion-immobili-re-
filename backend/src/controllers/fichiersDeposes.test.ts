import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app";
import * as storageService from "../services/storage.service";
import {
  authHeader,
  createContract,
  createManager,
  createProperty,
  createTenant,
  fakeJpegBuffer,
  tokenFor,
  tokenLocataire,
} from "../test/authHelpers";

/**
 * Fichiers déposés : ce que le serveur accepte de ranger dans le stockage, endpoint par endpoint.
 *
 * - Une PAGE WEB (ou un exécutable) qui se déclare « image/png » est refusée AVANT d'être rangée : sans cela, elle serait resservie
 *   telle quelle par l'adresse du stockage.
 * - Un PDF n'est pas une photo : les biens et les annonces vont dans le bucket PUBLIC (lisible par tous, sans compte), et un PDF
 *   n'y a pas sa place. Le site n'envoie que des images à ces endroits ; le serveur doit le dire aussi.
 */

let envoiPublic: ReturnType<typeof vi.spyOn>;
let envoiPrive: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  envoiPublic = vi.spyOn(storageService, "uploadPublicFile").mockResolvedValue("http://test.local/public/fichier.png");
  envoiPrive = vi.spyOn(storageService, "uploadPrivateFile").mockResolvedValue("tenants/fichier.png");
});
afterEach(() => vi.restoreAllMocks());

const PAGE_WEB = Buffer.from("<html><body><script>alert(document.cookie)</script></body></html>");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const deguise = { filename: "photo.png", contentType: "image/png" };
const pdf = { filename: "scan.pdf", contentType: "application/pdf" };

async function agence() {
  const manager = await createManager();
  const property = await createProperty(manager.id);
  const tenant = await createTenant(manager.id);
  const contract = await createContract(property.id, tenant.id);
  return { manager, property, tenant, contract, h: authHeader(tokenFor(manager)) };
}

describe("Une page web déguisée en image n'est jamais rangée", () => {
  it("bien : création et modification", async () => {
    const { property, h } = await agence();

    const creation = await request(app)
      .post("/api/properties")
      .set(h)
      .field("title", "Villa")
      .field("address", "3 rue des Almadies")
      .field("surface", "120")
      .field("rent", "250000")
      .attach("image", PAGE_WEB, deguise);
    const modification = await request(app).put(`/api/properties/${property.id}`).set(h).attach("image", PAGE_WEB, deguise);

    for (const res of [creation, modification]) {
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("FILE_CONTENT_MISMATCH");
    }
    expect(envoiPublic).not.toHaveBeenCalled();
  });

  it("annonce : création", async () => {
    const { h } = await agence();

    const res = await request(app)
      .post("/api/listings")
      .set(h)
      .field("title", "Belle villa")
      .field("description", "Description de l'annonce")
      .field("price", "250000")
      .field("location", "Dakar")
      .attach("image", PAGE_WEB, deguise);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FILE_CONTENT_MISMATCH");
    expect(envoiPublic).not.toHaveBeenCalled();
  });

  it("locataire : pièce d'identité à la création et à la modification", async () => {
    const { tenant, h } = await agence();

    const creation = await request(app)
      .post("/api/tenants")
      .set(h)
      .field("firstName", "Awa")
      .field("lastName", "Sow")
      .field("email", "awa.sow@test.local")
      .field("phone", "+221770000000")
      .attach("idDocument", PAGE_WEB, deguise);
    const modification = await request(app).put(`/api/tenants/${tenant.id}`).set(h).attach("idDocument", PAGE_WEB, deguise);

    for (const res of [creation, modification]) {
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("FILE_CONTENT_MISMATCH");
    }
    expect(envoiPrive).not.toHaveBeenCalled();
  });

  it("bail : scan du contrat", async () => {
    const { contract, h } = await agence();

    const res = await request(app).post(`/api/contracts/${contract.id}/scan`).set(h).attach("scan", PAGE_WEB, deguise);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FILE_CONTENT_MISMATCH");
    expect(envoiPrive).not.toHaveBeenCalled();
  });

  it("agence : logo et tampon", async () => {
    const { h } = await agence();

    const logo = await request(app).post("/api/agency/logo").set(h).attach("logo", PAGE_WEB, deguise);
    const tampon = await request(app).post("/api/agency/stamp").set(h).attach("stamp", PAGE_WEB, deguise);

    for (const res of [logo, tampon]) {
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("FILE_CONTENT_MISMATCH");
    }
    expect(envoiPublic).not.toHaveBeenCalled();
  });

  it("incident : photo du locataire", async () => {
    const { tenant, contract } = await agence();

    const res = await request(app)
      .post("/api/issues")
      .set(authHeader(await tokenLocataire(tenant.id)))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Fuite sous l'évier de la cuisine")
      .attach("photo", PAGE_WEB, deguise);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FILE_CONTENT_MISMATCH");
    expect(envoiPrive).not.toHaveBeenCalled();
  });
});

describe("Un PDF n'est pas une photo", () => {
  it("bien : refusé à la création comme à la modification, rien n'est rangé dans le stockage public", async () => {
    const { property, h } = await agence();

    const creation = await request(app)
      .post("/api/properties")
      .set(h)
      .field("title", "Villa")
      .field("address", "3 rue des Almadies")
      .field("surface", "120")
      .field("rent", "250000")
      .attach("image", PDF, pdf);
    const modification = await request(app).put(`/api/properties/${property.id}`).set(h).attach("image", PDF, pdf);

    for (const res of [creation, modification]) {
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("FILE_IMAGE_ONLY");
    }
    expect(envoiPublic).not.toHaveBeenCalled();
  });

  it("annonce : refusé, rien n'est rangé dans le stockage public", async () => {
    const { h } = await agence();

    const res = await request(app)
      .post("/api/listings")
      .set(h)
      .field("title", "Belle villa")
      .field("description", "Description de l'annonce")
      .field("price", "250000")
      .field("location", "Dakar")
      .attach("image", PDF, pdf);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FILE_IMAGE_ONLY");
    expect(envoiPublic).not.toHaveBeenCalled();
  });

  it("incident : la photo doit être une image", async () => {
    const { tenant, contract } = await agence();

    const res = await request(app)
      .post("/api/issues")
      .set(authHeader(await tokenLocataire(tenant.id)))
      .field("contractId", contract.id)
      .field("title", "Fuite d'eau")
      .field("description", "Fuite sous l'évier de la cuisine")
      .attach("photo", PDF, pdf);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FILE_IMAGE_ONLY");
    expect(envoiPrive).not.toHaveBeenCalled();
  });

  it("les endroits faits pour des justificatifs gardent le PDF (pièce d'identité, scan du bail)", async () => {
    const { tenant, contract, h } = await agence();

    const piece = await request(app).put(`/api/tenants/${tenant.id}`).set(h).attach("idDocument", PDF, pdf);
    const scan = await request(app).post(`/api/contracts/${contract.id}/scan`).set(h).attach("scan", PDF, pdf);

    expect(piece.status).toBe(200);
    expect(scan.status).toBeLessThan(300);
  });

  it("les photos en image restent acceptées", async () => {
    const { property, h } = await agence();

    const res = await request(app).put(`/api/properties/${property.id}`).set(h).attach("image", PNG, { filename: "bien.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(envoiPublic).toHaveBeenCalledTimes(1);
    expect(fakeJpegBuffer).toBeTypeOf("function");
  });
});
