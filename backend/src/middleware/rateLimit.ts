import { Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Limite par adresse IP : protège /login, /register, /verify-email,
 * /resend-verification, /forgot-password et /reset-password contre un tiers
 * qui martèle ces routes depuis une seule adresse (brute force de mot de
 * passe, spam de vérification/réinitialisation). Sans cette limite, aucune
 * de ces routes n'avait de garde-fou de fréquence.
 */
export const authIpLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives depuis cette adresse. Réessayez dans quelques minutes." },
});

/**
 * Limite additionnelle par email ciblé (quand le corps de la requête en
 * contient un) : protège un compte précis même si l'attaque est distribuée
 * sur plusieurs adresses IP. Retombe sur l'IP (via l'helper `ipKeyGenerator`,
 * qui regroupe correctement les IPv6 par sous-réseau) quand aucun email
 * exploitable n'est présent, plutôt que de désactiver la limite.
 */
export const authEmailLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    return email ? `email:${email}` : ipKeyGenerator(req.ip ?? "unknown");
  },
  message: { error: "Trop de tentatives pour ce compte. Réessayez dans quelques minutes." },
});
