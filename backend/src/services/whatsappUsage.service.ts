import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { agencySettings, users, whatsappUsage } from "../db/schema";
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

/** Les `nbMois` derniers mois civils (UTC), le mois courant compris, du plus récent au plus ancien. */
export function derniersMois(nbMois = 6, maintenant: Date = new Date()): string[] {
  const mois: string[] = [];
  for (let i = 0; i < nbMois; i++) mois.push(moisUtc(new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() - i, 1))));
  return mois;
}

type LigneUsage = typeof whatsappUsage.$inferSelect;

/** Additionne des lignes (un mois, une ou plusieurs agences) : par type, envoyés, échecs et coût estimé au tarif configuré. */
function agreger(mois: string, lignes: LigneUsage[]): UsageMensuelWhatsapp {
  const parType: Record<TypeMessageWhatsapp, number> = { avis_echeance: 0, echeance_proche: 0, relance_impaye: 0 };
  let echecs = 0;
  for (const ligne of lignes) {
    if ((TYPES_MESSAGE_WHATSAPP as readonly string[]).includes(ligne.type)) parType[ligne.type as TypeMessageWhatsapp] += ligne.sent;
    echecs += ligne.failed;
  }
  const envoyes = parType.avis_echeance + parType.echeance_proche + parType.relance_impaye;
  return { mois, parType, envoyes, echecs, coutEstimeUsd: arrondiUsd(envoyes * env.whatsapp.coutMessageUtilityUsd) };
}

/**
 * Consommation d'une agence sur les `nbMois` derniers mois (le mois courant compris), du plus récent au plus ancien.
 * Tous les mois sont renvoyés, y compris ceux sans envoi (à zéro) : un graphique ou un tableau n'a pas de trou.
 */
export async function lireUsageWhatsapp(managerId: string, nbMois = 6, maintenant: Date = new Date()): Promise<UsageMensuelWhatsapp[]> {
  const mois = derniersMois(nbMois, maintenant);
  const lignes = await db
    .select()
    .from(whatsappUsage)
    .where(and(eq(whatsappUsage.managerId, managerId), gte(whatsappUsage.month, mois[mois.length - 1])))
    .orderBy(desc(whatsappUsage.month));
  return mois.map((m) => agreger(m, lignes.filter((l) => l.month === m)));
}

export interface UsageAgenceWhatsapp extends UsageMensuelWhatsapp {
  managerId: string;
  /** Nom de l'agence, ou à défaut l'adresse e-mail du compte. */
  nom: string;
}

export interface UsagePlateformeWhatsapp {
  /** Total de toutes les agences, par mois, du plus récent au plus ancien (six mois, ceux sans envoi compris). */
  mois: UsageMensuelWhatsapp[];
  /** Le mois détaillé par agence. */
  moisChoisi: string;
  /** Les agences qui ont envoyé ou tenté d'envoyer au moins un message ce mois-là, les plus gourmandes d'abord. */
  agences: UsageAgenceWhatsapp[];
}

/**
 * Vue d'ensemble pour l'administrateur : le total de la plateforme mois par mois (ce que Meta facturera, à l'estimation
 * près) et, pour un mois, ce que chaque agence y a contribué. `moisChoisi` doit figurer parmi les `nbMois` derniers mois.
 */
export async function lireUsagePlateformeWhatsapp(moisChoisi?: string, nbMois = 6, maintenant: Date = new Date()): Promise<UsagePlateformeWhatsapp> {
  const mois = derniersMois(nbMois, maintenant);
  const choisi = moisChoisi ?? mois[0];
  const lignes = await db.select().from(whatsappUsage).where(gte(whatsappUsage.month, mois[mois.length - 1]));

  const duMois = lignes.filter((l) => l.month === choisi);
  const ids = [...new Set(duMois.map((l) => l.managerId))];
  const noms = new Map<string, string>();
  if (ids.length > 0) {
    const comptes = await db.select({ id: users.id, email: users.email, agence: agencySettings.agencyName }).from(users).leftJoin(agencySettings, eq(agencySettings.userId, users.id)).where(inArray(users.id, ids));
    for (const c of comptes) noms.set(c.id, c.agence?.trim() ? c.agence : c.email);
  }
  const agences = ids
    .map((managerId) => ({ managerId, nom: noms.get(managerId) ?? managerId, ...agreger(choisi, duMois.filter((l) => l.managerId === managerId)) }))
    .sort((a, b) => b.envoyes - a.envoyes || b.echecs - a.echecs || a.nom.localeCompare(b.nom));

  return { mois: mois.map((m) => agreger(m, lignes.filter((l) => l.month === m))), moisChoisi: choisi, agences };
}
