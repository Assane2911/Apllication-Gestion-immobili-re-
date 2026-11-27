import express from "express";
import type multer from "multer";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../utils/asyncHandler";
import { errorHandler } from "./errorHandler";
import {
  assertAudioContentMatchesDeclaredType,
  assertFileContentMatchesDeclaredType,
  MAX_LOGO_SIZE_MB,
  MAX_UPLOAD_SIZE_MB,
  uploadAgencyLogo,
  uploadAgencyStamp,
  uploadContractScan,
  uploadIssuePhoto,
  uploadLeaseNoticeDocument,
  uploadListingImage,
  uploadMessageAudio,
  uploadPropertyImage,
  uploadStoredDocument,
  uploadTenantDocument,
} from "./upload";

/**
 * Audit par sabotage de upload.ts : chaque lecteur de fichiers est monté seul, sur une mini-application qui répond comme l'API
 * (même gestionnaire d'erreurs), pour vérifier précisément ce que chacun accepte et refuse — les types, les plafonds de taille à
 * l'octet près, les codes d'erreur — et la lecture des premiers octets qui confronte le contenu au type déclaré.
 */
const MO = 1024 * 1024;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

function miniApp(lecteur: multer.Multer, apres?: (fichier: Express.Multer.File | undefined) => void) {
  const app = express();
  app.post("/", lecteur.single("f"), (req, res) => {
    apres?.(req.file);
    res.json({ ok: true, mimetype: req.file?.mimetype, taille: req.file?.size });
  });
  app.use(errorHandler);
  return app;
}
const envoyer = (app: express.Express, contenu: Buffer, type: string) => request(app).post("/").attach("f", contenu, { filename: "fichier", contentType: type });

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const GIF89 = Buffer.from("GIF89a-contenu");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WEBP"), Buffer.from("-contenu")]);
const PDF = Buffer.from("%PDF-1.4 contenu");
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
const OGG = Buffer.from("OggS-contenu");
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftyp"), Buffer.from("isom0000")]);

const LECTEURS_IMAGE: Array<[string, multer.Multer]> = [
  ["photo de bien", uploadPropertyImage],
  ["photo d'incident", uploadIssuePhoto],
  ["image d'annonce", uploadListingImage],
];
const LECTEURS_DOCUMENT: Array<[string, multer.Multer]> = [
  ["pièce d'un locataire", uploadTenantDocument],
  ["scan de contrat", uploadContractScan],
  ["document de congé", uploadLeaseNoticeDocument],
  ["document rangé", uploadStoredDocument],
];

describe("photos : une image, jamais un PDF", () => {
  describe.each(LECTEURS_IMAGE)("%s", (_nom, lecteur) => {
    it.each([["image/png"], ["image/jpeg"], ["image/webp"], ["image/gif"]])("accepte %s", async (type) => {
      const res = await envoyer(miniApp(lecteur), PNG, type);
      expect(res.status).toBe(200);
      expect(res.body.mimetype).toBe(type);
    });

    it.each([["application/pdf"], ["image/svg+xml"], ["image/bmp"], ["text/html"], ["application/x-msdownload"], ["audio/webm"]])(
      "refuse %s : 400 FILE_IMAGE_ONLY",
      async (type) => {
        const res = await envoyer(miniApp(lecteur), PNG, type);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("FILE_IMAGE_ONLY");
        expect(res.body.error).toBe("Photo non autorisée (image PNG, JPEG, WebP ou GIF uniquement)");
      }
    );
  });
});

describe("documents : une image ou un PDF", () => {
  describe.each(LECTEURS_DOCUMENT)("%s", (_nom, lecteur) => {
    it.each([["image/png"], ["image/jpeg"], ["image/webp"], ["image/gif"], ["application/pdf"]])("accepte %s", async (type) => {
      const res = await envoyer(miniApp(lecteur), PDF, type);
      expect(res.status).toBe(200);
      expect(res.body.mimetype).toBe(type);
    });

    it.each([["image/svg+xml"], ["text/html"], ["application/zip"], ["application/x-msdownload"], ["audio/mp4"], ["text/plain"]])(
      "refuse %s : 400 FILE_TYPE_NOT_ALLOWED",
      async (type) => {
        const res = await envoyer(miniApp(lecteur), PDF, type);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("FILE_TYPE_NOT_ALLOWED");
        expect(res.body.error).toBe("Type de fichier non autorisé (image ou PDF uniquement)");
      }
    );
  });
});

describe("logo et tampon de l'agence : PNG ou JPEG seulement", () => {
  it.each([
    ["logo", uploadAgencyLogo, "Logo", "UPLOAD_LOGO_IMAGE_ONLY"],
    ["tampon", uploadAgencyStamp, "Tampon", "UPLOAD_STAMP_IMAGE_ONLY"],
  ])("%s : accepte PNG et JPEG, refuse le reste avec son code", async (_nom, lecteur, libelle, code) => {
    const app = miniApp(lecteur);
    expect((await envoyer(app, PNG, "image/png")).status).toBe(200);
    expect((await envoyer(app, JPEG, "image/jpeg")).status).toBe(200);
    for (const type of ["image/gif", "image/webp", "application/pdf", "image/svg+xml", "text/html"]) {
      const res = await envoyer(app, PNG, type);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(code);
      expect(res.body.error).toBe(`${libelle} : image PNG ou JPEG uniquement`);
    }
  });
});

describe("messages vocaux : WebM, Ogg ou MP4, type ramené à sa forme de base", () => {
  it.each([
    ["audio/webm", "audio/webm"],
    ["audio/ogg", "audio/ogg"],
    ["audio/mp4", "audio/mp4"],
    ["audio/webm;codecs=opus", "audio/webm"],
    ["audio/ogg; codecs=opus", "audio/ogg"],
    ["AUDIO/WEBM", "audio/webm"],
    ["audio/x-m4a", "audio/mp4"],
    ["audio/m4a", "audio/mp4"],
    ["video/webm", "audio/webm"],
  ])("accepte %s et le range sous %s", async (declare, attendu) => {
    const res = await envoyer(miniApp(uploadMessageAudio), WEBM, declare);
    expect(res.status).toBe(200);
    expect(res.body.mimetype).toBe(attendu);
  });

  it.each([["audio/mpeg"], ["audio/wav"], ["audio/aac"], ["image/png"], ["application/pdf"], ["text/html"], ["video/mp4"], ["audio/"]])(
    "refuse %s : 400 AUDIO_TYPE_NOT_ALLOWED",
    async (type) => {
      const res = await envoyer(miniApp(uploadMessageAudio), WEBM, type);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("AUDIO_TYPE_NOT_ALLOWED");
      expect(res.body.error).toBe("Type d'enregistrement non autorisé (WebM, Ogg ou MP4 uniquement)");
    }
  );
});

describe("plafonds de taille, à l'octet près", () => {
  it("annonce 4 Mo pour les fichiers et 2 Mo pour le logo et le tampon", () => {
    expect(MAX_UPLOAD_SIZE_MB).toBe(4);
    expect(MAX_LOGO_SIZE_MB).toBe(2);
  });

  it.each([
    ["photo de bien", uploadPropertyImage, "image/png", 4 * MO],
    ["photo d'incident", uploadIssuePhoto, "image/jpeg", 4 * MO],
    ["image d'annonce", uploadListingImage, "image/webp", 4 * MO],
    ["pièce d'un locataire", uploadTenantDocument, "application/pdf", 4 * MO],
    ["scan de contrat", uploadContractScan, "application/pdf", 4 * MO],
    ["document de congé", uploadLeaseNoticeDocument, "application/pdf", 4 * MO],
    ["document rangé", uploadStoredDocument, "application/pdf", 4 * MO],
    ["message vocal", uploadMessageAudio, "audio/webm", 4 * MO],
    ["logo", uploadAgencyLogo, "image/png", 2 * MO],
    ["tampon", uploadAgencyStamp, "image/jpeg", 2 * MO],
  ])("%s : le plafond exact passe, un octet de plus est refusé en LIMIT_FILE_SIZE", async (_nom, lecteur, type, plafond) => {
    const app = miniApp(lecteur);
    const pile = await envoyer(app, Buffer.alloc(plafond, 1), type);
    expect(pile.status).toBe(200);
    expect(pile.body.taille).toBe(plafond);

    const trop = await envoyer(app, Buffer.alloc(plafond + 1, 1), type);
    expect(trop.status).toBe(400);
    expect(trop.body.code).toBe("LIMIT_FILE_SIZE");
  });
});

describe("le contenu doit être celui du type déclaré : lecture des premiers octets", () => {
  const fichier = (contenu: Buffer, type: string) => ({ buffer: contenu, mimetype: type }) as Express.Multer.File;
  const refus = (contenu: Buffer, type: string) => {
    try {
      assertFileContentMatchesDeclaredType(fichier(contenu, type));
      return null;
    } catch (e) {
      return e;
    }
  };

  it.each([
    ["un PNG", PNG, "image/png"],
    ["un JPEG", JPEG, "image/jpeg"],
    ["un GIF 89a", GIF89, "image/gif"],
    ["un GIF 87a", Buffer.from("GIF87a-contenu"), "image/gif"],
    ["un WebP", WEBP, "image/webp"],
    ["un PDF", PDF, "application/pdf"],
  ])("accepte %s déclaré correctement", (_nom, contenu, type) => {
    expect(refus(contenu, type)).toBeNull();
  });

  it("accepte l'absence de fichier : le contrôleur décide de ce qu'il en fait", () => {
    expect(() => assertFileContentMatchesDeclaredType(undefined)).not.toThrow();
    expect(() => assertAudioContentMatchesDeclaredType(undefined)).not.toThrow();
  });

  it.each([
    ["un PNG déclaré JPEG", PNG, "image/jpeg"],
    ["un JPEG déclaré PNG", JPEG, "image/png"],
    ["un PDF déclaré image", PDF, "image/png"],
    ["une image déclarée PDF", PNG, "application/pdf"],
    ["un GIF déclaré WebP", GIF89, "image/webp"],
    ["du HTML déclaré PNG", Buffer.from("<script>alert(1)</script>"), "image/png"],
    ["un exécutable déclaré PDF", Buffer.from("MZ\u0090\u0000"), "application/pdf"],
    ["un fichier vide", Buffer.alloc(0), "image/png"],
  ])("refuse %s : 400 FILE_CONTENT_MISMATCH", (_nom, contenu, type) => {
    const erreur = refus(contenu, type);
    expect(erreur).toBeInstanceOf(ApiError);
    expect(erreur).toMatchObject({ statusCode: 400, code: "FILE_CONTENT_MISMATCH" });
    expect((erreur as Error).message).toBe("Le contenu du fichier ne correspond pas au type de fichier déclaré");
  });

  it.each([
    ["PNG dont l'octet 5 est faux", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0e, 0x0a, 0x1a, 0x0a, 1]), "image/png"],
    ["PNG dont l'octet 6 est faux", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0b, 0x1a, 0x0a, 1]), "image/png"],
    ["PNG dont l'octet 7 est faux", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1b, 0x0a, 1]), "image/png"],
    ["PNG dont l'octet 8 est faux", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b, 1]), "image/png"],
    ["PNG tronqué à 7 octets", PNG.subarray(0, 7), "image/png"],
    ["JPEG dont le 1er octet est faux", Buffer.from([0xfe, 0xd8, 0xff, 1]), "image/jpeg"],
    ["JPEG dont le 2e octet est faux", Buffer.from([0xff, 0xd9, 0xff, 1]), "image/jpeg"],
    ["JPEG dont le 3e octet est faux", Buffer.from([0xff, 0xd8, 0xfe, 1]), "image/jpeg"],
    ["JPEG tronqué à 2 octets", Buffer.from([0xff, 0xd8]), "image/jpeg"],
    ["GIF dont le 4e octet est faux (GIF99a)", Buffer.from("GIF99a-x"), "image/gif"],
    ["GIF dont la version est fausse (GIF88a)", Buffer.from("GIF88a-x"), "image/gif"],
    ["GIF sans le « a » final (GIF89b)", Buffer.from("GIF89b-x"), "image/gif"],
    ["GIF tronqué à 5 octets", Buffer.from("GIF89"), "image/gif"],
    ["GIF dont l'en-tête est en minuscules", Buffer.from("gif89a-x"), "image/gif"],
    ["WebP sans « WEBP » en position 8", Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WAVE-x")]), "image/webp"],
    ["WebP sans « RIFF » en tête", Buffer.concat([Buffer.from("RIFX"), Buffer.from([1, 2, 3, 4]), Buffer.from("WEBP-x")]), "image/webp"],
    ["WebP tronqué à 11 octets", WEBP.subarray(0, 11), "image/webp"],
    ["PDF sans le tiret (%PDF1)", Buffer.from("%PDF1.4 x"), "application/pdf"],
    ["PDF tronqué à 4 octets", Buffer.from("%PDF"), "application/pdf"],
  ])("refuse %s", (_nom, contenu, type) => {
    expect(refus(contenu, type)).toMatchObject({ code: "FILE_CONTENT_MISMATCH" });
  });

  it.each([
    ["un PNG de 8 octets pile", PNG.subarray(0, 8), "image/png"],
    ["un JPEG de 3 octets pile", JPEG.subarray(0, 3), "image/jpeg"],
    ["un GIF de 6 octets pile", Buffer.from("GIF89a"), "image/gif"],
    ["un WebP de 12 octets pile", WEBP.subarray(0, 12), "image/webp"],
    ["un PDF de 5 octets pile", Buffer.from("%PDF-"), "application/pdf"],
  ])("accepte %s", (_nom, contenu, type) => {
    expect(refus(contenu, type)).toBeNull();
  });
});

describe("enregistrement : le contenu doit être celui du type déclaré", () => {
  const audio = (contenu: Buffer, type: string) => ({ buffer: contenu, mimetype: type }) as Express.Multer.File;

  it.each([
    ["WebM", WEBM, "audio/webm"],
    ["Ogg", OGG, "audio/ogg"],
    ["MP4", MP4, "audio/mp4"],
  ])("accepte un enregistrement %s déclaré correctement", (_nom, contenu, type) => {
    expect(() => assertAudioContentMatchesDeclaredType(audio(contenu, type))).not.toThrow();
  });

  it.each([
    ["un WebM déclaré Ogg", WEBM, "audio/ogg"],
    ["un Ogg déclaré MP4", OGG, "audio/mp4"],
    ["un MP4 déclaré WebM", MP4, "audio/webm"],
    ["une image déclarée audio", PNG, "audio/webm"],
    ["du texte déclaré audio", Buffer.from("pas de l'audio"), "audio/ogg"],
    ["un fichier vide", Buffer.alloc(0), "audio/webm"],
  ])("refuse %s : 400 AUDIO_CONTENT_MISMATCH", (_nom, contenu, type) => {
    let erreur: unknown = null;
    try {
      assertAudioContentMatchesDeclaredType(audio(contenu, type));
    } catch (e) {
      erreur = e;
    }
    expect(erreur).toBeInstanceOf(ApiError);
    expect(erreur).toMatchObject({ statusCode: 400, code: "AUDIO_CONTENT_MISMATCH" });
    expect((erreur as Error).message).toBe("Le contenu de l'enregistrement ne correspond pas au type déclaré");
  });
});
