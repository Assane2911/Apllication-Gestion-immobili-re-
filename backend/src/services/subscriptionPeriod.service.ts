export type BillingCycle = "MONTHLY" | "ANNUAL";

/**
 * Calcule la période couverte par un paiement d'abonnement.
 *
 * DEUX DÉFAUTS que cette fonction corrige, tous deux dus au même geste :
 * ancrer la période sur le mauvais instant.
 *
 * 1. RENOUVELLEMENT ANTICIPÉ. `subscribe()` calculait systématiquement la fin
 *    à partir de l'instant de la demande. Un gestionnaire abonné jusqu'au
 *    30 septembre qui renouvelait le 10 repartait donc jusqu'au 10 octobre :
 *    il perdait les 20 jours qu'il avait déjà payés. Renouveler avant
 *    l'échéance — le comportement que l'interface encourage, et le seul qui
 *    évite une coupure d'accès — était puni.
 *
 * 2. VIREMENT BANCAIRE. La période était figée au moment de la DEMANDE, alors
 *    que l'accès ne s'ouvre qu'à la validation du virement par un
 *    administrateur. Entre les deux il peut s'écouler plusieurs jours : le
 *    client payait un mois et en recevait trois semaines. Même chose pour un
 *    paiement Mobile Money ou carte confirmé en différé.
 *
 * La règle est la même dans les deux cas : la nouvelle période commence au
 * plus tard entre MAINTENANT et la fin des droits déjà acquis. Rien n'est
 * perdu, rien n'est offert. D'où le recalcul à l'activation et non à la
 * demande (voir activateSubscriptionRecord).
 *
 * `finActuelle` ne doit être que du temps DÉJÀ PAYÉ — users.subscriptionEndsAt,
 * jamais trialEndsAt. Un compte en essai qui souscrit ne doit pas cumuler son
 * essai gratuit avec le mois qu'il achète ; le schéma sépare bien les deux
 * colonnes, et subscriptionEndsAt reste nul tant qu'aucun paiement n'a abouti.
 *
 * Un abonnement résilié (status CANCELLED) conserve sa date de fin : ces
 * jours-là ont été payés et sont donc reportés eux aussi.
 */
export function calculerPeriode(params: {
  maintenant: Date;
  cycle: BillingCycle;
  finActuelle?: Date | null;
}): { startDate: Date; endDate: Date } {
  const { maintenant, cycle, finActuelle } = params;

  const startDate =
    finActuelle && finActuelle.getTime() > maintenant.getTime() ? new Date(finActuelle) : new Date(maintenant);

  return { startDate, endDate: ajouter(startDate, cycle) };
}

/**
 * Ajoute un mois ou un an à une date, SANS le débordement de `setMonth()`.
 *
 * `new Date(2026, 0, 31).setMonth(1)` ne donne pas le 28 février mais le
 * 3 mars : février n'ayant pas de 31, JavaScript reporte silencieusement sur
 * le mois suivant. Un abonnement souscrit un 31 janvier durait donc 31 jours
 * au lieu de 28, et un 31 août se terminait le 1er octobre. Même chose pour le
 * 29 février d'une année bissextile renouvelé un an plus tard.
 *
 * On plafonne donc au dernier jour du mois visé, ce qui est la convention
 * partout ailleurs en facturation : le 31 janvier + 1 mois = 28 (ou 29)
 * février.
 */
function ajouter(depuis: Date, cycle: BillingCycle): Date {
  const resultat = new Date(depuis);
  const jour = resultat.getDate();

  // Le 1er du mois ne peut jamais déborder : on s'y place avant de décaler.
  resultat.setDate(1);
  if (cycle === "ANNUAL") {
    resultat.setFullYear(resultat.getFullYear() + 1);
  } else {
    resultat.setMonth(resultat.getMonth() + 1);
  }

  resultat.setDate(Math.min(jour, dernierJourDuMois(resultat)));
  return resultat;
}

/** Nombre de jours du mois dans lequel tombe `date`. Le jour 0 du mois suivant est le dernier du mois courant. */
function dernierJourDuMois(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}
