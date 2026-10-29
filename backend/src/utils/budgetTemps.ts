/**
 * Budget de temps pour une tâche planifiée qui s'exécute dans une fonction
 * serverless.
 *
 * Une fonction Vercel est TUÉE net quand elle dépasse sa durée maximale
 * (300 s par défaut, plan Hobby compris). Une tâche qui parcourt toute la
 * plateforme — générer les factures, puis un email et un message WhatsApp par
 * locataire — finit par franchir ce mur à mesure que le nombre de locataires
 * augmente. Et le faire est bien pire que de s'arrêter : l'exécution est
 * interrompue au milieu d'un envoi, la moitié des locataires est prévenue,
 * l'autre ne l'est pas, et rien n'en garde trace.
 *
 * Le budget transforme cette coupure subie en arrêt choisi. Les boucles le
 * consultent AVANT de traiter un élément de plus : si le temps restant ne
 * suffit plus, elles s'arrêtent proprement et signalent l'interruption. Les
 * éléments non traités n'ont alors pas été réclamés (leur champ
 * `...SentAt` reste vide), donc l'exécution suivante les reprend d'elle-même :
 * c'est l'idempotence déjà en place qui fait office de reprise.
 */
export interface BudgetTemps {
  /** Le temps imparti est-il écoulé ? */
  epuise(): boolean;
  /** Millisecondes restantes (0 si épuisé) — utile pour journaliser. */
  restant(): number;
}

/**
 * Budget démarrant maintenant, pour `dureeMs` millisecondes.
 *
 * `Date.now()` est lu à chaque appel plutôt que mémorisé : sous `vi.useFakeTimers`,
 * c'est ce qui permet à un test d'avancer l'horloge pour provoquer l'épuisement.
 */
export function budgetTemps(dureeMs: number): BudgetTemps {
  const debut = Date.now();
  const echeance = debut + dureeMs;
  return {
    epuise: () => Date.now() >= echeance,
    restant: () => Math.max(0, echeance - Date.now()),
  };
}

/**
 * Budget qui ne s'épuise jamais — valeur par défaut des fonctions de rappel,
 * pour que le déclenchement manuel d'un gestionnaire et les tests existants
 * gardent exactement le comportement d'avant.
 */
export const SANS_LIMITE: BudgetTemps = {
  epuise: () => false,
  restant: () => Number.POSITIVE_INFINITY,
};

/**
 * Traite `elements` avec au plus `concurrence` éléments en cours à la fois, en consultant le budget AVANT de prendre le suivant
 * (comme les boucles séquentielles qu'elle remplace : un élément non pris n'a pas été réclamé, l'exécution suivante le reprend).
 *
 * Un envoi d'e-mail attend la réponse du serveur d'envoi (une demi-seconde environ) : un par un, une exécution quotidienne de
 * quatre minutes ne dépassait pas quelques centaines d'envois. Les éléments en cours quand le budget s'épuise sont menés à
 * leur terme, et la durée de la fonction dépasse donc le budget d'au plus un envoi.
 *
 * Si `traiter` lève une erreur, plus aucun élément n'est pris et l'erreur est relayée une fois les éléments en cours terminés,
 * comme l'arrêt de la boucle séquentielle.
 */
export async function traiterParLots<T>(
  elements: readonly T[],
  concurrence: number,
  budget: BudgetTemps,
  traiter: (element: T, rang: number) => Promise<void>
): Promise<{ interrompu: boolean }> {
  let prochain = 0;
  let interrompu = false;
  let erreur: { cause: unknown } | null = null;

  const travailleur = async () => {
    while (prochain < elements.length && !erreur) {
      if (budget.epuise()) {
        interrompu = true;
        return;
      }
      const rang = prochain++;
      try {
        await traiter(elements[rang], rang);
      } catch (cause) {
        erreur ??= { cause };
      }
    }
  };

  const travailleurs = Math.max(1, Math.min(Math.floor(concurrence) || 1, elements.length));
  await Promise.all(Array.from({ length: travailleurs }, travailleur));
  if (erreur) throw (erreur as { cause: unknown }).cause;
  return { interrompu };
}
