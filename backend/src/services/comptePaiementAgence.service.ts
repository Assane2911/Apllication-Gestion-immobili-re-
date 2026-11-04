import crypto from "crypto";
import { eq } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db/client";
import { agencyPaymentAccounts, agencySettings } from "../db/schema";
import { ApiError } from "../utils/asyncHandler";

/**
 * Compte de paiement en ligne d'une agence : ses identifiants PayDunya, pour que les loyers payés par Mobile Money ou
 * par carte arrivent sur SON compte PayDunya et jamais sur celui de la plateforme (qui ne sert qu'aux abonnements).
 *
 * Les trois identifiants (clé principale, clé privée, jeton) donnent le droit d'encaisser et de consulter les
 * transactions de l'agence : ils sont chiffrés en AES-256-GCM avec PAYMENT_KEYS_ENCRYPTION_KEY avant d'être écrits en
 * base, et ne quittent jamais le serveur. L'interface n'en reçoit que les quatre derniers caractères du jeton.
 */

export type ModePaydunya = "test" | "live";

/** Ce qu'il faut pour parler à PayDunya au nom d'une agence. */
export interface IdentifiantsPaydunya {
  masterKey: string;
  privateKey: string;
  token: string;
  mode: ModePaydunya;
  /** Devise du compte marchand (l'API PayDunya n'en transporte pas). */
  currency: string;
}

/** Ce que l'interface a le droit de voir : jamais un identifiant, seulement de quoi reconnaître le compte. */
export interface ResumeComptePaiement {
  configure: boolean;
  enabled: boolean;
  mode: ModePaydunya;
  currency: string;
  tokenLast4: string;
}

const ALGORITHME = "aes-256-gcm";

/** Clé de 32 octets, en hexadécimal (64 caractères) ou en base64 ; `null` si elle est absente ou mal formée. */
function cleDeChiffrement(): Buffer | null {
  const brute = env.payments.keysEncryptionKey.trim();
  if (!brute) return null;
  if (/^[0-9a-fA-F]{64}$/.test(brute)) return Buffer.from(brute, "hex");
  const base64 = Buffer.from(brute, "base64");
  return base64.length === 32 ? base64 : null;
}

/** Le chiffrement est-il prêt ? Sinon aucune agence ne peut enregistrer de compte. */
export function chiffrementDisponible(): boolean {
  return cleDeChiffrement() !== null;
}

function chiffrer(clair: string): string {
  const cle = cleDeChiffrement();
  if (!cle) {
    throw new ApiError(503, "Le paiement en ligne des loyers n'est pas encore activé sur cette plateforme.", "AGENCY_PAYMENTS_UNAVAILABLE");
  }
  const iv = crypto.randomBytes(12);
  const chiffre = crypto.createCipheriv(ALGORITHME, cle, iv);
  const donnees = Buffer.concat([chiffre.update(clair, "utf8"), chiffre.final()]);
  return [iv, chiffre.getAuthTag(), donnees].map((b) => b.toString("base64")).join(".");
}

/** `null` si la valeur est illisible (clé changée, donnée altérée) : l'appelant traite le compte comme non configuré. */
function dechiffrer(valeur: string): string | null {
  const cle = cleDeChiffrement();
  if (!cle) return null;
  try {
    const [iv, tag, donnees] = valeur.split(".").map((p) => Buffer.from(p, "base64"));
    if (!iv || !tag || !donnees) return null;
    const dechiffre = crypto.createDecipheriv(ALGORITHME, cle, iv);
    dechiffre.setAuthTag(tag);
    return Buffer.concat([dechiffre.update(donnees), dechiffre.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Identifiants déchiffrés de l'agence, ou `null` : pas de compte, compte désactivé, ou identifiants illisibles. */
export async function lireIdentifiantsAgence(managerId: string): Promise<IdentifiantsPaydunya | null> {
  const [ligne] = await db.select().from(agencyPaymentAccounts).where(eq(agencyPaymentAccounts.managerId, managerId));
  if (!ligne || !ligne.enabled) return null;
  const masterKey = dechiffrer(ligne.masterKeyEnc);
  const privateKey = dechiffrer(ligne.privateKeyEnc);
  const token = dechiffrer(ligne.tokenEnc);
  if (!masterKey || !privateKey || !token) {
    console.error(`[paiement] Identifiants PayDunya illisibles pour l'agence ${managerId} (clé de chiffrement changée ou donnée altérée).`);
    return null;
  }
  return { masterKey, privateKey, token, mode: ligne.mode === "live" ? "live" : "test", currency: ligne.currency };
}

/** L'agence qui encaisse un loyer : ses identifiants PayDunya et son nom, montré au locataire sur la page de paiement. */
export interface CompteAgenceEncaissant {
  identifiants: IdentifiantsPaydunya;
  nomAgence: string;
  managerId: string;
}

/** Le compte qui encaisse les loyers de cette agence, ou `null` si elle n'a pas (ou plus) de compte actif. */
export async function chargerCompteEncaissant(managerId: string): Promise<CompteAgenceEncaissant | null> {
  const identifiants = await lireIdentifiantsAgence(managerId);
  if (!identifiants) return null;
  const [reglages] = await db.select({ nom: agencySettings.agencyName }).from(agencySettings).where(eq(agencySettings.userId, managerId));
  return { identifiants, nomAgence: reglages?.nom?.trim() || "Agence", managerId };
}

/** Résumé sans secret, pour l'interface et pour décider quels moyens de paiement proposer. */
export async function lireResumeAgence(managerId: string): Promise<ResumeComptePaiement> {
  const [ligne] = await db.select().from(agencyPaymentAccounts).where(eq(agencyPaymentAccounts.managerId, managerId));
  if (!ligne) return { configure: false, enabled: false, mode: "test", currency: "XOF", tokenLast4: "" };
  return { configure: true, enabled: ligne.enabled, mode: ligne.mode === "live" ? "live" : "test", currency: ligne.currency, tokenLast4: ligne.tokenLast4 };
}

/** Le paiement en ligne du loyer est-il utilisable pour cette agence ? (compte enregistré, actif et lisible) */
export async function agenceAUnComptePaiement(managerId: string): Promise<boolean> {
  return (await lireIdentifiantsAgence(managerId)) !== null;
}

export interface SaisieComptePaiement {
  masterKey: string;
  privateKey: string;
  token: string;
  mode: ModePaydunya;
  currency: string;
  enabled: boolean;
}

/** Enregistre (ou remplace) les identifiants de l'agence. */
export async function enregistrerCompteAgence(managerId: string, saisie: SaisieComptePaiement): Promise<void> {
  const valeurs = {
    managerId,
    provider: "PAYDUNYA",
    masterKeyEnc: chiffrer(saisie.masterKey),
    privateKeyEnc: chiffrer(saisie.privateKey),
    tokenEnc: chiffrer(saisie.token),
    mode: saisie.mode,
    currency: saisie.currency.toUpperCase(),
    tokenLast4: saisie.token.slice(-4),
    enabled: saisie.enabled,
    updatedAt: new Date(),
  };
  await db.insert(agencyPaymentAccounts).values(valeurs).onConflictDoUpdate({ target: agencyPaymentAccounts.managerId, set: valeurs });
}

/** Active ou suspend le compte sans toucher aux identifiants. `false` si l'agence n'en a pas. */
export async function basculerCompteAgence(managerId: string, enabled: boolean): Promise<boolean> {
  const modifies = await db.update(agencyPaymentAccounts).set({ enabled, updatedAt: new Date() }).where(eq(agencyPaymentAccounts.managerId, managerId)).returning({ id: agencyPaymentAccounts.managerId });
  return modifies.length > 0;
}

export async function supprimerCompteAgence(managerId: string): Promise<void> {
  await db.delete(agencyPaymentAccounts).where(eq(agencyPaymentAccounts.managerId, managerId));
}
