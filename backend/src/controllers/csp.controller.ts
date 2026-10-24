import { Request, Response } from "express";

/**
 * Point de collecte des violations de la politique de sécurité de contenu (CSP) du site, envoyée en mode
 * OBSERVATION : le navigateur ne bloque rien, il signale ce qu'il aurait bloqué. On en tire une ligne de journal
 * courte par violation, lisible dans les journaux Vercel (recherche « [csp] »), pour ajuster la politique avant de
 * la rendre bloquante.
 *
 * Le point est public : le navigateur n'envoie aucun cookie avec un rapport. Il n'écrit donc RIEN en base, répond
 * toujours 204 (un rapport mal formé n'est pas une erreur du visiteur) et ne journalise que des valeurs nettoyées :
 *  - adresse réduite à origine + chemin : la requête et le fragment peuvent porter un jeton (lien de
 *    réinitialisation de mot de passe, par exemple) ;
 *  - retours à la ligne et caractères de contrôle remplacés : sinon un rapport forgé pourrait écrire de fausses
 *    lignes dans les journaux ;
 *  - valeurs tronquées, et quelques rapports seulement par envoi.
 * Les extensions du navigateur du visiteur provoquent des violations qui ne viennent pas de nos pages : ignorées.
 */
const RAPPORTS_MAX_PAR_ENVOI = 5;
const LONGUEUR_MAX = 200;
const SCHEMAS_D_EXTENSION = /^(chrome-extension|moz-extension|safari-extension|safari-web-extension|ms-browser-extension|edge-extension):/i;

interface Violation {
  page: string;
  directive: string;
  bloque: string;
}

const texte = (v: unknown): string => (typeof v === "string" ? v : "");

/** Une adresse sans requête ni fragment ; un mot-clé CSP (« inline », « eval »…) reste tel quel. */
function sansRequeteNiFragment(adresse: string): string {
  return adresse.split(/[?#]/)[0];
}

/** Une valeur sûre pour une ligne de journal : sans caractère de contrôle, tassée, tronquée. */
function nettoyer(valeur: string): string {
  // eslint-disable-next-line no-control-regex
  return valeur.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, LONGUEUR_MAX);
}

function depuisObjet(o: unknown, noms: { page: string; directive: string[]; bloque: string }): Violation | null {
  if (typeof o !== "object" || o === null) return null;
  const champs = o as Record<string, unknown>;
  const directive = noms.directive.map((n) => texte(champs[n])).find(Boolean) ?? "";
  const bloque = texte(champs[noms.bloque]);
  if (!directive && !bloque) return null;
  return { page: texte(champs[noms.page]), directive, bloque };
}

/** Les deux formats : `{ "csp-report": {…} }` (report-uri) et `[{ type: "csp-violation", body: {…} }]` (report-to). */
export function extraireViolations(corps: unknown): Violation[] {
  const trouvees: Violation[] = [];
  const historique = typeof corps === "object" && corps !== null ? (corps as Record<string, unknown>)["csp-report"] : undefined;
  const h = depuisObjet(historique, { page: "document-uri", directive: ["effective-directive", "violated-directive"], bloque: "blocked-uri" });
  if (h) trouvees.push(h);
  if (Array.isArray(corps)) {
    for (const r of corps) {
      if (typeof r !== "object" || r === null || (r as { type?: unknown }).type !== "csp-violation") continue;
      const v = depuisObjet((r as { body?: unknown }).body, { page: "documentURL", directive: ["effectiveDirective", "violatedDirective"], bloque: "blockedURL" });
      if (v) trouvees.push(v);
    }
  }
  return trouvees;
}

export function recevoirRapportCsp(req: Request, res: Response) {
  const violations = extraireViolations(req.body).filter((v) => !SCHEMAS_D_EXTENSION.test(v.bloque));
  for (const v of violations.slice(0, RAPPORTS_MAX_PAR_ENVOI)) {
    console.warn(
      `[csp] directive=${nettoyer(v.directive) || "?"} bloqué=${nettoyer(sansRequeteNiFragment(v.bloque)) || "?"} page=${nettoyer(sansRequeteNiFragment(v.page)) || "?"}`
    );
  }
  res.status(204).end();
}
