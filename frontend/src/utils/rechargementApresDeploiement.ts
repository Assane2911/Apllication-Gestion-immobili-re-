/**
 * Un onglet resté ouvert pendant un déploiement réclame des fichiers qui n'existent plus : les noms des fichiers de
 * l'application contiennent une empreinte qui change à chaque build (`LoginPage-CTQ4Vm4-.js`). Le navigateur reçoit
 * une erreur 404 (ou la page d'accueil à la place) et l'écran affichait « Une erreur est survenue » — constaté en
 * production (Sentry : « Failed to fetch dynamically imported module »). Recharger la page récupère la version
 * courante : on le fait automatiquement, UNE seule fois par minute, pour ne jamais boucler si le fichier manque
 * vraiment. Garde-fou UNIQUE, partagé par l'événement de Vite, `lazyWithReload` et le filet d'erreurs.
 */
const CLE = "rechargement-apres-deploiement";
/** En deçà, un second échec n'est pas un nouveau déploiement : on laisse l'erreur s'afficher. */
const DELAI_MS = 60_000;

const MOTIFS = [
  /Failed to fetch dynamically imported module/i, // Chrome, Edge, Safari récent
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari
  /Unable to preload CSS/i, // Vite, feuille de style d'un module chargé à la demande
];

/**
 * Vrai dès que CETTE page a lancé son rechargement. Plusieurs mécanismes réagissent au même fichier disparu
 * (l'événement de Vite, `lazyWithReload`, le filet d'erreurs) : le premier recharge, les suivants doivent le savoir
 * pour ne pas recharger une seconde fois, ni laisser l'écran d'erreur apparaître le temps que la page se remplace.
 * Propre à la page (variable de module) : la page rechargée repart à faux, donc un vrai échec s'y affiche.
 */
let enCours = false;

export function rechargementEnCours(): boolean {
  return enCours;
}

/** Remet l'état de la page à zéro entre deux tests. */
export function reinitialiserRechargementPourTests(): void {
  enCours = false;
}

/** L'erreur dit-elle qu'un fichier de l'application a disparu (déploiement survenu entre-temps) ? */
export function estFichierDisparu(erreur: unknown): boolean {
  if (!(erreur instanceof Error)) return false;
  return MOTIFS.some((m) => m.test(erreur.message));
}

/**
 * Recharge la page, sauf si on vient déjà de le faire (ou si le navigateur ne laisse pas s'en souvenir : sans
 * mémoire, rien n'empêcherait une boucle). Renvoie vrai si le rechargement est lancé.
 */
export function rechargerUneFois(maintenant: number = Date.now()): boolean {
  try {
    const dernier = Number(sessionStorage.getItem(CLE) ?? 0);
    if (dernier && maintenant - dernier < DELAI_MS) return false;
    sessionStorage.setItem(CLE, String(maintenant));
  } catch {
    return false;
  }
  enCours = true;
  window.location.reload();
  return true;
}

/**
 * Le rechargement est-il pris en charge, par ce mécanisme ou par un autre ? Vrai : l'appelant n'a rien d'autre à
 * faire (surtout pas afficher une erreur). Faux : on a déjà rechargé il y a moins d'une minute, ou le navigateur
 * ne laisse pas s'en souvenir — l'erreur doit suivre son cours.
 */
export function rechargementAssure(): boolean {
  return enCours || rechargerUneFois();
}

/** Vite émet `vite:preloadError` quand un fichier d'un module chargé à la demande est introuvable. */
export function installerRechargementAutomatique(): void {
  window.addEventListener("vite:preloadError", (evenement) => {
    // Sans rechargement possible, l'erreur suit son cours (jusqu'à la page d'erreur) : on ne la masque pas.
    if (rechargementAssure()) evenement.preventDefault();
  });
}
