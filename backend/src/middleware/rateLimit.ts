import { Request } from "express";
import rateLimit, { ipKeyGenerator, MemoryStore } from "express-rate-limit";

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

/**
 * Limite par adresse IP sur les routes /api/cron/* : leur seule protection
 * est la comparaison en temps constant du secret (cron.controller.ts::
 * secretValide), qui empêche une attaque par mesure de TIMING mais pas un
 * nombre illimité de TENTATIVES pour deviner CRON_SECRET par force brute. Ces
 * routes déclenchent l'envoi d'emails en masse (rappels d'échéance) : une
 * limite de fréquence — même généreuse, pour ne jamais gêner Vercel Cron
 * Jobs ou un déclenchement manuel légitime — réduit en profondeur de défense
 * la fenêtre d'un secret compromis ou faible, quelle que soit la robustesse
 * réelle du secret configuré.
 */
// Instancié explicitement (plutôt que de laisser `rateLimit()` créer son
// MemoryStore par défaut de façon opaque) uniquement pour exposer une
// référence : cronRateLimit.test.ts l'utilise pour réinitialiser le compteur
// entre ses tests (`resetAll()`), afin qu'un test qui épuise volontairement
// le quota pour vérifier le blocage ne fasse pas déborder ce même quota sur
// le test suivant, qui vérifie au contraire qu'un appel légitime répété ne
// le consomme jamais. Le comportement en production est strictement
// identique à avant : c'est le même MemoryStore que `rateLimit()` aurait
// créé implicitement.
export const cronLimiterStore = new MemoryStore();

export const cronLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  // Seuls les échecs d'authentification (401, mauvais/absent secret) comptent
  // dans la limite : un appel légitime répété avec le bon secret (Vercel Cron
  // Jobs, un déclenchement manuel/ops) n'use jamais ce quota, qui ne vise que
  // les tentatives de deviner CRON_SECRET par force brute.
  skipSuccessfulRequests: true,
  store: cronLimiterStore,
  message: { error: "Trop de tentatives. Réessayez plus tard." },
});

/**
 * Limite par adresse IP sur la soumission d'une demande de contact/visite
 * depuis la vitrine publique (POST /api/listings/public/:id/leads) : c'est la
 * seule route de tout le backend qui accepte une ÉCRITURE en base sans
 * authentification. Sans cette limite, un tiers pouvait générer un nombre
 * illimité de faux leads (spam, saturation du CRM d'un gestionnaire, ou abus
 * de la plateforme comme relais d'envoi de texte arbitraire via les champs
 * libres). Fenêtre plus généreuse que les limites d'authentification : un
 * même visiteur légitime peut vouloir demander une info puis une visite sur
 * plusieurs annonces différentes en peu de temps.
 */
export const listingLeadLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de demandes envoyées depuis cette adresse. Réessayez dans quelques minutes." },
});
