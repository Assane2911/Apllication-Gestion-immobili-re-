import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db, DbClient } from "../db/client";
import { expenses } from "../db/schema";
import { ajouterPeriode, BillingCycle } from "./subscriptionPeriod.service";
import { BudgetTemps, SANS_LIMITE } from "../utils/budgetTemps";

/**
 * Génère les occurrences manquantes de toutes les dépenses récurrentes
 * (modèles), jusqu'à aujourd'hui.
 *
 * Un modèle est une dépense ordinaire qui porte en plus `recurrence` —
 * `templateId` restant NULL dessus la distingue d'une occurrence déjà
 * générée (voir schema.ts::expenses). Chaque modèle fait l'objet d'une
 * génération indépendante ; `budget` est consulté entre deux modèles, jamais
 * au milieu d'un seul (un modèle en retard de plusieurs mois reste ainsi
 * toujours généré d'un bloc, jamais à moitié).
 */
export async function runRecurringExpenseGeneration(budget: BudgetTemps = SANS_LIMITE) {
  const templates = await db
    .select()
    .from(expenses)
    .where(and(isNotNull(expenses.recurrence), isNull(expenses.templateId)));

  let generees = 0;
  let interrompu = false;

  for (const template of templates) {
    if (budget.epuise()) {
      interrompu = true;
      break;
    }
    generees += await genererOccurrencesManquantes(template);
  }

  return { generees, interrompu };
}

type ExpenseRow = typeof expenses.$inferSelect;

/**
 * Génère, pour UN modèle, toutes les occurrences dont la date est déjà
 * passée (ou aujourd'hui) et qui n'existent pas encore.
 *
 * Repart du dernier `periodIndex` déjà généré (et non de 1 à chaque fois) :
 * sur un modèle mensuel vieux de plusieurs années, relire ce maximum coûte
 * une requête contre des dizaines de tentatives d'insertion rejetées pour
 * doublon.
 */
async function genererOccurrencesManquantes(template: ExpenseRow, dbClient: DbClient = db): Promise<number> {
  const cycle: BillingCycle = template.recurrence === "ANNUAL" ? "ANNUAL" : "MONTHLY";
  const maintenant = new Date();

  const [derniere] = await dbClient
    .select({ periodIndex: expenses.periodIndex })
    .from(expenses)
    .where(eq(expenses.templateId, template.id))
    .orderBy(desc(expenses.periodIndex))
    .limit(1);

  let index = derniere?.periodIndex ?? 0;
  // Curseur rattrapé jusqu'à la dernière occurrence déjà générée (ou laissé
  // sur le modèle lui-même s'il n'y en a aucune), PUIS avancé d'une seule
  // période à la fois dans la boucle ci-dessous : recalculer chaque date
  // depuis `expenseDate` à chaque itération referait tout le chemin déjà
  // parcouru à l'itération précédente.
  let dateOccurrence = template.expenseDate;
  for (let i = 0; i < index; i++) {
    dateOccurrence = ajouterPeriode(dateOccurrence, cycle);
  }
  let generees = 0;

  // Borne de sécurité : un modèle mal configuré (date de fin avant la date de
  // départ, par exemple) ne doit jamais transformer un bug de configuration
  // en boucle infinie. 1000 occurrences représentent déjà plus de 80 ans au
  // rythme mensuel le plus rapproché possible.
  const GARDE_FOU = 1000;

  while (true) {
    index++;
    if (index > GARDE_FOU) break;
    dateOccurrence = ajouterPeriode(dateOccurrence, cycle);
    if (dateOccurrence > maintenant) break;
    if (template.recurrenceEndDate && dateOccurrence > template.recurrenceEndDate) break;

    // `.returning()` renvoie une ligne vide quand onConflictDoNothing a
    // effectivement arbitré un conflit (course avec une autre exécution) :
    // sans ce contrôle, `generees` comptait aussi les tentatives rejetées,
    // annonçant une dépense "générée" alors qu'aucune ligne n'avait bougé.
    const insertedRows = await dbClient
      .insert(expenses)
      .values({
        propertyId: template.propertyId,
        category: template.category,
        title: template.title,
        amount: template.amount,
        currency: template.currency,
        expenseDate: dateOccurrence,
        notes: template.notes,
        templateId: template.id,
        periodIndex: index,
      })
      .onConflictDoNothing({ target: [expenses.templateId, expenses.periodIndex] })
      .returning({ id: expenses.id });

    if (insertedRows.length > 0) generees++;
  }

  return generees;
}
