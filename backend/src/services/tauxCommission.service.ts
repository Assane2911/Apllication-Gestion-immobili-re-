import { eq, inArray } from "drizzle-orm";
import { db, Transaction } from "../db/client";
import { ownerFeeRates } from "../db/schema";
import { ANNEE_TAUX_INITIAL, TauxDepuis } from "../utils/tauxCommission";

/** Historique des taux de plusieurs propriétaires, en une requête. Un propriétaire absent de la table n'a jamais changé de taux. */
export async function chargerHistoriqueTaux(ownerIds: string[]): Promise<Map<string, TauxDepuis[]>> {
  const parProprietaire = new Map<string, TauxDepuis[]>();
  if (ownerIds.length === 0) return parProprietaire;
  const lignes = await db.select().from(ownerFeeRates).where(inArray(ownerFeeRates.ownerId, ownerIds));
  for (const l of lignes) {
    const liste = parProprietaire.get(l.ownerId) ?? [];
    liste.push({ year: l.effectiveYear, month: l.effectiveMonth, rate: l.rate });
    parProprietaire.set(l.ownerId, liste);
  }
  return parProprietaire;
}

/**
 * Enregistre un changement de taux à partir du mois en cours. Le premier changement garde aussi l'ancien taux, daté de
 * janvier 1970, pour que les mois déjà passés restent calculés à l'ancien taux. Changer deux fois dans le même mois
 * remplace la ligne du mois.
 */
export async function enregistrerChangementTaux(tx: Transaction, ownerId: string, ancienTaux: number, nouveauTaux: number, maintenant = new Date()) {
  const [dejaUneLigne] = await tx.select({ id: ownerFeeRates.id }).from(ownerFeeRates).where(eq(ownerFeeRates.ownerId, ownerId)).limit(1);
  if (!dejaUneLigne) {
    await tx.insert(ownerFeeRates).values({ ownerId, effectiveYear: ANNEE_TAUX_INITIAL, effectiveMonth: 1, rate: ancienTaux });
  }
  await tx
    .insert(ownerFeeRates)
    .values({ ownerId, effectiveYear: maintenant.getFullYear(), effectiveMonth: maintenant.getMonth() + 1, rate: nouveauTaux })
    .onConflictDoUpdate({
      target: [ownerFeeRates.ownerId, ownerFeeRates.effectiveYear, ownerFeeRates.effectiveMonth],
      set: { rate: nouveauTaux },
    });
}
