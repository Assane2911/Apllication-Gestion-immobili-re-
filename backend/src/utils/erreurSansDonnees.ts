/**
 * Une erreur de base de données ne doit pas écrire les DONNÉES de la requête dans les journaux ni dans Sentry.
 *
 * Le message d'une erreur Drizzle est `Failed query: <requête>` suivi d'une ligne `params: <valeurs>` : l'e-mail, le nom, le téléphone,
 * l'adresse ou l'empreinte de mot de passe de la ligne que l'on écrivait. Et le détail d'une violation de contrainte PostgreSQL cite la
 * valeur fautive (`Key (email)=(awa@exemple.sn) already exists.`). Journaux Vercel et Sentry sont conservés et lus par plus de monde
 * que la base : ces valeurs n'ont rien à y faire. La requête SQL, elle, reste : c'est ce qui permet de diagnostiquer.
 */
const VALEURS_MASQUEES = "[valeurs masquées]";

/** Texte brut (message, trace) : la ligne `params:` et la valeur citée par un détail de contrainte sont masquées. */
export function masquerValeursSql(texte: string): string {
  return texte.replace(/(\nparams: ).*/g, `$1${VALEURS_MASQUEES}`).replace(/(Key \([^)]*\)=\()[^)]*(\))/g, "$1[masqué]$2");
}

/** Même masquage sur un texte JSON : la fin de ligne y est `\n` échappé, et la valeur s'arrête au guillemet non échappé. */
export function masquerValeursSqlDansJson(texteJson: string): string {
  return texteJson
    .replace(/(\\nparams: )(?:[^"\\]|\\.)*/g, `$1${VALEURS_MASQUEES}`)
    .replace(/(Key \([^)]*\)=\()[^)]*(\))/g, "$1[masqué]$2");
}

/**
 * Copie de l'erreur à écrire dans les journaux : message et trace masqués, cause comprise. L'erreur d'origine n'est pas modifiée.
 * Ce qui n'est pas une erreur est rendu tel quel.
 */
export function erreurSansDonnees(err: unknown, profondeur = 0): unknown {
  if (!(err instanceof Error) || profondeur > 5) return err;
  const avecCause = err as Error & { cause?: unknown };
  const copie: Error & { cause?: unknown } = new Error(masquerValeursSql(err.message));
  copie.name = err.name;
  if (err.stack) copie.stack = masquerValeursSql(err.stack);
  if (avecCause.cause !== undefined) copie.cause = erreurSansDonnees(avecCause.cause, profondeur + 1);
  return copie;
}
