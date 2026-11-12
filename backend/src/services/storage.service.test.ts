import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../utils/asyncHandler";
import { getSignedUrl, getSignedUrls, uploadPrivateFile, uploadPublicFile } from "./storage.service";

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
  const createSignedUrls = vi.fn();
  const from = vi.fn(() => ({ upload, getPublicUrl, createSignedUrl, createSignedUrls }));
  return { upload, getPublicUrl, createSignedUrl, createSignedUrls, from };
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

  // L'extension venait du NOM envoyé par le client : « evil.html » portant un vrai PNG était rangé en .html,
  // et un nom à l'extension exotique (« photo.jpég ») donnait une clé de stockage invalide, donc une erreur 500.
  // Le contenu a été vérifié (assertFileContentMatchesDeclaredType) : c'est lui qui dit l'extension.
  it.each([
    ["evil.html", "image/png", "png"],
    ["photo.jpég", "image/jpeg", "jpg"],
    ["photo", "image/jpeg", "jpg"],
    ["scan.exe", "application/pdf", "pdf"],
    ["animation.PNG.zip", "image/gif", "gif"],
    ["visuel.bin", "image/webp", "webp"],
  ])("tire l'extension du type vérifié, pas du nom envoyé (« %s » déclaré %s)", async (nom, mimetype, extension) => {
    await uploadPublicFile(fakeFile(nom, mimetype), "properties");

    const [objectPath] = mocks.upload.mock.calls[0];
    expect(objectPath).toMatch(new RegExp(`^properties/\\d+-\\d+\\.${extension}$`));
  });

  it("ne met aucune extension quand le type n'est pas reconnu, plutôt que de reprendre celle du nom", async () => {
    await uploadPrivateFile(fakeFile("rapport.sh", "text/plain"), "tenants");

    const [objectPath] = mocks.upload.mock.calls[0];
    expect(objectPath).toMatch(/^tenants\/\d+-\d+$/);
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

describe("getSignedUrls (signature en lot)", () => {
  const signerTout = (chemins: string[]) => ({ data: chemins.map((path) => ({ path, signedUrl: `https://cdn.test/signed/${path}`, error: null })), error: null });

  it("signe tous les chemins en UN seul appel au stockage, depuis le bucket privé", async () => {
    mocks.createSignedUrls.mockImplementation(async (chemins: string[]) => signerTout(chemins));

    const urls = await getSignedUrls(["issues/a.jpg", "issues/b.jpg", "contracts/c.pdf"]);

    expect(mocks.from).toHaveBeenCalledWith("private-uploads");
    expect(mocks.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(mocks.createSignedUrls).toHaveBeenCalledWith(["issues/a.jpg", "issues/b.jpg", "contracts/c.pdf"], 3600);
    expect(urls.get("issues/b.jpg")).toBe("https://cdn.test/signed/issues/b.jpg");
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it("signe une fois les doublons, ignore les valeurs vides, et n'appelle pas le stockage pour une liste vide", async () => {
    mocks.createSignedUrls.mockImplementation(async (chemins: string[]) => signerTout(chemins));

    await getSignedUrls(["issues/a.jpg", "issues/a.jpg", ""]);
    expect(mocks.createSignedUrls).toHaveBeenCalledWith(["issues/a.jpg"], 3600);

    mocks.createSignedUrls.mockClear();
    expect((await getSignedUrls([])).size).toBe(0);
    expect(mocks.createSignedUrls).not.toHaveBeenCalled();
  });

  it("découpe par lots de 100 chemins", async () => {
    mocks.createSignedUrls.mockImplementation(async (chemins: string[]) => signerTout(chemins));
    const chemins = Array.from({ length: 250 }, (_, i) => `issues/${i}.jpg`);

    const urls = await getSignedUrls(chemins);

    expect(mocks.createSignedUrls).toHaveBeenCalledTimes(3);
    expect(urls.size).toBe(250);
    expect([...urls.values()].every((u) => u !== null)).toBe(true);
  });

  it("un fichier non signable vaut null sans empêcher les autres", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createSignedUrls.mockResolvedValue({
      data: [
        { path: "issues/ok.jpg", signedUrl: "https://cdn.test/signed/ok", error: null },
        { path: "issues/perdu.jpg", signedUrl: "", error: "Object not found" },
      ],
      error: null,
    });

    const urls = await getSignedUrls(["issues/ok.jpg", "issues/perdu.jpg", "issues/absent-de-la-reponse.jpg"]);

    expect(urls.get("issues/ok.jpg")).toBe("https://cdn.test/signed/ok");
    // L'échec est consigné avec le chemin concerné (de quoi retrouver le fichier manquant), jamais passé sous silence.
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("issues/perdu.jpg"), expect.any(String));
    expect(urls.get("issues/perdu.jpg")).toBeNull();
    expect(urls.get("issues/absent-de-la-reponse.jpg")).toBeNull();
  });

  it("une panne du stockage ne lève pas : tous les chemins valent null (la liste reste affichable)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createSignedUrls.mockResolvedValue({ data: null, error: { message: "stockage indisponible" } });
    expect([...(await getSignedUrls(["issues/a.jpg", "issues/b.jpg"])).values()]).toEqual([null, null]);

    mocks.createSignedUrls.mockRejectedValue(new Error("réseau coupé"));
    expect([...(await getSignedUrls(["issues/a.jpg"])).values()]).toEqual([null]);
  });
});
