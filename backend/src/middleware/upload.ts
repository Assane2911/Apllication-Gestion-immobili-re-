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
