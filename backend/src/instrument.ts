// Doit être importé en tout premier (avant tout autre import) en tête de
// src/app.ts, pour que Sentry puisse instrumenter automatiquement le plus de
// choses possible (voir https://docs.sentry.io/platforms/javascript/guides/express/).
import * as Sentry from "@sentry/node";
import { env } from "./config/env";
import { environnementSentry } from "./config/environnementDeploiement";
import { masquerValeursSqlDansJson } from "./utils/erreurSansDonnees";

// DSN vide (par défaut si SENTRY_DSN n'est pas configuré sur Vercel) : Sentry
// reste totalement inactif, aucune donnée n'est envoyée nulle part. Ça permet
// de ne rien casser en local/dev tant que la variable n'est pas renseignée.
/**
 * Décide si une erreur mérite d'être remontée à Sentry.
 *
 * Le filtre par défaut de Sentry ne remonte que les erreurs de statut >= 500,
 * mais il traite comme un 500 toute erreur ne portant AUCUN statut. Or son
 * middleware s'exécute AVANT errorHandler (voir app.ts) : une requête mal
 * formée (ZodError) ou un upload refusé (MulterError) n'ont pas encore été
 * traduites en 400 quand Sentry les examine, et remontaient donc comme des
 * défauts applicatifs. C'est exactement le bruit que la branche ZodError
 * d'errorHandler cherchait à éviter, sans pouvoir y parvenir depuis sa
 * position dans la chaîne.
 *
 * Ces trois familles sont identifiées par leur `name` plutôt que par
 * `instanceof` : ce fichier est chargé en tout premier, avant Sentry.init,
 * précisément pour qu'express et consorts soient instrumentés au chargement ;
 * y importer zod ou multer les chargerait trop tôt. Le test associé vérifie
 * que ces noms correspondent bien aux vraies classes.
 */
export function shouldReportToSentry(error: {
  name?: string;
  status?: number | string;
  statusCode?: number | string;
}): boolean {
  // OrigineNonAutorisee : une origine CORS refusée (page de test, outil d'analyse, robot) est une réponse 403 attendue, pas une panne.
  if (error?.name === "ZodError" || error?.name === "MulterError" || error?.name === "OrigineNonAutorisee") return false;

  const rawStatus = error?.statusCode ?? error?.status;
  const status = typeof rawStatus === "string" ? parseInt(rawStatus, 10) : rawStatus;
  if (typeof status === "number" && !Number.isNaN(status)) return status >= 500;

  // Erreur sans statut identifiable : on la remonte, comme Sentry par défaut.
  return true;
}

/**
 * Le lien d'abonnement au calendrier porte son jeton dans l'adresse (`/api/agenda/ics/<jeton>.ics`) : c'est le secret qui tient lieu
 * de session aux calendriers externes. Une erreur ou une trace envoyée à Sentry contient l'adresse de la requête, ses fils d'Ariane
 * et le nom des opérations : sans ce masquage, le jeton s'y retrouvait en clair, lisible par quiconque consulte Sentry.
 * Le masquage s'applique à l'événement entier (texte JSON) plutôt qu'à des champs choisis, pour n'en oublier aucun.
 */
const JETON_AGENDA_DANS_ADRESSE = /(\/agenda\/ics\/)[A-Za-z0-9_%-]{16,}/g;

/**
 * `JSON.stringify` qui tolère les références circulaires : un objet déjà rencontré parmi ses PROPRES ancêtres est rendu « [Circular] ».
 * (Un objet simplement partagé à deux endroits n'est pas circulaire : il est conservé aux deux.) Les transactions de Sentry
 * transportent parfois des objets Node de ce genre (un `Timeout` et la liste de minuteries qui le référence).
 */
function enTexteSansCycle(valeur: unknown): string | undefined {
  const ancetres: unknown[] = [];
  return JSON.stringify(valeur, function (this: unknown, _cle: string, courant: unknown) {
    if (typeof courant !== "object" || courant === null) return courant;
    while (ancetres.length > 0 && ancetres[ancetres.length - 1] !== this) ancetres.pop();
    if (ancetres.includes(courant)) return "[Circular]";
    ancetres.push(courant);
    return courant;
  });
}

export function masquerJetonsAgenda<T>(evenement: T): T {
  const texte = enTexteSansCycle(evenement);
  if (texte === undefined || !JETON_AGENDA_DANS_ADRESSE.test(texte)) return evenement;
  JETON_AGENDA_DANS_ADRESSE.lastIndex = 0;
  return JSON.parse(texte.replace(JETON_AGENDA_DANS_ADRESSE, "$1[masqué]")) as T;
}

/** Les valeurs d'une requête en échec (ligne `params:` d'une erreur de base, valeur citée par une contrainte) ne partent pas vers Sentry. */
export function masquerValeursSqlDansEvenement<T>(evenement: T): T {
  return JSON.parse(masquerValeursSqlDansJson(enTexteSansCycle(evenement) ?? "null")) as T;
}

/** Tout ce qui ne doit pas quitter la plateforme dans un événement Sentry : jetons d'agenda, valeurs de requêtes en échec. */
export function masquerDonneesSensibles<T>(evenement: T): T {
  return masquerValeursSqlDansEvenement(masquerJetonsAgenda(evenement));
}

/**
 * Masque l'événement, ou le RETIENT (null) si le masquage échoue : perdre une trace vaut mieux que d'envoyer un jeton d'agenda ou une
 * valeur de requête non masqués, et une exception levée ici faisait remonter en erreur le dispositif de suivi lui-même.
 */
export function retenirSiMasquageImpossible<T>(evenement: T): T | null {
  try {
    return masquerDonneesSensibles(evenement);
  } catch {
    return null;
  }
}

if (env.sentryDsn) {
  Sentry.init({
    dsn: env.sentryDsn,
    environment: environnementSentry(process.env.VERCEL_ENV, env.nodeEnv),
    beforeSend: (evenement) => retenirSiMasquageImpossible(evenement),
    beforeSendTransaction: (evenement) => retenirSiMasquageImpossible(evenement),
    integrations: [Sentry.expressIntegration({ shouldHandleError: shouldReportToSentry })],
    // Pourcentage de requêtes tracées en plus des erreurs (0 à 1). 0.1 = 10%,
    // suffisant pour repérer les lenteurs sans consommer tout le quota gratuit.
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  });
}
