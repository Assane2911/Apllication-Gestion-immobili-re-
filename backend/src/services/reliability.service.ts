import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { contracts, invoices } from "../db/schema";

export type NiveauFiabilite = "excellent" | "bon" | "moyen" | "risque" | "insuffisant";

export interface StatsFiabilite {
  payeATemps: number;
  payeEnRetard: number;
  enRetardActuel: number;
}

export interface Fiabilite extends StatsFiabilite {
  score: number | null;
  niveau: NiveauFiabilite;
}

// Sous ce nombre de factures déjà échues, un score serait un chiffre à deux
// décimales tiré d'un seul mois : plus trompeur qu'utile pour juger un
// locataire. On affiche "historique insuffisant" plutôt qu'un score fragile.
const FACTURES_MINIMUM_POUR_SCORE = 3;

/**
 * Score interne (0-100) de ponctualité de paiement d'un locataire, calculé
 * uniquement à partir des factures déjà échues sur l'ENSEMBLE de ses contrats
 * (passés et en cours) :
 *  - payée à temps (PAID, réglée au plus tard le jour de l'échéance) : 1 point
 *  - payée en retard (PAID, réglée après l'échéance) : 0,5 point — le loyer a
 *    fini par rentrer, mais il a fallu relancer
 *  - actuellement impayée (statut LATE, échue et toujours non réglée) : 0 point
 *
 * Les factures PENDING (pas encore échues : rien ne s'est encore joué) et
 * CANCELLED (annulées côté agence, jamais imputables au locataire) ne
 * comptent pas dans le total.
 *
 * C'est un indicateur interne de ponctualité de paiement, pas un score de
 * solvabilité ni un motif de refus : il ne doit pas remplacer l'examen du
 * dossier d'un candidat locataire.
 */
export function calculerFiabilite(stats: StatsFiabilite): Fiabilite {
  const total = stats.payeATemps + stats.payeEnRetard + stats.enRetardActuel;
  if (total < FACTURES_MINIMUM_POUR_SCORE) {
    return { ...stats, score: null, niveau: "insuffisant" };
  }

  const points = stats.payeATemps + stats.payeEnRetard * 0.5;
  const score = Math.round((points / total) * 100);

  let niveau: NiveauFiabilite;
  if (score >= 90) niveau = "excellent";
  else if (score >= 75) niveau = "bon";
  else if (score >= 50) niveau = "moyen";
  else niveau = "risque";

  return { ...stats, score, niveau };
}

/**
 * Calcule la fiabilité de plusieurs locataires en une seule requête groupée
 * (plutôt qu'une requête par locataire, coûteuse sur une liste paginée).
 */
export async function fetchFiabiliteParLocataire(tenantIds: string[]): Promise<Map<string, Fiabilite>> {
  const resultat = new Map<string, Fiabilite>();
  if (tenantIds.length === 0) return resultat;

  const lignes = await db
    .select({
      tenantId: contracts.tenantId,
      payeATemps: sql<number>`count(*) filter (where ${invoices.status} = 'PAID' and ${invoices.paidAt} <= ${invoices.dueDate})::int`,
      payeEnRetard: sql<number>`count(*) filter (where ${invoices.status} = 'PAID' and ${invoices.paidAt} > ${invoices.dueDate})::int`,
      enRetardActuel: sql<number>`count(*) filter (where ${invoices.status} = 'LATE')::int`,
    })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .where(inArray(contracts.tenantId, tenantIds))
    .groupBy(contracts.tenantId);

  for (const ligne of lignes) {
    resultat.set(
      ligne.tenantId,
      calculerFiabilite({
        payeATemps: ligne.payeATemps,
        payeEnRetard: ligne.payeEnRetard,
        enRetardActuel: ligne.enRetardActuel,
      })
    );
  }

  // Un locataire sans aucune facture échue (contrat tout neuf) n'apparaît
  // dans aucune ligne ci-dessus : il a bien un score ("insuffisant"), ce
  // n'est pas une clé absente de la map.
  for (const id of tenantIds) {
    if (!resultat.has(id)) {
      resultat.set(id, calculerFiabilite({ payeATemps: 0, payeEnRetard: 0, enRetardActuel: 0 }));
    }
  }

  return resultat;
}
