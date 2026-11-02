import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { platformSettings } from "../db/schema";

/** Identifiant de l'unique ligne des réglages de la plateforme (voir platformSettings.controller.ts). */
export const PLATFORM_SETTINGS_ID = "platform";

/** Durée maximale d'une fenêtre : au-delà, ce n'est plus une maintenance mais une panne décidée. */
export const DUREE_MAX_MAINTENANCE_MS = 24 * 60 * 60 * 1000;
/** Délai pendant lequel une lecture est réutilisée : une instance du serveur n'interroge pas la base à chaque requête. */
const VALIDITE_MS = 10_000;

export interface FenetreMaintenance {
  debut: Date;
  fin: Date;
  message: string | null;
}

let cache: { lu: number; fenetre: FenetreMaintenance | null } | null = null;

/** À appeler après chaque modification : l'instance qui l'a faite voit tout de suite le nouvel état. */
export function invaliderCacheMaintenance(): void {
  cache = null;
}

/** La fenêtre est-elle en cours à cet instant ? (début inclus, fin exclue) */
export function fenetreEnCours(fenetre: FenetreMaintenance | null, maintenant: number = Date.now()): fenetre is FenetreMaintenance {
  return fenetre !== null && fenetre.debut.getTime() <= maintenant && maintenant < fenetre.fin.getTime();
}

/**
 * La maintenance programmée (à venir ou en cours), ou null. Une fenêtre déjà terminée n'existe plus : elle se périme d'elle-même,
 * sans aucune action — c'est la garantie qu'une maintenance oubliée ne bloque jamais l'application.
 *
 * Si la base ne répond pas, on répond « pas de maintenance » : bloquer l'API sur la foi d'une lecture impossible ferait d'une panne
 * de base une panne totale, alors que les requêtes qui n'ont pas besoin d'elle peuvent encore aboutir. Le résultat (même un échec)
 * est gardé quelques secondes.
 */
export async function lireMaintenance(maintenant: number = Date.now()): Promise<FenetreMaintenance | null> {
  if (cache && maintenant - cache.lu < VALIDITE_MS) {
    return cache.fenetre && cache.fenetre.fin.getTime() > maintenant ? cache.fenetre : null;
  }
  let fenetre: FenetreMaintenance | null = null;
  try {
    const [ligne] = await db
      .select({ debut: platformSettings.maintenanceStart, fin: platformSettings.maintenanceEnd, message: platformSettings.maintenanceMessage })
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID));
    if (ligne?.debut && ligne.fin && ligne.fin.getTime() > maintenant) {
      fenetre = { debut: ligne.debut, fin: ligne.fin, message: ligne.message?.trim() ? ligne.message : null };
    }
  } catch (erreur) {
    console.error("[maintenance] Lecture impossible, l'application reste accessible :", erreur instanceof Error ? erreur.message : erreur);
  }
  cache = { lu: maintenant, fenetre };
  return fenetre;
}
