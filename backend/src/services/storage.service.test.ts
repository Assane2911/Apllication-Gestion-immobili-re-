import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../utils/asyncHandler";
import { getSignedUrl, uploadPrivateFile, uploadPublicFile } from "./storage.service";

// setupTestDb.ts remplace globalement ../config/supabase par un stub "chemin
// heureux" (upload toujours OK). On le remplace ici par un mock pilotable,
// pour pouvoir vérifier AUSSI les branches d'erreur et, surtout, dans quel
// bucket chaque type de fichier atterrit : la distinction public/privé est ce
// qui empêche une pièce d'identité de locataire ou une photo d'intérieur de
// logement d'être accessible sans autorisation.
const mocks = vi.hoisted(() => {
  const upload = vi.fn();
  const getPublicUrl = vi.fn();
  const createSignedUrl = vi.fn();
  const from = vi.fn(() => ({ upload, getPublicUrl, createSignedUrl }));
  return { upload, getPublicUrl, createSignedUrl, from };
});

vi.mock("../config/supabase", () => ({
  supabaseAdmin: { storage: { from: mocks.from } },
  STORAGE_BUCKETS: { public: "public-uploads", private: "private-uploads" },
}));

function fakeFile(originalname: string, mimetype = "image/png"): Express.Multer.File {
  return {
    fieldname: "file",
    originalname,
    encoding: "7bit",
    mimetype,
    size: 7,
    buffer: Buffer.from("contenu"),
  } as Express.Multer.File;
}

beforeEach(() => {
  mocks.upload.mockResolvedValue({ error: null });
  mocks.getPublicUrl.mockReturnValue({ data: { publicUrl: "https://cdn.test/public-uploads/photo.png" } });
  mocks.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://cdn.test/signed/abc" }, error: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("uploadPublicFile", () => {
  it("envoie le fichier dans le bucket public et renvoie son URL publique", async () => {
    const url = await uploadPublicFile(fakeFile("photo.png"), "properties");

    expect(mocks.from).toHaveBeenCalledWith("public-uploads");
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    const [objectPath, buffer, options] = mocks.upload.mock.calls[0];
    expect(objectPath).toMatch(/^properties\/\d+-\d+\.png$/);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(options).toEqual({ contentType: "image/png", upsert: false });
    expect(url).toBe("https://cdn.test/public-uploads/photo.png");
  });

  it("normalise l'extension en minuscules et préfixe par le dossier", async () => {
    await uploadPublicFile(fakeFile("Photo De Villa.JPG", "image/jpeg"), "properties");

    const [objectPath] = mocks.upload.mock.calls[0];
    expect(objectPath).toMatch(/^properties\/\d+-\d+\.jpg$/);
  });

  it("génère un chemin différent à chaque envoi, sans jamais écraser un fichier existant", async () => {
    await uploadPublicFile(fakeFile("photo.png"), "properties");
    await uploadPublicFile(fakeFile("photo.png"), "properties");

    const [premierChemin] = mocks.upload.mock.calls[0];
    const [secondChemin] = mocks.upload.mock.calls[1];
    expect(premierChemin).not.toBe(secondChemin);
    expect(mocks.upload.mock.calls[0][2]).toMatchObject({ upsert: false });
    expect(mocks.upload.mock.calls[1][2]).toMatchObject({ upsert: false });
  });

  it("lève une ApiError 500 explicite si Supabase refuse l'envoi", async () => {
    mocks.upload.mockResolvedValue({ error: { message: "quota dépassé" } });

    await expect(uploadPublicFile(fakeFile("photo.png"), "properties")).rejects.toThrow(ApiError);
    await expect(uploadPublicFile(fakeFile("photo.png"), "properties")).rejects.toMatchObject({
      statusCode: 500,
      message: expect.stringContaining("quota dépassé"),
    });
  });
});

describe("uploadPrivateFile", () => {
  it("envoie dans le bucket privé et renvoie le CHEMIN de stockage, jamais une URL publique", async () => {
    const objectPath = await uploadPrivateFile(fakeFile("piece-identite.pdf", "application/pdf"), "tenants");

    expect(mocks.from).toHaveBeenCalledWith("private-uploads");
    expect(mocks.from).not.toHaveBeenCalledWith("public-uploads");
    expect(objectPath).toMatch(/^tenants\/\d+-\d+\.pdf$/);
    // Contrat de sécurité : un fichier privé ne doit jamais produire d'URL
    // publique devinable — l'accès passe obligatoirement par une URL signée.
    expect(objectPath).not.toContain("http");
    expect(mocks.getPublicUrl).not.toHaveBeenCalled();
  });

  it("accepte aussi le dossier des photos d'incidents", async () => {
    const objectPath = await uploadPrivateFile(fakeFile("degat.jpg", "image/jpeg"), "issues");

    expect(mocks.from).toHaveBeenCalledWith("private-uploads");
    expect(objectPath).toMatch(/^issues\/\d+-\d+\.jpg$/);
  });

  it("lève une ApiError 500 explicite si Supabase refuse l'envoi", async () => {
    mocks.upload.mockResolvedValue({ error: { message: "bucket introuvable" } });

    await expect(uploadPrivateFile(fakeFile("degat.jpg"), "issues")).rejects.toMatchObject({
      statusCode: 500,
      message: expect.stringContaining("bucket introuvable"),
    });
  });
});

describe("getSignedUrl", () => {
  it("génère une URL signée valable 1 heure par défaut, depuis le bucket privé", async () => {
    const url = await getSignedUrl("tenants/123-456.pdf");

    expect(mocks.from).toHaveBeenCalledWith("private-uploads");
    expect(mocks.createSignedUrl).toHaveBeenCalledWith("tenants/123-456.pdf", 3600);
    expect(url).toBe("https://cdn.test/signed/abc");
  });

  it("transmet une durée d'expiration personnalisée", async () => {
    await getSignedUrl("tenants/123-456.pdf", 60);

    expect(mocks.createSignedUrl).toHaveBeenCalledWith("tenants/123-456.pdf", 60);
  });

  it("lève une ApiError 500 si Supabase renvoie une erreur", async () => {
    mocks.createSignedUrl.mockResolvedValue({ data: null, error: { message: "objet introuvable" } });

    await expect(getSignedUrl("tenants/inconnu.pdf")).rejects.toMatchObject({
      statusCode: 500,
      message: expect.stringContaining("objet introuvable"),
    });
  });

  it("lève une ApiError 500 si Supabase ne renvoie aucune donnée ni erreur", async () => {
    mocks.createSignedUrl.mockResolvedValue({ data: null, error: null });

    await expect(getSignedUrl("tenants/inconnu.pdf")).rejects.toMatchObject({
      statusCode: 500,
      message: expect.stringContaining("erreur inconnue"),
    });
  });
});
