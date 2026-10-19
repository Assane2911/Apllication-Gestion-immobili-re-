import { MAX_UPLOAD_SIZE_MB } from "../api/client";

const OCTETS_PAR_MO = 1024 * 1024;

/** Le fichier dépasse-t-il la limite d'envoi (par défaut celle du serveur) ? */
export function fichierTropVolumineux(file: File, maxMb: number = MAX_UPLOAD_SIZE_MB): boolean {
  return file.size > maxMb * OCTETS_PAR_MO;
}

const TYPES_REDUCTIBLES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Deux essais, du plus fidèle au plus léger : une photo de téléphone tient presque toujours dès le premier. */
const ESSAIS = [
  { cote: 2560, qualite: 0.85 },
  { cote: 1600, qualite: 0.7 },
] as const;

async function reduireImage(file: File, { cote, qualite }: { cote: number; qualite: number }): Promise<File> {
  const image = await createImageBitmap(file);
  try {
    // Jamais d'agrandissement : une petite image garde ses dimensions.
    const echelle = Math.min(1, cote / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * echelle);
    canvas.height = Math.round(image.height * echelle);
    const contexte = canvas.getContext("2d");
    if (!contexte) throw new Error("canvas indisponible");
    // Un PNG transparent deviendrait noir en JPEG : on peint d'abord un fond blanc.
    contexte.fillStyle = "#fff";
    contexte.fillRect(0, 0, canvas.width, canvas.height);
    contexte.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", qualite));
    if (!blob) throw new Error("export JPEG impossible");
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } finally {
    image.close();
  }
}

/**
 * Prépare un fichier avant envoi au serveur, qui est une fonction Vercel : au-delà d'environ 4,5 Mo de requête,
 * Vercel répond lui-même « 413 » et l'utilisateur ne voyait qu'une erreur générique. Une photo de téléphone en
 * pleine résolution (5 à 12 Mo) est donc réduite ici ; un PDF trop lourd, qu'on ne sait pas réduire, est refusé
 * tout de suite plutôt qu'après une longue attente sur une connexion mobile.
 *
 * Renvoie le fichier à envoyer (le même s'il tient déjà), ou `null` s'il reste trop volumineux — l'appelant
 * affiche alors son message « fichier trop volumineux ».
 */
export async function preparerFichier(file: File, maxMb: number = MAX_UPLOAD_SIZE_MB): Promise<File | null> {
  if (!fichierTropVolumineux(file, maxMb)) return file;
  if (!TYPES_REDUCTIBLES.has(file.type)) return null;
  for (const essai of ESSAIS) {
    try {
      const reduit = await reduireImage(file, essai);
      if (!fichierTropVolumineux(reduit, maxMb)) return reduit;
    } catch {
      // Image illisible par le navigateur (format exotique) : inutile de réessayer.
      return null;
    }
  }
  return null;
}
