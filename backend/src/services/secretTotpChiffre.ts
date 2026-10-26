import crypto from "crypto";
import { env } from "../config/env";

/**
 * Chiffrement du secret de double authentification (TOTP) stocké dans `users.totp_secret`.
 *
 * Format stocké : `v1:<iv>:<tag>:<texte chiffré>`, chaque champ en base64, AES-256-GCM avec un vecteur d'initialisation
 * aléatoire de 12 octets. Un secret TOTP est du base32 (A-Z, 2-7) : il ne contient jamais « : », le préfixe `v1:` distingue donc
 * sans ambiguïté un secret chiffré d'un ancien secret en clair, qui reste lisible tel quel.
 *
 * La clé (`TOTP_ENCRYPTION_KEY`) est volontairement distincte de `JWT_SECRET` : changer l'un ne doit pas rendre l'autre
 * illisible. Sans clé, le secret est stocké en clair, comme avant (signalé au démarrage, voir config/cleTotp.ts).
 */
const PREFIXE = "v1:";

export function secretTotpEstChiffre(stocke: string): boolean {
  return stocke.startsWith(PREFIXE);
}

/** Ce qu'il faut écrire en base pour ce secret : chiffré si une clé est configurée, sinon tel quel. */
export function chiffrerSecretTotp(secret: string): string {
  const cle = env.totpEncryptionKey;
  if (!cle) return secret;
  const iv = crypto.randomBytes(12);
  const chiffre = crypto.createCipheriv("aes-256-gcm", cle, iv);
  const texte = Buffer.concat([chiffre.update(secret, "utf8"), chiffre.final()]);
  return `${PREFIXE}${iv.toString("base64")}:${chiffre.getAuthTag().toString("base64")}:${texte.toString("base64")}`;
}

/**
 * Le secret en clair à partir de ce qui est stocké. Une valeur ancienne (en clair) est renvoyée telle quelle. Une valeur
 * chiffrée qui ne peut pas être lue (clé absente, autre clé, valeur altérée) LÈVE une erreur : mieux vaut un échec visible
 * qu'un secret faux qui ferait refuser des codes justes.
 */
export function dechiffrerSecretTotp(stocke: string): string {
  if (!secretTotpEstChiffre(stocke)) return stocke;
  const cle = env.totpEncryptionKey;
  if (!cle) throw new Error("Secret TOTP chiffré mais TOTP_ENCRYPTION_KEY est absente ou invalide : impossible de le lire.");
  const [iv, tag, texte] = stocke.slice(PREFIXE.length).split(":");
  const dechiffre = crypto.createDecipheriv("aes-256-gcm", cle, Buffer.from(iv, "base64"));
  dechiffre.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([dechiffre.update(Buffer.from(texte, "base64")), dechiffre.final()]).toString("utf8");
}
