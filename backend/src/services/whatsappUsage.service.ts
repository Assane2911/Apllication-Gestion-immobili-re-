import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { whatsappUsage } from "../db/schema";
import { env } from "../config/env";
import type { ResultatEnvoiWhatsapp } from "./whatsapp.service";

/**
 * Compteur des messages WhatsApp envoyés, par agence, par mois (UTC) et par type.
 *
 * Meta facture chaque message modèle délivré : sans ce compteur, la facture arrive en fin de mois sans qu'on sache quelle
 * agence l'a produite. Le décompte vient de l'application elle-même (ce qu'elle a envoyé à l'API de Meta), pas de la
 * facture de Meta : c'est une ESTIMATION. Un message accepté par l'API n'est pas forcément délivré (Meta ne facture que
 * les messages délivrés), et la catégorie facturée (utility, marketing) est celle que Meta attribue au modèle.
 */

/** Les trois messages que l'application envoie par WhatsApp (tous des rappels de loyer, en modèle). */
export const TYPES_MESSAGE_WHATSAPP = ["avis_echeance", "echeance_proche", "relance_impaye"] as const;
export type TypeMessageWhatsapp = (typeof TYPES_MESSAGE_WHATSAPP)[number];

/** À quelle agence et à quel titre un message est envoyé : exigé par envoyerMessageWhatsapp, pour qu'aucun envoi ne passe sans être compté. */
export interface ContexteEnvoiWhatsapp {
  managerId: string;
  type: TypeMessageWhatsapp;
}

/** Mois civil en UTC, « AAAA-MM ». */
export function moisUtc(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Compte un envoi. Ne lève JAMAIS : un compteur en panne ne doit ni interrompre la boucle des rappels ni retarder un
 * message. Ne compte pas une simulation (service ou modèle non configuré : rien n'est parti, rien n'est facturé).
 * Un numéro invalide, une erreur de l'API ou du réseau comptent comme échec.
 */
export async function enregistrerEnvoiWhatsapp(contexte: ContexteEnvoiWhatsapp, resultat: ResultatEnvoiWhatsapp, maintenant: Date = new Date()): Promise<void> {
  try {
    const echec = resultat.error === true;
    if (resultat.simulated && !echec) return;
    const sent = echec ? 0 : 1;
    const failed = echec ? 1 : 0;
    await db
      .insert(whatsappUsage)
      .values({ managerId: contexte.managerId, month: moisUtc(maintenant), type: contexte.type, sent, failed })
      .onConflictDoUpdate({
        target: [whatsappUsage.managerId, whatsappUsage.month, whatsappUsage.type],
        set: {
          sent: sql`${whatsappUsage.sent} + ${sent}`,
          failed: sql`${whatsappUsage.failed} + ${failed}`,
          updatedAt: maintenant,
        },
      });
  } catch (err) {
    console.error("[whatsapp] Compteur d'envois non mis à jour :", err instanceof Error ? err.message : err);
  }
}

export interface UsageMensuelWhatsapp {
  /** « AAAA-MM » */
  mois: string;
  /** Messages acceptés par l'API de Meta, par type. */
  parType: Record<TypeMessageWhatsapp, number>;
  envoyes: number;
  echecs: number;
  /** Coût estimé en dollars : messages acceptés × tarif d'un message utility. */
  coutEstimeUsd: number;
}

/** Arrondi à 4 décimales : les tarifs se comptent en millièmes de dollar. */
const arrondiUsd = (valeur: number) => Math.round(valeur * 10_000) / 10_000;

/**
 * Consommation d'une agence sur les `nbMois` derniers mois (le mois courant compris), du plus récent au plus ancien.
 * Tous les mois sont renvoyés, y compris ceux sans envoi (à zéro) : un graphique ou un tableau n'a pas de trou.
 */
export async function lireUsageWhatsapp(managerId: string, nbMois = 6, maintenant: Date = new Date()): Promise<UsageMensuelWhatsapp[]> {
  const mois: string[] = [];
  for (let i = 0; i < nbMois; i++) mois.push(moisUtc(new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() - i, 1))));
  const lignes = await db
    .select()
    .from(whatsappUsage)
    .where(and(eq(whatsappUsage.managerId, managerId), gte(whatsappUsage.month, mois[mois.length - 1])))
    .orderBy(desc(whatsappUsage.month));
  const tarif = env.whatsapp.coutMessageUtilityUsd;
  return mois.map((m) => {
    const parType: Record<TypeMessageWhatsapp, number> = { avis_echeance: 0, echeance_proche: 0, relance_impaye: 0 };
    let echecs = 0;
    for (const ligne of lignes) {
      if (ligne.month !== m) continue;
      if ((TYPES_MESSAGE_WHATSAPP as readonly string[]).includes(ligne.type)) parType[ligne.type as TypeMessageWhatsapp] += ligne.sent;
      echecs += ligne.failed;
    }
    const envoyes = parType.avis_echeance + parType.echeance_proche + parType.relance_impaye;
    return { mois: m, parType, envoyes, echecs, coutEstimeUsd: arrondiUsd(envoyes * tarif) };
  });
}
