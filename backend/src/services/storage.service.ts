import path from "path";
import { STORAGE_BUCKETS, supabaseAdmin } from "../config/supabase";
import { ApiError } from "../utils/asyncHandler";

function uniqueObjectPath(folder: string, originalName: string) {
  const ext = path.extname(originalName).toLowerCase();
  const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  return `${folder}/${unique}`;
}

/**
 * Upload un fichier vers le bucket PUBLIC de Supabase Storage (images de
 * biens, photos d'incidents) et retourne son URL publique, directement
 * utilisable côté frontend.
 */
export async function uploadPublicFile(file: Express.Multer.File, folder: "properties" | "issues") {
  const objectPath = uniqueObjectPath(folder, file.originalname);

  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKETS.public)
    .upload(objectPath, file.buffer, { contentType: file.mimetype, upsert: false });

  if (error) {
    throw new ApiError(500, `Échec de l'upload vers Supabase Storage : ${error.message}`);
  }

  const { data } = supabaseAdmin.storage.from(STORAGE_BUCKETS.public).getPublicUrl(objectPath);
  return data.publicUrl;
}

/**
 * Upload un fichier vers le bucket PRIVÉ de Supabase Storage (pièces
 * d'identité des locataires) et retourne le chemin de stockage — PAS une
 * URL — à conserver en base. Utilisez `getSignedUrl` pour générer un lien
 * d'accès temporaire à la demande.
 */
export async function uploadPrivateFile(file: Express.Multer.File, folder: "tenants") {
  const objectPath = uniqueObjectPath(folder, file.originalname);

  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKETS.private)
    .upload(objectPath, file.buffer, { contentType: file.mimetype, upsert: false });

  if (error) {
    throw new ApiError(500, `Échec de l'upload vers Supabase Storage : ${error.message}`);
  }

  return objectPath;
}

/** Génère une URL signée temporaire (1h par défaut) pour un fichier du bucket privé. */
export async function getSignedUrl(objectPath: string, expiresInSeconds = 3600) {
  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKETS.private)
    .createSignedUrl(objectPath, expiresInSeconds);

  if (error || !data) {
    throw new ApiError(500, `Impossible de générer l'URL signée : ${error?.message ?? "erreur inconnue"}`);
  }

  return data.signedUrl;
}
