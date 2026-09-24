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
 * Convertit en jours, sur le NOUVEAU plan, la valeur monétaire encore due au
 * gestionnaire sur l'ANCIEN plan au moment d'un changement de formule
 * (upgrade ou downgrade) — la proratisation.
 *
 * calculerPeriode ci-dessus reporte le temps restant TEL QUEL, ce qui n'est
 * correct que pour un renouvellement du MÊME plan (même tarif journalier des
 * deux côtés). Lors d'un changement de plan, reporter le temps restant sans
 * le convertir crée un des deux défauts symétriques suivants :
 *
 * 1. Un gestionnaire avec 20 jours restants sur STARTER (9 €/mois, ~0,30
 *    €/jour) qui passe à PRO (29 €/mois, ~0,97 €/jour) sans conversion
 *    recevait 20 jours de PRO OFFERTS — largement plus que ce que ses 20
 *    jours de STARTER valaient réellement (~6 € au tarif PRO, contre 20
 *    jours facturés au tarif PRO complet).
 * 2. À l'inverse, ignorer purement le temps restant (le faire démarrer à
 *    "maintenant" sans aucun crédit) lui ferait perdre l'intégralité de ce
 *    qu'il avait déjà payé sur l'ancien plan, upgrade comme downgrade.
 *
 * La conversion : valeur non consommée de l'ancien plan (montant payé ×
 * fraction de jours restants) ÷ tarif journalier du nouveau plan = jours de
 * crédit sur le nouveau plan. Ni perdu, ni offert — juste reconverti.
 */
export function calculerJoursCredit(params: {
  ancienMontant: number;
  ancienCycleJours: number;
  joursRestants: number;
  nouveauMontant: number;
  nouveauCycleJours: number;
}): number {
  const { ancienMontant, ancienCycleJours, joursRestants, nouveauMontant, nouveauCycleJours } = params;
  if (joursRestants <= 0 || ancienCycleJours <= 0 || nouveauCycleJours <= 0 || nouveauMontant <= 0) {
    return 0;
  }

  const valeurNonConsommee = ancienMontant * (joursRestants / ancienCycleJours);
  const tarifJournalierNouveau = nouveauMontant / nouveauCycleJours;
  return valeurNonConsommee / tarifJournalierNouveau;
}

/** Ajoute un nombre (entier ou non — arrondi à l'entier le plus proche) de jours civils à une date. */
export function ajouterJours(depuis: Date, jours: number): Date {
  const resultat = new Date(depuis);
  resultat.setDate(resultat.getDate() + Math.round(jours));
  return resultat;
}

/**
 * Calcule la période à appliquer au moment où un paiement d'abonnement est
 * RÉELLEMENT activé — que ce soit tout de suite (subscribe(), paiement
 * confirmé de façon synchrone) ou en différé (activateSubscriptionRecord,
 * webhook PayDunya/Stripe ou validation d'un virement par un administrateur).
 *
 * RÉGRESSION que cette fonction corrige : les deux points d'activation
 * dupliquaient chacun leur propre calcul de la période, et seul celui de
 * subscribe() avait été mis à jour avec la proratisation (calculerJoursCredit)
 * lors d'un changement de plan. activateSubscriptionRecord — le SEUL chemin
 * réellement emprunté pour tout paiement asynchrone (virement bancaire,
 * PayDunya, Stripe) — continuait d'appeler calculerPeriode seul, en ignorant
 * totalement le plan/montant de l'ancien abonnement : un changement de plan
 * payé par un moyen différé recevait donc le temps restant reporté À VALEUR
 * NOMINALE PLEINE sur le nouveau plan (le défaut n°1 documenté plus haut sur
 * calculerJoursCredit), plus un cycle complet neuf par-dessus. En centralisant
 * le calcul ici, les deux points d'activation restent nécessairement
 * synchronisés.
 *
 * `dernierPaiement` est le dernier enregistrement PAID de l'ANCIEN plan
 * (celui qui porte son montant et sa périodicité réellement payés) ; `null`
 * quand il n'y en a pas ou que le plan ne change pas — la proratisation
 * n'entre en jeu QUE lors d'un changement de plan avec des jours encore dus.
 * On n'y transmet que `startDate` et `billingCycle`, jamais `endDate` — voir
 * pourquoi juste en dessous.
 */
export function calculerPeriodeActivation(params: {
  maintenant: Date;
  cycle: BillingCycle;
  changeDePlan: boolean;
  finActuelle: Date | null;
  nouveauMontant: number;
  /** Devise dans laquelle le NOUVEAU plan est facturé (voir deviseFacturee). */
  nouvelleDevise: string;
  dernierPaiement: {
    amount: number;
    startDate: Date;
    billingCycle: BillingCycle;
    /** Devise réellement payée à l'époque — pas forcément celle d'aujourd'hui. */
    currency: string;
    plan: string;
  } | null;
  /**
   * Accès au catalogue tarifaire, injecté plutôt qu'importé : le catalogue vit
   * dans subscription.controller.ts, qui appelle cette fonction. L'importer
   * ici fermerait le cycle, et ce service resterait alors intestable sans
   * monter tout un contrôleur.
   */
  tarifPourDevise: (plan: string, devise: string) => { monthly: number; annual: number } | null;
}): { startDate: Date; endDate: Date } {
  const { maintenant, cycle, changeDePlan, finActuelle, nouveauMontant, nouvelleDevise, dernierPaiement, tarifPourDevise } =
    params;
  const joursRestants = finActuelle ? (finActuelle.getTime() - maintenant.getTime()) / 86_400_000 : 0;

  if (changeDePlan && joursRestants > 0) {
    const base = calculerPeriode({ maintenant, cycle, finActuelle: null });

    if (!dernierPaiement) {
      // Pas d'historique de paiement exploitable (cas limite) : impossible de
      // reconvertir équitablement une valeur qu'on ne connaît pas. On démarre
      // une période neuve plutôt que de reporter aveuglément les jours
      // restants au tarif de l'ancien plan sur le nouveau.
      return base;
    }

    // Durée NOMINALE du cycle de l'ancien plan — recalculée depuis son
    // startDate, jamais lue sur son endDate. RÉGRESSION évitée : si ce
    // dernier paiement est LUI-MÊME issu d'un changement de plan précédent
    // avec crédit, son endDate a été allongé (voir ci-dessous) et ne reflète
    // plus un cycle nominal mais un cycle "mois + crédit précédent" — l'
    // utiliser sous-évaluerait le tarif journalier de l'ancien plan et
    // fausserait la conversion d'un changement de plan enchaîné. startDate,
    // lui, n'est JAMAIS modifié par la proratisation (seul endDate l'est,
    // juste en dessous), il reste donc toujours fiable comme ancrage.
    const ancienNominal = calculerPeriode({
      maintenant: dernierPaiement.startDate,
      cycle: dernierPaiement.billingCycle,
      finActuelle: null,
    });
    const ancienCycleJours = Math.max(
      1,
      Math.round((ancienNominal.endDate.getTime() - ancienNominal.startDate.getTime()) / 86_400_000)
    );
    const nouveauCycleJours = Math.max(1, Math.round((base.endDate.getTime() - base.startDate.getTime()) / 86_400_000));

    // Les deux montants doivent parler la même langue. `PATCH /auth/currency`
    // laisse un gestionnaire changer de devise quand il veut : diviser
    // 5 000 FCFA par un tarif journalier en euros ne compare pas deux durées,
    // ça compare deux unités — et donnait 3 448 jours de crédit, soit neuf ans
    // d'abonnement offerts. Le défaut symétrique (euro vers FCFA) faisait
    // perdre au client l'intégralité de ce qu'il avait payé.
    const ancienMontant = convertirVersDevise(dernierPaiement, nouvelleDevise, tarifPourDevise);
    if (ancienMontant === null) {
      // Devise retirée du catalogue, plan renommé : plutôt qu'un chiffre
      // fabriqué, une période neuve. Créditer trop peu se rattrape à la main ;
      // offrir neuf ans, non.
      return base;
    }

    const joursCredit = calculerJoursCredit({
      ancienMontant,
      ancienCycleJours,
      joursRestants,
      nouveauMontant,
      nouveauCycleJours,
    });
    return { startDate: base.startDate, endDate: ajouterJours(base.endDate, joursCredit) };
  }

  return calculerPeriode({ maintenant, cycle, finActuelle });
}

/**
 * Exprime un montant déjà payé dans la devise de facturation d'aujourd'hui.
 *
 * Il n'y a pas de taux de change à aller chercher : le catalogue tarife le
 * même plan dans chaque devise, et le rapport entre ces deux tarifs EST le
 * taux que la plateforme s'est elle-même donné. Passer par lui plutôt que par
 * un taux du marché a un avantage : une remise consentie à l'époque reste une
 * remise de la même proportion après conversion.
 *
 * `null` quand l'un des deux tarifs manque — le seul cas où mieux vaut ne rien
 * créditer que créditer au hasard.
 */
function convertirVersDevise(
  paiement: { amount: number; currency: string; plan: string; billingCycle: BillingCycle },
  deviseCible: string,
  tarifPourDevise: (plan: string, devise: string) => { monthly: number; annual: number } | null
): number | null {
  if (paiement.currency === deviseCible) return paiement.amount;

  const source = tarifPourDevise(paiement.plan, paiement.currency);
  const cible = tarifPourDevise(paiement.plan, deviseCible);
  if (!source || !cible) return null;

  const cle = paiement.billingCycle === "ANNUAL" ? "annual" : "monthly";
  if (!source[cle]) return null;

  return paiement.amount * (cible[cle] / source[cle]);
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
