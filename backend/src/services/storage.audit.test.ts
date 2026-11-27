import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const remove = vi.fn();
  const download = vi.fn();
  const upload = vi.fn();
  const getPublicUrl = vi.fn();
  const createSignedUrl = vi.fn();
  const createSignedUrls = vi.fn();
  // Chaque opération note le bucket SUR LEQUEL elle porte : un envoi dans le mauvais bucket ne doit pas passer inaperçu
  // parce qu'un autre appel du même service, lui, visait le bon.
  const operations: Array<[string, string]> = [];
  const suivre = (nom: string, bucket: string, fn: (...a: unknown[]) => unknown) => (...a: unknown[]) => {
    operations.push([nom, bucket]);
    return fn(...a);
  };
  const from = vi.fn((bucket: string) => ({
    remove: suivre("remove", bucket, remove),
    download: suivre("download", bucket, download),
    upload: suivre("upload", bucket, upload),
    getPublicUrl: suivre("getPublicUrl", bucket, getPublicUrl),
    createSignedUrl: suivre("createSignedUrl", bucket, createSignedUrl),
    createSignedUrls: suivre("createSignedUrls", bucket, createSignedUrls),
  }));
  return { remove, download, upload, getPublicUrl, createSignedUrl, createSignedUrls, from, operations };
});

vi.mock("../config/supabase", () => ({
  supabaseAdmin: { storage: { from: mocks.from } },
  STORAGE_BUCKETS: { public: "public-uploads", private: "private-uploads" },
  SUPABASE_URL_EFFECTIVE: "https://abc.supabase.co",
}));

import { ApiError } from "../utils/asyncHandler";
import {
  chargerLogoAgence,
  deleteStorageObjectBestEffort,
  estUrlPubliqueDuStockage,
  getSignedUrl,
  getSignedUrls,
  uploadPrivateFile,
  uploadPublicFile,
} from "./storage.service";

/**
 * Audit par sabotage de storage.service.ts : la suppression « au mieux » des fichiers (jamais ailleurs que dans le bon bucket,
 * jamais une erreur remontée à l'appelant), la lecture du logo d'agence (signature PNG/JPEG exacte, chemin décodé) et la
 * reconnaissance d'une URL qui est vraiment la nôtre.
 */
const OURS = "https://abc.supabase.co/storage/v1/object/public/public-uploads";
const BUFFER = (...octets: number[]) => Buffer.from(octets);
const blob = (octets: Buffer) => ({ arrayBuffer: async () => octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.length) });

beforeEach(() => {
  mocks.operations.length = 0;
  mocks.remove.mockResolvedValue({ data: [], error: null });
  mocks.download.mockReset();
  mocks.upload.mockReset().mockResolvedValue({ error: null });
  mocks.getPublicUrl.mockReset().mockReturnValue({ data: { publicUrl: "https://cdn.test/public-uploads/photo.png" } });
  mocks.createSignedUrl.mockReset().mockResolvedValue({ data: { signedUrl: "https://cdn.test/signed/abc" }, error: null });
  mocks.createSignedUrls.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("deleteStorageObjectBestEffort", () => {
  it.each([[null], [undefined], [""]])("ne touche pas au stockage pour %j", async (valeur) => {
    await deleteStorageObjectBestEffort(valeur);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("un chemin brut est supprimé du bucket PRIVÉ, tel quel, et de lui seul", async () => {
    await deleteStorageObjectBestEffort("tenants/1700-42.pdf");
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledWith("private-uploads");
    expect(mocks.remove).toHaveBeenCalledWith(["tenants/1700-42.pdf"]);
  });

  it("une URL de notre bucket public est supprimée du bucket PUBLIC, sous son chemin d'objet décodé", async () => {
    await deleteStorageObjectBestEffort(`${OURS}/properties/ma%20photo%C3%A9.png`);
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledWith("public-uploads");
    expect(mocks.remove).toHaveBeenCalledWith(["properties/ma photoé.png"]);
  });

  it.each([["https"], ["http"], ["HTTPS"], ["Http"]])("reconnaît une URL au schéma %s (sans tenir compte de la casse)", async (schema) => {
    await deleteStorageObjectBestEffort(`${schema}://abc.supabase.co/storage/v1/object/public/public-uploads/listings/1.png`);
    expect(mocks.from).toHaveBeenCalledWith("public-uploads");
    expect(mocks.remove).toHaveBeenCalledWith(["listings/1.png"]);
  });

  it.each([
    ["une URL sans le chemin du stockage public", "https://abc.supabase.co/logo.png"],
    ["l'URL publique d'un AUTRE bucket", "https://abc.supabase.co/storage/v1/object/public/autre-bucket/x.png"],
    ["l'URL d'un objet privé", "https://abc.supabase.co/storage/v1/object/private-uploads/x.png"],
    ["une adresse externe", "https://tiers.example/photo.png"],
  ])("ne supprime rien quand c'est %s : on préfère un fichier orphelin au mauvais objet", async (_nom, url) => {
    await deleteStorageObjectBestEffort(url);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("un chemin brut qui contient « http » sans commencer par lui reste un chemin privé", async () => {
    await deleteStorageObjectBestEffort("documents/http://x.pdf");
    expect(mocks.from).toHaveBeenCalledWith("private-uploads");
    expect(mocks.remove).toHaveBeenCalledWith(["documents/http://x.pdf"]);
  });

  it("n'échoue jamais : une panne du stockage est journalisée, pas remontée", async () => {
    const erreur = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.remove.mockRejectedValueOnce(new Error("stockage indisponible"));

    await expect(deleteStorageObjectBestEffort("tenants/1.pdf")).resolves.toBeUndefined();
    expect(erreur).toHaveBeenCalledTimes(1);
    expect(String(erreur.mock.calls[0][0])).toContain("[storage]");

    mocks.remove.mockRejectedValueOnce(new Error("stockage indisponible"));
    await expect(deleteStorageObjectBestEffort(`${OURS}/properties/1.png`)).resolves.toBeUndefined();
    expect(erreur).toHaveBeenCalledTimes(2);
  });

  it("une réponse d'erreur du stockage ne lève rien non plus", async () => {
    mocks.remove.mockResolvedValueOnce({ data: null, error: { message: "introuvable" } });
    await expect(deleteStorageObjectBestEffort("issues/1.jpg")).resolves.toBeUndefined();
  });
});

describe("chargerLogoAgence : signature du fichier", () => {
  const png = (longueur: number) => Buffer.concat([BUFFER(0x89, 0x50, 0x4e, 0x47), Buffer.alloc(Math.max(0, longueur - 4), 1)]);
  const jpeg = (longueur: number) => Buffer.concat([BUFFER(0xff, 0xd8, 0xff), Buffer.alloc(Math.max(0, longueur - 3), 1)]);

  it("télécharge par le chemin d'objet DÉCODÉ, dans le bucket public", async () => {
    mocks.download.mockResolvedValueOnce({ data: blob(png(20)), error: null });
    await chargerLogoAgence(`${OURS}/agency/mon%20logo.png`);
    expect(mocks.from).toHaveBeenCalledWith("public-uploads");
    expect(mocks.download).toHaveBeenCalledWith("agency/mon logo.png");
  });

  it("un PNG est accepté dès 9 octets, pas à 8", async () => {
    mocks.download.mockResolvedValueOnce({ data: blob(png(9)), error: null });
    expect(await chargerLogoAgence(`${OURS}/agency/a.png`)).not.toBeNull();
    mocks.download.mockResolvedValueOnce({ data: blob(png(8)), error: null });
    expect(await chargerLogoAgence(`${OURS}/agency/a.png`)).toBeNull();
  });

  it("un JPEG est accepté dès 4 octets, pas à 3", async () => {
    mocks.download.mockResolvedValueOnce({ data: blob(jpeg(4)), error: null });
    expect(await chargerLogoAgence(`${OURS}/agency/a.jpg`)).not.toBeNull();
    mocks.download.mockResolvedValueOnce({ data: blob(jpeg(3)), error: null });
    expect(await chargerLogoAgence(`${OURS}/agency/a.jpg`)).toBeNull();
  });

  it.each([
    ["un PNG dont le 2e octet est faux", BUFFER(0x89, 0x51, 0x4e, 0x47, 1, 1, 1, 1, 1, 1)],
    ["un PNG dont le 3e octet est faux", BUFFER(0x89, 0x50, 0x4f, 0x47, 1, 1, 1, 1, 1, 1)],
    ["un PNG dont le 4e octet est faux", BUFFER(0x89, 0x50, 0x4e, 0x48, 1, 1, 1, 1, 1, 1)],
    ["un PNG dont le 1er octet est faux", BUFFER(0x88, 0x50, 0x4e, 0x47, 1, 1, 1, 1, 1, 1)],
    ["un JPEG dont le 2e octet est faux", BUFFER(0xff, 0xd9, 0xff, 1, 1)],
    ["un JPEG dont le 3e octet est faux", BUFFER(0xff, 0xd8, 0xfe, 1, 1)],
    ["un JPEG dont le 1er octet est faux", BUFFER(0xfe, 0xd8, 0xff, 1, 1)],
    ["un fichier HTML", Buffer.from("<html><body>pas une image</body></html>")],
    ["un fichier vide", Buffer.alloc(0)],
  ])("refuse %s", async (_nom, octets) => {
    mocks.download.mockResolvedValueOnce({ data: blob(octets), error: null });
    expect(await chargerLogoAgence(`${OURS}/agency/a.png`)).toBeNull();
  });

  it("rend exactement les octets du fichier, sans rien y changer", async () => {
    const original = png(40);
    mocks.download.mockResolvedValueOnce({ data: blob(original), error: null });
    const rendu = await chargerLogoAgence(`${OURS}/agency/a.png`);
    expect(rendu?.equals(original)).toBe(true);
  });

  it("un téléchargement en erreur, ou sans contenu, vaut null", async () => {
    mocks.download.mockResolvedValueOnce({ data: blob(png(20)), error: { message: "introuvable" } });
    expect(await chargerLogoAgence(`${OURS}/agency/a.png`)).toBeNull();
    mocks.download.mockResolvedValueOnce({ data: null, error: null });
    expect(await chargerLogoAgence(`${OURS}/agency/a.png`)).toBeNull();
  });

  it("un objet sans contenu vaut null SANS bruit : aucune erreur journalisée, ce n'est pas une panne", async () => {
    const erreur = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.download.mockResolvedValueOnce({ data: null, error: null });
    expect(await chargerLogoAgence(`${OURS}/agency/a.png`)).toBeNull();
    expect(erreur).not.toHaveBeenCalled();
  });

  it("n'échoue jamais : une panne de téléchargement est journalisée et vaut null", async () => {
    const erreur = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.download.mockRejectedValueOnce(new Error("réseau coupé"));
    expect(await chargerLogoAgence(`${OURS}/agency/a.png`)).toBeNull();
    expect(erreur).toHaveBeenCalledTimes(1);
    expect(String(erreur.mock.calls[0][0])).toContain("[storage]");
  });

  it.each([[null], [undefined], [""], ["pas une url"]])("une adresse %j ne déclenche aucun téléchargement", async (url) => {
    expect(await chargerLogoAgence(url)).toBeNull();
    expect(mocks.download).not.toHaveBeenCalled();
  });
});

describe("estUrlPubliqueDuStockage : ce qui est vraiment NOTRE adresse", () => {
  it("accepte l'URL publique exacte de notre bucket", () => {
    expect(estUrlPubliqueDuStockage(`${OURS}/agency/logo.png`)).toBe(true);
  });

  it.each([
    ["un hôte qui commence comme le nôtre", "https://abc.supabase.co.pirate.example/storage/v1/object/public/public-uploads/a.png"],
    ["une adresse qui cache l'hôte réel derrière un identifiant", "https://abc.supabase.co@pirate.example/storage/v1/object/public/public-uploads/a.png"],
    ["le même hôte en http", "http://abc.supabase.co/storage/v1/object/public/public-uploads/a.png"],
    ["le même hôte sur un autre port", "https://abc.supabase.co:8443/storage/v1/object/public/public-uploads/a.png"],
    ["un sous-domaine du nôtre", "https://autre.abc.supabase.co/storage/v1/object/public/public-uploads/a.png"],
    ["le bon hôte avec un autre bucket", "https://abc.supabase.co/storage/v1/object/public/autre/a.png"],
    ["le bon hôte sans le chemin du stockage", "https://abc.supabase.co/a.png"],
    ["une adresse locale", "http://169.254.169.254/latest/meta-data/"],
    ["du texte", "pas une url"],
  ])("refuse %s", (_nom, url) => {
    expect(estUrlPubliqueDuStockage(url)).toBe(false);
  });

  it.each([[null], [undefined], [""]])("refuse %j", (valeur) => {
    expect(estUrlPubliqueDuStockage(valeur)).toBe(false);
  });
});

const fichier = (mimetype: string, contenu = "contenu") =>
  ({ fieldname: "file", originalname: "x", encoding: "7bit", mimetype, size: contenu.length, buffer: Buffer.from(contenu) }) as Express.Multer.File;

describe("envoi de fichiers : le bon bucket, les bons réglages", () => {
  it("une photo publique part dans le bucket PUBLIC (et son URL est lue dans ce bucket), jamais dans le privé", async () => {
    const url = await uploadPublicFile(fichier("image/png"), "properties");

    expect(url).toBe("https://cdn.test/public-uploads/photo.png");
    expect(mocks.operations).toEqual([
      ["upload", "public-uploads"],
      ["getPublicUrl", "public-uploads"],
    ]);
  });

  it("un fichier privé part dans le bucket PRIVÉ, jamais dans le public, et seul son chemin est rendu", async () => {
    const chemin = await uploadPrivateFile(fichier("application/pdf"), "tenants");

    expect(chemin).toMatch(/^tenants\/\d+-\d+\.pdf$/);
    expect(mocks.operations).toEqual([["upload", "private-uploads"]]);
    expect(mocks.getPublicUrl).not.toHaveBeenCalled();
  });

  it.each([
    ["public", (f: Express.Multer.File) => uploadPublicFile(f, "properties")],
    ["privé", (f: Express.Multer.File) => uploadPrivateFile(f, "issues")],
  ])("envoi %s : le type du fichier est transmis, rien n'est jamais écrasé, le contenu est celui du fichier", async (_nom, envoyer) => {
    await envoyer(fichier("image/jpeg", "octets-du-fichier"));

    const [chemin, contenu, options] = mocks.upload.mock.calls[0];
    expect(String(chemin)).toMatch(/\.jpg$/);
    expect((contenu as Buffer).toString()).toBe("octets-du-fichier");
    expect(options).toEqual({ contentType: "image/jpeg", upsert: false });
  });

  it.each([
    ["public", (f: Express.Multer.File) => uploadPublicFile(f, "agency")],
    ["privé", (f: Express.Multer.File) => uploadPrivateFile(f, "documents")],
  ])("envoi %s refusé par le stockage : ApiError 500 STORAGE_UPLOAD_FAILED, avec la raison", async (_nom, envoyer) => {
    mocks.upload.mockResolvedValueOnce({ error: { message: "quota dépassé" } });

    const erreur = await envoyer(fichier("image/png")).catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(ApiError);
    expect(erreur).toMatchObject({ statusCode: 500, code: "STORAGE_UPLOAD_FAILED" });
    expect((erreur as Error).message).toContain("quota dépassé");
  });

  it.each([
    ["image/png", ".png"],
    ["image/jpeg", ".jpg"],
    ["image/webp", ".webp"],
    ["image/gif", ".gif"],
    ["application/pdf", ".pdf"],
    ["audio/webm", ".webm"],
    ["audio/mp4", ".m4a"],
    ["audio/ogg", ".ogg"],
  ])("le type %s donne l'extension %s", async (mimetype, extension) => {
    await uploadPrivateFile(fichier(mimetype), "messages");
    expect(String(mocks.upload.mock.calls[0][0])).toMatch(new RegExp(`^messages/\\d+-\\d+\\${extension}$`));
  });
});

describe("URL signée", () => {
  it("rend l'URL du bucket privé, valable 1 heure par défaut, ou la durée demandée", async () => {
    expect(await getSignedUrl("tenants/1.pdf")).toBe("https://cdn.test/signed/abc");
    expect(mocks.createSignedUrl).toHaveBeenLastCalledWith("tenants/1.pdf", 3600);
    expect(mocks.operations).toEqual([["createSignedUrl", "private-uploads"]]);

    await getSignedUrl("tenants/1.pdf", 120);
    expect(mocks.createSignedUrl).toHaveBeenLastCalledWith("tenants/1.pdf", 120);
  });

  it.each([
    ["une erreur du stockage", { data: null, error: { message: "objet introuvable" } }, "objet introuvable"],
    ["une erreur malgré des données", { data: { signedUrl: "https://cdn.test/x" }, error: { message: "refusé" } }, "refusé"],
    ["aucune donnée et aucune erreur", { data: null, error: null }, "erreur inconnue"],
  ])("%s : ApiError 500 STORAGE_SIGNED_URL_FAILED, avec la raison", async (_nom, reponse, raison) => {
    mocks.createSignedUrl.mockResolvedValueOnce(reponse);
    const erreur = await getSignedUrl("tenants/1.pdf").catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(ApiError);
    expect(erreur).toMatchObject({ statusCode: 500, code: "STORAGE_SIGNED_URL_FAILED" });
    expect((erreur as Error).message).toContain(raison);
  });
});

describe("signature en lot", () => {
  const signerTout = (chemins: string[]) => ({ data: chemins.map((path) => ({ path, signedUrl: `https://cdn.test/signed/${path}`, error: null })), error: null });
  const chemins = (n: number) => Array.from({ length: n }, (_, i) => `issues/${i}.jpg`);

  it.each([
    [100, [100]],
    [101, [100, 1]],
    [250, [100, 100, 50]],
    [200, [100, 100]],
  ])("%i chemins sont signés en lots de %j", async (total, tailles) => {
    mocks.createSignedUrls.mockImplementation(async (lot: string[]) => signerTout(lot));
    const urls = await getSignedUrls(chemins(total));

    expect(mocks.createSignedUrls.mock.calls.map((c) => (c[0] as string[]).length)).toEqual(tailles);
    expect(urls.size).toBe(total);
    expect(mocks.operations.every(([nom, bucket]) => nom === "createSignedUrls" && bucket === "private-uploads")).toBe(true);
  });

  it("transmet la durée demandée, 1 heure par défaut", async () => {
    mocks.createSignedUrls.mockImplementation(async (lot: string[]) => signerTout(lot));
    await getSignedUrls(["a.jpg"]);
    expect(mocks.createSignedUrls).toHaveBeenLastCalledWith(["a.jpg"], 3600);
    await getSignedUrls(["a.jpg"], 90);
    expect(mocks.createSignedUrls).toHaveBeenLastCalledWith(["a.jpg"], 90);
  });

  it("un élément en erreur, sans chemin ou sans URL ne compte jamais comme signé", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.createSignedUrls.mockResolvedValueOnce({
      data: [
        { path: "ok.jpg", signedUrl: "https://cdn.test/signed/ok", error: null },
        { path: "erreur.jpg", signedUrl: "https://cdn.test/signed/erreur", error: "Object not found" },
        { path: "vide.jpg", signedUrl: "", error: null },
        { path: null, signedUrl: "https://cdn.test/signed/sans-chemin", error: null },
      ],
      error: null,
    });

    const urls = await getSignedUrls(["ok.jpg", "erreur.jpg", "vide.jpg", "absent.jpg"]);
    expect(urls.get("ok.jpg")).toBe("https://cdn.test/signed/ok");
    expect(urls.get("erreur.jpg")).toBeNull();
    expect(urls.get("vide.jpg")).toBeNull();
    expect(urls.get("absent.jpg")).toBeNull();
    expect([...urls.keys()].every((cle) => typeof cle === "string")).toBe(true);
    expect(urls.size).toBe(4);
  });

  it("une panne du stockage est journalisée avec sa raison et le nombre de fichiers, et les lots suivants sont tentés", async () => {
    const erreur = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.createSignedUrls
      .mockResolvedValueOnce({ data: null, error: { message: "stockage indisponible" } })
      .mockImplementationOnce(async (lot: string[]) => signerTout(lot));

    const urls = await getSignedUrls(chemins(150));

    expect(erreur).toHaveBeenCalledWith(expect.stringContaining("(100 fichier(s))"), "stockage indisponible");
    expect(erreur).toHaveBeenCalledTimes(1); // une seule ligne de journal : une réponse d'erreur n'est pas une exception
    expect(mocks.createSignedUrls).toHaveBeenCalledTimes(2);
    expect(urls.get("issues/0.jpg")).toBeNull();
    expect(urls.get("issues/120.jpg")).toBe("https://cdn.test/signed/issues/120.jpg");
  });
});
