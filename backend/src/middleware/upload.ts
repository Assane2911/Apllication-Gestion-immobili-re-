import multer from "multer";

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);

function fileFilter(_req: unknown, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(new Error("Type de fichier non autorisé (image ou PDF uniquement)"));
  }
  cb(null, true);
}

const limits = { fileSize: 8 * 1024 * 1024 }; // 8 Mo

// Stockage en mémoire (buffer) : les fichiers sont uploadés vers Supabase
// Storage juste après, aucun disque local n'est utilisé (nécessaire sur
// Vercel, dont les fonctions serverless n'ont pas de disque persistant).
const storage = multer.memoryStorage();

export const uploadPropertyImage = multer({ storage, fileFilter, limits });
export const uploadTenantDocument = multer({ storage, fileFilter, limits });
export const uploadIssuePhoto = multer({ storage, fileFilter, limits });
