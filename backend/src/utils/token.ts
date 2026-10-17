import crypto from "crypto";

/**
 * Empreinte SHA-256 d'un token à usage unique. On ne stocke jamais le token
 * brut en base (comme un mot de passe) — seule cette empreinte est
 * enregistrée, comparée à la volée quand le lien est utilisé.
 *
 * Utilisé par le mécanisme de réinitialisation de mot de passe
 * (auth.controller.ts) ET par l'invitation de compte du portail propriétaire
 * (owner.controller.ts), qui réutilise exactement le même mécanisme : créer
 * un compte, y poser un token à usage unique, laisser la personne choisir
 * elle-même son mot de passe via /reinitialiser-mot-de-passe.
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/** Durée de validité du lien de réinitialisation de mot de passe (usage unique). */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 heure

/**
 * Durée de validité d'un lien d'invitation (collaborateur d'équipe, propriétaire). Même mécanisme que le lien de
 * réinitialisation (token à usage unique, voir resetPassword), mais l'invité ouvre son email quand il le peut :
 * une heure l'obligeait à demander un nouvel envoi dès le lendemain. Les invitations se renvoient toujours.
 */
export const INVITATION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours
