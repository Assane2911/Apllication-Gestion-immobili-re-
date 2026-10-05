import bcrypt from "bcryptjs";
import crypto from "crypto";
import { generate, generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";

const EMETTEUR = "ImmoPlatform Pro";

/**
 * Tolérance acceptée entre l'horloge du téléphone et celle du serveur, en
 * secondes de part et d'autre de l'instant courant (±30s, soit une période
 * TOTP standard) — sans elle, un décalage d'horloge pourtant courant sur un
 * téléphone suffirait à rejeter un code pourtant correct.
 */
const TOLERANCE_HORLOGE_SECONDES = 30;

const NOMBRE_CODES_SECOURS = 8;

export function genererSecretTotp(): string {
  return generateSecret();
}

export function genererOtpauthUrl(email: string, secret: string): string {
  return generateURI({ issuer: EMETTEUR, label: email, secret });
}

export async function genererQrCodeDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl);
}

/** Code à 6 chiffres affiché par l'application d'authentification, pour test et vérification. */
export async function genererCodeTotp(secret: string): Promise<string> {
  return generate({ secret });
}

export async function verifierCodeTotp(secret: string, code: string): Promise<boolean> {
  try {
    const resultat = await verify({ secret, token: code, epochTolerance: TOLERANCE_HORLOGE_SECONDES });
    return resultat.valid;
  } catch {
    // otplib rejette (au lieu de renvoyer simplement `valid: false`) un jeton
    // qui n'a pas la forme attendue — notamment un code de secours à 10
    // caractères hexadécimaux, que verifyTwoFactorLogin (auth.controller.ts)
    // essaie TOUJOURS d'abord comme code TOTP avant de se rabattre dessus.
    // Sans ce filet, une tentative de connexion avec un code de secours
    // plantait ici en 500 au lieu d'échouer proprement puis de retomber sur
    // consommerCodeSecours.
    return false;
  }
}

/**
 * Codes de secours (8, lisibles — 10 caractères hexadécimaux), utilisables
 * une seule fois chacun quand le téléphone qui génère les codes TOTP n'est
 * plus disponible. Seuls leurs hachages bcrypt sont destinés à être stockés :
 * le tableau en clair n'est renvoyé qu'une fois, à la confirmation de
 * l'enrôlement.
 */
export async function genererCodesSecours(): Promise<{ codes: string[]; hashes: string[] }> {
  const codes = Array.from({ length: NOMBRE_CODES_SECOURS }, () => crypto.randomBytes(5).toString("hex"));
  const hashes = await Promise.all(codes.map((code) => bcrypt.hash(code, 10)));
  return { codes, hashes };
}

/**
 * Vérifie `code` contre la liste de hachages stockée (JSON) et renvoie la
 * liste mise à jour SANS le hachage consommé — chaque code de secours ne
 * sert qu'une fois. `null` si aucun ne correspond.
 */
export async function consommerCodeSecours(code: string, hashesJson: string | null): Promise<string[] | null> {
  if (!hashesJson) return null;
  let hashes: string[];
  try {
    hashes = JSON.parse(hashesJson) as string[];
  } catch {
    return null;
  }

  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(code, hashes[i])) {
      return [...hashes.slice(0, i), ...hashes.slice(i + 1)];
    }
  }
  return null;
}
