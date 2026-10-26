import { sql } from "drizzle-orm";
import { db } from "../db/client";

/** Au-delà, la base est tenue pour hors service : une sonde ne doit pas attendre plus longtemps que ça. */
const DELAI_MS = 3_000;
/** Durée pendant laquelle un résultat est réutilisé, vrai ou faux. */
const VALIDITE_MS = 10_000;

let dernier: { ok: boolean; le: number } | null = null;
let enCours: Promise<boolean> | null = null;

async function interroger(delaiMs: number): Promise<boolean> {
  let minuteur: NodeJS.Timeout | undefined;
  try {
    const attente = new Promise<never>((_, rejeter) => {
      minuteur = setTimeout(() => rejeter(new Error(`la base n'a pas répondu en ${delaiMs} ms`)), delaiMs);
    });
    await Promise.race([db.execute(sql`select 1`), attente]);
    return true;
  } catch (erreur) {
    // Le détail reste dans les journaux ; la réponse publique, elle, n'en donne aucun.
    console.error("[sante] La base ne répond pas :", erreur instanceof Error ? erreur.message : erreur);
    return false;
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * La base répond-elle ? Le résultat est gardé 10 s par instance et des appels simultanés partagent une même
 * vérification : un appel en boucle sur la route publique ne peut pas mitrailler la base.
 */
export function baseRepond(options: { delaiMs?: number } = {}): Promise<boolean> {
  if (dernier && Date.now() - dernier.le < VALIDITE_MS) return Promise.resolve(dernier.ok);
  if (enCours) return enCours;
  enCours = interroger(options.delaiMs ?? DELAI_MS)
    .then((ok) => {
      dernier = { ok, le: Date.now() };
      return ok;
    })
    .finally(() => {
      enCours = null;
    });
  return enCours;
}

export function reinitialiserSantePourTests(): void {
  dernier = null;
  enCours = null;
}
