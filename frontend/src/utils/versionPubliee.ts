/**
 * Détection d'une nouvelle version de l'application pour un onglet resté ouvert.
 *
 * Chaque build porte un identifiant (`__BUILD_ID__`, vite.config.ts) et le publie dans `/version.json`. Un onglet ouvert avant
 * un déploiement continue de faire tourner l'ancien code : on compare périodiquement son identifiant à celui du fichier publié,
 * pour proposer d'actualiser AVANT qu'une page introuvable ne force un rechargement (voir rechargementApresDeploiement.ts, qui
 * reste le filet de secours).
 */

/** Identifiant du build qui tourne dans cet onglet ; « dev » hors build (serveur de développement, tests sans définition). */
export const VERSION_COURANTE: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

/**
 * L'identifiant publié, ou null si on ne peut pas s'y fier : réseau coupé, erreur serveur, ou réponse qui n'est pas notre
 * fichier (le site renvoie `index.html` pour toute adresse inconnue : un HTML ne doit jamais passer pour une nouvelle version).
 */
export async function lireVersionPubliee(chercher: typeof fetch = fetch, signal?: AbortSignal): Promise<string | null> {
  try {
    const reponse = await chercher(`/version.json?t=${Date.now()}`, { cache: "no-store", signal });
    if (!reponse.ok) return null;
    const corps: unknown = await reponse.json();
    const version = (corps as { version?: unknown } | null)?.version;
    return typeof version === "string" && version.trim() !== "" ? version : null;
  } catch {
    return null;
  }
}

/** Vrai quand le fichier publié désigne un autre build que celui qui tourne ici. Jamais en développement. */
export function estNouvelleVersion(courante: string, publiee: string | null): boolean {
  return courante !== "dev" && publiee !== null && publiee !== courante;
}
