import { STORAGE_BUCKETS, SUPABASE_URL_EFFECTIVE, supabaseAdmin } from "../config/supabase";
import { ApiError } from "../utils/asyncHandler";

/**
 * Extension du fichier rangé, tirée de son TYPE (déjà confronté au contenu réel par
 * `assertFileContentMatchesDeclaredType`) et non du nom envoyé par le client : « evil.html » portant un vrai PNG
 * était rangé en .html, et un nom à l'extension exotique (« photo.jpég ») donnait une clé de stockage invalide,
 * donc une erreur 500. Un type inconnu n'a pas d'extension.
 */
const EXTENSION_PAR_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/pdf": ".pdf",
};

function uniqueObjectPath(folder: string, mimetype: string) {
  const ext = EXTENSION_PAR_TYPE[mimetype] ?? "";
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
export async function uploadPublicFile(file: Express.Multer.File, folder: "properties" | "listings" | "agency") {
  const objectPath = uniqueObjectPath(folder, file.mimetype);

  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKETS.public)
    .upload(objectPath, file.buffer, { contentType: file.mimetype, upsert: false });

  if (error) {
    throw new ApiError(500, `Échec de l'upload vers Supabase Storage : ${error.message}`, "STORAGE_UPLOAD_FAILED");
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
  const objectPath = uniqueObjectPath(folder, file.mimetype);

  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKETS.private)
    .upload(objectPath, file.buffer, { contentType: file.mimetype, upsert: false });

  if (error) {
    throw new ApiError(500, `Échec de l'upload vers Supabase Storage : ${error.message}`, "STORAGE_UPLOAD_FAILED");
  }

  return objectPath;
}

/** Génère une URL signée temporaire (1h par défaut) pour un fichier du bucket privé. */
export async function getSignedUrl(objectPath: string, expiresInSeconds = 3600) {
  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKETS.private)
    .createSignedUrl(objectPath, expiresInSeconds);

  if (error || !data) {
    throw new ApiError(500, `Impossible de générer l'URL signée : ${error?.message ?? "erreur inconnue"}`, "STORAGE_SIGNED_URL_FAILED");
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

/**
 * Vrai si `url` est une URL publique de NOTRE bucket public (même hôte que le stockage configuré, même
 * bucket). Un logo d'agence est affiché dans des documents et récupéré côté serveur pour les PDF : accepter
 * n'importe quelle adresse y ferait entrer un pixel espion ou une requête vers un service interne.
 */
export function estUrlPubliqueDuStockage(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    return new URL(url).origin === new URL(SUPABASE_URL_EFFECTIVE).origin && extractPublicObjectPath(url) !== null;
  } catch {
    return false;
  }
}

/**
 * Octets du logo d'une agence, pour l'incruster dans un PDF — `null` si l'URL n'est pas la nôtre, si l'objet est
 * introuvable ou si ce n'est pas un PNG ou un JPEG (les seuls formats que savent dessiner les PDF produits ici).
 * N'échoue jamais : un logo illisible ne doit pas empêcher d'émettre une quittance. Le téléchargement passe par
 * le client de stockage, avec le CHEMIN de l'objet, jamais par une requête vers l'URL fournie.
 */
export async function chargerLogoAgence(url: string | null | undefined): Promise<Buffer | null> {
  if (!estUrlPubliqueDuStockage(url)) return null;
  const objectPath = extractPublicObjectPath(url);
  if (!objectPath) return null;
  try {
    const { data, error } = await supabaseAdmin.storage.from(STORAGE_BUCKETS.public).download(objectPath);
    if (error || !data) return null;
    const octets = Buffer.from(await data.arrayBuffer());
    const png = octets.length > 8 && octets[0] === 0x89 && octets[1] === 0x50 && octets[2] === 0x4e && octets[3] === 0x47;
    const jpeg = octets.length > 3 && octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff;
    return png || jpeg ? octets : null;
  } catch (err) {
    console.error("[storage] Logo d'agence illisible :", err);
    return null;
  }
}
