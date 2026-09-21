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
 * biens, peu sensibles, et photos d'annonces de la vitrine publique —
 * "listings", puisqu'une annonce est par nature destinée à être vue par
 * n'importe quel visiteur non authentifié) et retourne son URL publique,
 * directement utilisable côté frontend. Les photos d'incidents, elles,
 * passent par `uploadPrivateFile` ci-dessous : elles peuvent montrer
 * l'intérieur du logement d'un locataire et ne doivent pas être
 * devinables/accessibles sans autorisation (voir issue.controller.ts).
 */
export async function uploadPublicFile(file: Express.Multer.File, folder: "properties" | "listings") {
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
 * d'identité des locataires, photos d'incidents) et retourne le chemin de
 * stockage — PAS une URL — à conserver en base. Utilisez `getSignedUrl` pour
 * générer un lien d'accès temporaire à la demande.
 */
export async function uploadPrivateFile(file: Express.Multer.File, folder: "tenants" | "issues" | "contracts") {
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

/**
 * Extrait le chemin d'objet à partir d'une URL PUBLIQUE générée par
 * `getPublicUrl` (bucket public) — introuvable pour toute autre URL (domaine
 * externe, ancien lien non reconnu...), auquel cas on renvoie `null` plutôt
 * que de risquer de supprimer le mauvais objet.
 */
function extractPublicObjectPath(url: string): string | null {
  const marker = `/storage/v1/object/public/${STORAGE_BUCKETS.public}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}

/**
 * Supprime un objet Supabase Storage en best-effort — bucket privé ou
 * public déduit automatiquement selon que `value` est un chemin brut (voir
 * `uploadPrivateFile`) ou une URL complète (voir `uploadPublicFile`).
 *
 * Utilisée par la suppression de compte (auth.controller.ts::deleteMyAccount)
 * pour nettoyer les fichiers qui, sans cela, resteraient orphelins dans le
 * bucket une fois supprimées les lignes qui en gardaient la référence.
 * N'échoue JAMAIS : un fichier orphelin est un moindre mal qu'une suppression
 * de compte bloquée par un simple souci de stockage, et cette fonction est
 * volontairement appelée APRÈS le commit de la transaction de suppression,
 * jamais avant ni à l'intérieur.
 */
export async function deleteStorageObjectBestEffort(value: string | null | undefined): Promise<void> {
  if (!value) return;
  try {
    if (/^https?:\/\//i.test(value)) {
      const objectPath = extractPublicObjectPath(value);
      if (!objectPath) return;
      await supabaseAdmin.storage.from(STORAGE_BUCKETS.public).remove([objectPath]);
    } else {
      await supabaseAdmin.storage.from(STORAGE_BUCKETS.private).remove([value]);
    }
  } catch (err) {
    console.error("[storage] Échec de la suppression best-effort d'un objet :", err);
  }
}
