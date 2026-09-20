import multer from "multer";
import { ApiError } from "../utils/asyncHandler";

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);

/** Taille maximale d'un fichier uploadé. Exportée pour que le message d'erreur
 * renvoyé au client (voir errorHandler.ts) reste toujours cohérent avec la
 * limite réellement appliquée ici. */
export const MAX_UPLOAD_SIZE_MB = 8;

function fileFilter(_req: unknown, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    // ApiError et non Error : un type de fichier refusé est une erreur du
    // client (400), pas une panne du serveur. Une Error nue retombait dans la
    // branche générique 500 d'errorHandler, qui masquait la vraie raison du
    // refus au client et remontait chaque tentative à Sentry comme un défaut
    // applicatif.
    return cb(new ApiError(400, "Type de fichier non autorisé (image ou PDF uniquement)"));
  }
  cb(null, true);
}

const limits = { fileSize: MAX_UPLOAD_SIZE_MB * 1024 * 1024 };

// Stockage en mémoire (buffer) : les fichiers sont uploadés vers Supabase
// Storage juste après, aucun disque local n'est utilisé (nécessaire sur
// Vercel, dont les fonctions serverless n'ont pas de disque persistant).
const storage = multer.memoryStorage();

export const uploadPropertyImage = multer({ storage, fileFilter, limits });
export const uploadTenantDocument = multer({ storage, fileFilter, limits });
export const uploadIssuePhoto = multer({ storage, fileFilter, limits });
export const uploadContractScan = multer({ storage, fileFilter, limits });
export const uploadListingImage = multer({ storage, fileFilter, limits });

/**
 * `fileFilter` ci-dessus ne contrôle que le champ `Content-Type` envoyé par
 * le client dans le multipart — une simple déclaration, jamais vérifiée
 * contre le contenu réel du fichier. Rien n'empêchait donc d'uploader un
 * exécutable, un script, ou une page HTML (risque XSS si le fichier est
 * ensuite resservi tel quel) en se contentant de mentir sur le
 * `Content-Type` (ex: "image/png" pour un fichier .html ou .exe).
 *
 * On vérifie ici, une fois le fichier reçu en mémoire, que ses premiers
 * octets (sa "signature magique") correspondent réellement au type déclaré
 * — les cinq formats couverts par ALLOWED_MIME ont chacun une signature
 * fixe et bien connue, qu'aucun renommage d'extension ou d'en-tête HTTP ne
 * peut falsifier sans corrompre le fichier lui-même.
 */
function detectFileSignature(buffer: Buffer): string | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 6 &&
    buffer.toString("ascii", 0, 3) === "GIF" &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return "image/gif";
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (buffer.length >= 5 && buffer.toString("ascii", 0, 5) === "%PDF-") {
    return "application/pdf";
  }
  return null;
}

/**
 * À appeler dans chaque contrôleur juste avant `uploadPublicFile`/
 * `uploadPrivateFile`, APRÈS la vérification de propriété (voir le
 * correctif « upload avant vérification de propriété ») — jamais comme
 * middleware de route placé avant le contrôleur : cela ferait échouer la
 * requête sur un 400 « contenu invalide » avant même que le contrôleur
 * n'ait eu la chance de renvoyer son propre 403/404 sur une tentative
 * illégitime, ce qui serait un signal plus bruyant et moins précis pour le
 * client que le refus d'accès qu'il aurait dû recevoir en premier.
 */
export function assertFileContentMatchesDeclaredType(file: Express.Multer.File | undefined): void {
  if (!file) return;
  const detected = detectFileSignature(file.buffer);
  if (!detected || detected !== file.mimetype) {
    throw new ApiError(400, "Le contenu du fichier ne correspond pas au type de fichier déclaré");
  }
}
