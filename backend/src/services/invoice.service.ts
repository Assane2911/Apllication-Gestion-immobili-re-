import { and, eq, lt } from "drizzle-orm";
import { db, DbClient } from "../db/client";
import { contracts, invoices } from "../db/schema";
import { debutDeLaJournee } from "../utils/dates";

type Contract = typeof contracts.$inferSelect;

/** Jours d'un mois réellement couverts par une période contractuelle. */
export interface PeriodeCouverte {
  /** Premier jour du mois couvert par le contrat (1-31), 0 si aucun. */
  premierJour: number;
  /** Dernier jour du mois couvert par le contrat (1-31), 0 si aucun. */
  dernierJour: number;
  /** Nombre de jours couverts, bornes incluses. */
  jours: number;
  /** Nombre de jours que compte ce mois. */
  joursDuMois: number;
  /** Le contrat couvre-t-il le mois entier ? */
  complet: boolean;
}

/**
 * Jours du mois (periodMonth/periodYear) réellement couverts par un bail.
 *
 * Le calcul se fait en NUMÉROS DE JOUR, jamais en différence de timestamps :
 * les bornes du contrat portent une heure, et un écart de fuseau ou un
 * changement d'heure d'été suffirait à faire basculer un jour entier.
 */
export function periodeCouverte(
  bornes: { startDate: Date | string; endDate: Date | string },
  periodMonth: number,
  periodYear: number
): PeriodeCouverte {
  const debut = new Date(bornes.startDate);
  const fin = new Date(bornes.endDate);
  const joursDuMois = new Date(periodYear, periodMonth, 0).getDate();

  const indexDuMois = periodYear * 12 + (periodMonth - 1);
  const indexDebut = debut.getFullYear() * 12 + debut.getMonth();
  const indexFin = fin.getFullYear() * 12 + fin.getMonth();

  if (indexDuMois < indexDebut || indexDuMois > indexFin) {
    return { premierJour: 0, dernierJour: 0, jours: 0, joursDuMois, complet: false };
  }

  const premierJour = indexDuMois === indexDebut ? Math.max(1, debut.getDate()) : 1;
  const dernierJour = indexDuMois === indexFin ? Math.min(joursDuMois, fin.getDate()) : joursDuMois;
  const jours = Math.max(0, dernierJour - premierJour + 1);

  return { premierJour, dernierJour, jours, joursDuMois, complet: jours >= joursDuMois };
}

/**
 * Génère les factures de loyer manquantes pour un contrat actif, du mois de
 * début du contrat jusqu'au mois courant (ou jusqu'à la fin du contrat si
 * elle est déjà passée). Idempotent grâce à l'index unique
 * (contractId, mois, année) — sûr à appeler plusieurs fois.
 *
 * Le premier et le dernier mois d'un bail sont facturés AU PRORATA des jours
 * réellement occupés, comme le veut l'usage en gestion locative : un bail
 * démarrant le 25 ne doit pas coûter un mois entier. Les mois intermédiaires
 * valent le loyer plein, au centime près (aucun arrondi ne s'y applique).
 *
 * La règle qui en découle tient en une phrase : CHAQUE LOCATAIRE PAIE SES
 * PROPRES JOURS. Deux baux qui se succèdent en cours de mois facturent donc
 * chacun sa part, là où le mois de transition revenait auparavant en entier
 * au premier et rien au second.
 */
export type FactureExistantePourGeneration = {
  contractId: string;
  periodMonth: number;
  periodYear: number;
  status: string;
  contractStart: Date;
  contractEnd: Date;
};

/**
 * `existingInvoicesHint`, quand fourni, remplace la requête interne
 * ci-dessous par ce jeu de données déjà chargé — utilisé par
 * `runRentDueReminders` pour éviter une requête par contrat quand elle
 * traite un grand nombre de contrats actifs d'un coup (voir son
 * `facturesParBien`). Ne JAMAIS passer un instantané qui pourrait être
 * périmé : ce paramètre n'existe que pour le cas où le bien n'a, dans le lot
 * traité, qu'UN SEUL contrat actif — aucun autre appel de cette même
 * exécution ne peut alors avoir inséré de facture pour ce bien entre le
 * chargement de l'instantané et cet appel. Dès qu'un bien a plusieurs
 * contrats actifs dans le même lot (transition de renouvellement), l'appelant
 * doit omettre ce paramètre pour que chaque appel relise l'état réel — voir
 * le commentaire sur `facturesDesAutresContrats` ci-dessous, qui explique
 * pourquoi cette fraîcheur est indispensable à la correction du calcul.
 */
export async function generateInvoicesForContract(
  contract: Contract,
  dbClient: DbClient = db,
  existingInvoicesHint?: FactureExistantePourGeneration[]
) {
  const start = new Date(contract.startDate);
  const end = new Date(contract.endDate);
  const today = new Date();
  const cutoff = end < today ? end : today;

  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const created: string[] = [];

  // Le mois déjà facturé par N'IMPORTE QUEL contrat de CE bien (pas
  // seulement celui-ci) ne doit jamais l'être une seconde fois. Un
  // renouvellement (voir renewContract) démarre le nouveau contrat le
  // lendemain de la fin de l'ancien, mais le curseur ci-dessus repart
  // toujours du 1er du mois de son startDate — sans ce garde-fou au niveau
  // du bien, le mois de transition recevait une facture PLEINE de l'ancien
  // contrat (déjà émise avant le renouvellement) ET une facture PLEINE du
  // nouveau (émise aussitôt après), soit le double du loyer réellement dû
  // pour ce mois. L'index unique (contractId, mois, année) ne pouvait pas
  // l'empêcher : il protège contre un doublon au sein d'un même contrat, pas
  // entre deux contrats successifs sur le même bien.
  //
  // Une facture ANNULÉE ne compte pas comme un mois facturé : elle n'est plus
  // réclamée à personne. Sans cette nuance, annuler une facture erronée gelait
  // son mois définitivement — le loyer ne pouvait plus jamais être facturé, ni
  // au même locataire ni à son successeur, et rien ne le signalait.
  const existingInvoices =
    existingInvoicesHint ??
    (await dbClient
      .select({
        contractId: invoices.contractId,
        periodMonth: invoices.periodMonth,
        periodYear: invoices.periodYear,
        status: invoices.status,
        contractStart: contracts.startDate,
        contractEnd: contracts.endDate,
      })
      .from(invoices)
      .innerJoin(contracts, eq(invoices.contractId, contracts.id))
      .where(eq(contracts.propertyId, contract.propertyId)));

  type LigneExistante = FactureExistantePourGeneration;

  // Factures VIVANTES des AUTRES contrats du bien : le garde ci-dessus opère
  // désormais sur les JOURS et non sur le mois entier, puisque chaque contrat
  // ne facture que sa propre période. Deux baux successifs couvrent des jours
  // disjoints par construction ; un chevauchement signale une anomalie de
  // dates, et on s'abstient alors plutôt que de facturer deux fois.
  //
  // Conséquence assumée sur les données antérieures au prorata : une facture
  // de mois PLEIN émise par un contrat qui s'arrêtait en cours de mois est
  // relue ici comme ne couvrant que les jours de SON contrat. Le successeur
  // facturera donc ses propres jours, et ce mois-là aura été sur-facturé au
  // premier locataire — anomalie héritée de l'ancienne règle, que le
  // gestionnaire peut corriger en annulant la facture concernée.
  const facturesDesAutresContrats = existingInvoices.filter(
    (i: LigneExistante) => i.contractId !== contract.id && i.status !== "CANCELLED"
  );

  // Mois déjà présents pour CE contrat, annulations comprises : l'index unique
  // (contractId, mois, année) existe toujours, donc réinsérer ici échouerait.
  // Une facture annulée ne se régénère ainsi que via un AUTRE contrat du bien
  // (nouveau locataire), jamais en doublon sur le même.
  const clesDeCeContrat = new Set(
    existingInvoices
      .filter((i: LigneExistante) => i.contractId === contract.id)
      .map((i: LigneExistante) => `${i.periodMonth}-${i.periodYear}`)
  );

  while (cursor <= cutoff) {
    const periodMonth = cursor.getMonth() + 1;
    const periodYear = cursor.getFullYear();
    // new Date(year, month, day) déborde silencieusement sur le mois suivant
    // quand `day` dépasse le nombre de jours du mois visé (ex: un bail
    // démarrant le 31 janvier produisait une échéance "Février" au 3 mars).
    // On plafonne donc le jour souhaité au dernier jour réel du mois de la
    // période — new Date(year, month, 0) donne le dernier jour du mois
    // (month - 1) puisque le jour 0 recule d'un jour depuis le 1er du mois
    // suivant.
    const desiredDay = start.getDate() || 1;
    const lastDayOfPeriodMonth = new Date(periodYear, periodMonth, 0).getDate();
    const dueDate = new Date(periodYear, periodMonth - 1, Math.min(desiredDay, lastDayOfPeriodMonth));

    const cle = `${periodMonth}-${periodYear}`;
    const notrePeriode = periodeCouverte(contract, periodMonth, periodYear);

    // Un autre contrat du bien couvre-t-il un seul des jours que nous
    // facturerions ? Les bornes sont inclusives des deux côtés.
    const chevauchement = facturesDesAutresContrats.some((autre: LigneExistante) => {
      if (autre.periodMonth !== periodMonth || autre.periodYear !== periodYear) return false;
      const sienne = periodeCouverte(
        { startDate: autre.contractStart, endDate: autre.contractEnd },
        periodMonth,
        periodYear
      );
      if (sienne.jours === 0) return false;
      return notrePeriode.premierJour <= sienne.dernierJour && sienne.premierJour <= notrePeriode.dernierJour;
    });

    if (notrePeriode.jours > 0 && !chevauchement && !clesDeCeContrat.has(cle)) {
      // Mois entier : le loyer tel quel, sans passer par le calcul au prorata
      // — un arrondi sur un mois complet ferait dériver le montant de
      // quelques centimes par rapport au loyer inscrit au bail.
      const montant = notrePeriode.complet
        ? contract.rent
        : Math.round(((contract.rent * notrePeriode.jours) / notrePeriode.joursDuMois) * 100) / 100;

      const [invoice] = await dbClient
        .insert(invoices)
        .values({
          contractId: contract.id,
          periodMonth,
          periodYear,
          amount: montant,
          currency: contract.currency ?? "EUR",
          dueDate,
          // Une facture due AUJOURD'HUI n'est pas en retard : le locataire a
          // jusqu'à la fin de la journée. Comparer `dueDate` (minuit) à
          // l'heure courante la faisait naître en LATE dès lors que la
          // génération avait lieu après minuit — or le job planifié tourne à
          // 8h, donc systématiquement.
          status: dueDate < debutDeLaJournee(today) ? "LATE" : "PENDING",
        })
        .returning();
      created.push(invoice.id);
    }

    cursor.setMonth(cursor.getMonth() + 1);
  }

  return created;
}

/**
 * Repasse en LATE les factures PENDING dont la date d'échéance est dépassée.
 * « Dépassée » signifie : antérieure au jour courant — une facture due
 * aujourd'hui reste PENDING jusqu'à demain (voir debutDeLaJournee).
 */
export async function markOverdueInvoices() {
  const result = await db
    .update(invoices)
    .set({ status: "LATE" })
    .where(and(eq(invoices.status, "PENDING"), lt(invoices.dueDate, debutDeLaJournee())))
    .returning();
  return result.length;
}
