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

/** Côté long maximal d'une photo affichée à l'écran : une carte d'annonce l'affiche vers 400 px de large (800 px sur un écran dense). */
const COTE_PHOTO = 1600;
const QUALITE_PHOTO = 0.82;
/** Sous ce poids ET sous ce côté long, une photo est déjà légère : on ne la retouche pas (chaque recompression perd un peu de qualité). */
const POIDS_PHOTO_LEGERE = 400 * 1024;

/**
 * Prépare une PHOTO qui sera affichée à l'écran (bien, annonce, incident) : ramenée à 1 600 px de côté long en JPEG, soit environ
 * 250 à 400 Ko au lieu de 3 à 4 Mo. Sans cela, une page de la vitrine télécharge chaque photo à sa taille d'origine (jusqu'à 4 Mo)
 * pour l'afficher dans une carte de 400 px : sur une connexion mobile, c'est elle qui ralentit la page, bien plus que le code.
 *
 * À réserver aux photos. Une pièce d'identité, un bail numérisé ou un justificatif doivent rester lisibles : ils passent par
 * `preparerFichier`, qui ne touche à un fichier que s'il dépasse la limite d'envoi.
 *
 * Jamais pire qu'avant : la version réduite n'est gardée que si elle est plus légère que l'original ; en cas de doute (format que le
 * navigateur ne sait pas lire, réduction impossible), le fichier suit le chemin de `preparerFichier`. Renvoie `null` si le fichier
 * reste trop volumineux — l'appelant affiche alors son message « fichier trop volumineux ».
 */
export async function preparerPhoto(file: File, maxMb: number = MAX_UPLOAD_SIZE_MB): Promise<File | null> {
  if (!TYPES_REDUCTIBLES.has(file.type)) return preparerFichier(file, maxMb);
  try {
    const image = await createImageBitmap(file);
    const coteLong = Math.max(image.width, image.height);
    image.close();
    if (coteLong <= COTE_PHOTO && file.size <= POIDS_PHOTO_LEGERE) return preparerFichier(file, maxMb);

    const reduit = await reduireImage(file, { cote: COTE_PHOTO, qualite: QUALITE_PHOTO });
    if (reduit.size < file.size && !fichierTropVolumineux(reduit, maxMb)) return reduit;
  } catch {
    // Image illisible par le navigateur : on retombe sur le comportement d'avant.
  }
  return preparerFichier(file, maxMb);
}
