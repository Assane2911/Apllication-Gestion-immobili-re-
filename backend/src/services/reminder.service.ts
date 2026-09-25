import { SQL, and, desc, eq, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
import cron from "node-cron";
import { env } from "../config/env";
import { db } from "../db/client";
import { contracts, invoices, properties, tenants, users } from "../db/schema";
import { logActivity } from "./activity.service";
import { ApiError } from "../utils/asyncHandler";
import { BudgetTemps, SANS_LIMITE } from "../utils/budgetTemps";
import { debutDeLaJournee, finDeLaJournee, joursEntre, jourDecale } from "../utils/dates";
import { contractEndingReminderEmail, rentDueReminderEmail, rentDueSoonReminderEmail, sendEmail } from "./email.service";
import { FactureExistantePourGeneration, generateInvoicesForContract, markOverdueInvoices } from "./invoice.service";
import { envoyerMessageWhatsapp, rentDueReminderWhatsappVariables, rentDueSoonReminderWhatsappVariables } from "./whatsapp.service";
import { nomAvecCivilite, nomComplet } from "../utils/nom";

/**
 * Le destinataire a-t-il été joint ?
 *
 * `sendEmail` et `envoyerMessageWhatsapp` ne lèvent jamais : ils journalisent
 * et renvoient leur verdict. Personne ne le relisait, et le marqueur
 * anti-doublon — posé AVANT l'envoi — restait en place même quand rien
 * n'était parti. Une panne SMTP de quelques minutes pendant le cron suffisait
 * donc à priver définitivement des locataires de leur avis : le lendemain, le
 * filtre `isNull(reminderSentAt)` les excluait.
 *
 * Un seul canal suffit. Si le WhatsApp est arrivé, le locataire est au
 * courant : relâcher le marqueur lui renverrait le lendemain un message qu'il
 * a déjà lu.
 *
 * L'email est le canal de référence — WhatsApp s'y AJOUTE, il ne le remplace
 * pas — et seul son échec RÉEL compte. Un envoi simulé (service non
 * configuré, environnement de test) n'est pas un échec : c'est le système qui
 * fait ce qu'on lui a demandé, et le traiter comme une panne ferait retenter
 * chaque jour, indéfiniment, une configuration absente.
 */
function aEteJoint(
  email: { simulated: boolean; error?: boolean },
  whatsapp: { simulated: boolean; error?: boolean }
): boolean {
  if (!email.error) return true;
  return !whatsapp.simulated && !whatsapp.error;
}

/**
 * `aEteJoint` ne compte l'envoi WhatsApp en échec que si l'email l'est AUSSI
 * (un seul canal suffit, voir plus haut). Un vrai échec WhatsApp (numéro
 * invalide, modèle rejeté par Meta, jeton expiré) alors que l'email est
 * bien parti passait donc entièrement sous silence : ni compté dans
 * `echecs`, ni visible ailleurs que dans un log serveur — le gestionnaire
 * lisait « N avis envoyés » sans savoir qu'une partie de ses locataires
 * n'avait rien reçu sur WhatsApp. On ne journalise ici QUE les vrais échecs
 * (`error: true` — numéro invalide, erreur API, erreur réseau), jamais une
 * simulation (WhatsApp non configuré) : ce cas-là n'est pas une panne, et le
 * journaliser à chaque exécution du cron spammerait le journal d'activité
 * d'une agence qui n'a simplement pas encore activé WhatsApp.
 */
async function signalerEchecsWhatsapp(
  echecsParManager: Map<string, { count: number; dernierMotif: string }>,
  contexte: string
) {
  for (const [managerId, { count, dernierMotif }] of echecsParManager) {
    await logActivity({
      managerId,
      action: "reminder.whatsapp_failed",
      entityType: "reminder",
      entityLabel: contexte,
      details: `${count} message${count > 1 ? "s" : ""} WhatsApp non délivré${count > 1 ? "s" : ""} (${contexte}) — l'email a bien été envoyé, mais vérifiez le numéro du locataire et la configuration WhatsApp (dernier motif : ${dernierMotif}).`,
    });
  }
}

/**
 * Recherche les contrats ACTIFS dont la date de fin approche et qui n'ont pas
 * encore reçu de rappel, puis prévient le gestionnaire propriétaire du bien
 * et marque `reminderSentAt` pour éviter les envois en double.
 *
 * Le destinataire est l'adresse du COMPTE du gestionnaire (users.email),
 * atteinte via properties.managerId. Le rappel partait auparavant vers
 * `env.smtp.user`, c'est-à-dire la boîte qui ENVOIE les messages : celle de
 * l'exploitant de la plateforme. Sur une plateforme mono-utilisateur la
 * confusion passait inaperçue ; dès le deuxième gestionnaire, aucun d'eux ne
 * recevait le rappel de ses propres baux et l'exploitant les recevait tous,
 * nom du locataire et intitulé du bien compris.
 */
export async function runContractEndingReminders(budget: BudgetTemps = SANS_LIMITE) {
  const daysBefore = env.reminder.daysBefore;

  const now = new Date();
  // Fenêtre GLISSANTE, d'aujourd'hui à J+daysBefore inclus, et non le seul
  // jour J+daysBefore : une exécution manquée (déploiement en cours,
  // fonction serverless en échec, incident de plateforme) faisait sortir le
  // contrat de la fenêtre dès le lendemain, et son rappel n'était alors plus
  // jamais envoyé — silencieusement, puisque reminderSentAt restait vide.
  // C'est reminderSentAt, et lui seul, qui empêche le doublon pendant les
  // jours où le contrat reste dans la fenêtre.
  const targetStart = debutDeLaJournee(now);
  const targetEnd = finDeLaJournee(jourDecale(daysBefore, now));

  const rows = await db
    .select({
      contract: contracts,
      tenant: tenants,
      property: properties,
      managerEmail: users.email,
    })
    .from(contracts)
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .innerJoin(users, eq(properties.managerId, users.id))
    .where(
      and(
        eq(contracts.status, "ACTIVE"),
        // Un locataire qui a exercé son droit à l'effacement n'est plus
        // destinataire de rien : son adresse pointe vers un domaine
        // inexistant, et surtout le traitement n'est plus autorisé.
        isNull(tenants.anonymizedAt),
        isNull(contracts.reminderSentAt),
        gte(contracts.endDate, targetStart),
        lte(contracts.endDate, targetEnd)
      )
    );

  let sent = 0;
  let echecs = 0;
  let interrompu = false;
  for (const row of rows) {
    // Le budget se consulte AVANT de réclamer la ligne : s'arrêter ici la
    // laisse non marquée, donc reprenable telle quelle par l'exécution
    // suivante (voir utils/budgetTemps.ts).
    if (budget.epuise()) {
      interrompu = true;
      break;
    }

    // Réclamation atomique AVANT l'envoi (même principe que
    // invoice.controller.ts::payInvoice / paymentAttemptStartedAt) : la
    // requête SELECT ci-dessus charge un instantané des contrats sans
    // rappel envoyé, mais rien n'empêchait auparavant deux exécutions
    // concurrentes de ce job (chevauchement du cron si un envoi précédent
    // traîne, ou un futur déclenchement manuel) de charger le MÊME
    // instantané avant que l'une ou l'autre n'ait eu le temps d'écrire
    // `reminderSentAt` — chacune envoyait alors son propre email pour le
    // même contrat. Seule une des deux exécutions concurrentes peut
    // réclamer une ligne donnée ; l'autre la voit déjà marquée et passe.
    const [reclame] = await db
      .update(contracts)
      .set({ reminderSentAt: new Date() })
      .where(and(eq(contracts.id, row.contract.id), isNull(contracts.reminderSentAt)))
      .returning();
    if (!reclame) continue;

    const { subject, html } = contractEndingReminderEmail({
      tenantName: nomAvecCivilite(row.tenant),
      propertyTitle: row.property.title,
      endDate: row.contract.endDate,
      // Jours réellement restants pour CE bail, et non la constante de
      // configuration : dans une fenêtre glissante, annoncer « dans 14 jours »
      // à un bail qui s'achève dans 5 serait faux.
      daysLeft: joursEntre(now, new Date(row.contract.endDate)),
    });

    const emailResult = await sendEmail(row.managerEmail, subject, html);
    if (!aEteJoint(emailResult, { simulated: true })) {
      // Marqueur relâché : le rappel repartira à la prochaine exécution
      // plutôt que d'être perdu pour ce bail.
      await db.update(contracts).set({ reminderSentAt: null }).where(eq(contracts.id, row.contract.id));
      echecs += 1;
      continue;
    }
    sent += 1;
  }

  if (sent > 0) {
    console.log(`[reminder] ${sent} rappel(s) de fin de contrat envoyé(s).`);
  }
  if (interrompu) {
    console.warn(
      `[reminder] Budget de temps épuisé : ${rows.length - sent} rappel(s) de fin de contrat reportés à la prochaine exécution.`
    );
  }
  return { sent, echecs, interrompu };
}

/**
 * Génère les factures du mois en cours pour les contrats actifs, puis envoie
 * à chaque locataire concerné l'avis d'échéance de son loyer.
 *
 * Cette fonction est appelée QUOTIDIENNEMENT et non plus seulement le 1er du
 * mois. La génération des factures n'avait auparavant qu'un seul déclencheur
 * — le cron mensuel — et son échec (fonction en erreur, déploiement en cours,
 * base indisponible) privait tout le mois de facturation, sans reprise avant
 * trente jours. Une exécution quotidienne supprime ce point unique de
 * défaillance sans rien envoyer en double : chaque facture ne reçoit son avis
 * qu'une fois, `reminderSentAt` en répond, et le corps de l'email ne
 * mentionne aucune date d'émission. Conséquence voulue : un bail créé en
 * cours de mois reçoit enfin son avis, au lieu d'attendre le mois suivant.
 *
 * `managerId` : quand fourni (déclenchement manuel par un gestionnaire depuis
 * son tableau de bord), restreint l'envoi aux seuls locataires de ce
 * gestionnaire. Laissé vide pour le job planifié (cron), qui couvre toute
 * la plateforme.
 */
export async function runRentDueReminders(managerId?: string, budget: BudgetTemps = SANS_LIMITE) {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  // 1. S'assure que les factures du mois en cours sont générées pour les contrats actifs
  //    (scopés au gestionnaire si managerId est fourni, sinon tous les contrats actifs de la plateforme)
  const activeContractsQuery = managerId
    ? db
        .select({ contract: contracts })
        .from(contracts)
        .innerJoin(properties, eq(contracts.propertyId, properties.id))
        .where(and(eq(contracts.status, "ACTIVE"), eq(properties.managerId, managerId)))
    : db.select({ contract: contracts }).from(contracts).where(eq(contracts.status, "ACTIVE"));

  const activeContractRows = await activeContractsQuery;

  // Évite une requête par contrat (N+1) : sur un portefeuille de plusieurs
  // centaines de contrats actifs, generateInvoicesForContract interrogeait
  // sinon la base une fois par contrat pour relire les factures existantes
  // de son bien. La quasi-totalité des biens n'ont qu'UN SEUL contrat actif
  // à la fois — pour ceux-là, un instantané chargé une bonne fois pour
  // toutes AVANT la boucle est rigoureusement équivalent à une requête
  // fraîche faite au moment de l'appel, puisqu'aucun AUTRE contrat de ce
  // même lot ne peut avoir écrit de facture pour ce bien entretemps. Un bien
  // qui a EXCEPTIONNELLEMENT plusieurs contrats actifs en même temps
  // (transition de renouvellement) reste volontairement en dehors de cet
  // instantané : generateInvoicesForContract doit alors voir, pour son 2e
  // contrat, les factures que le 1er vient de créer DANS CETTE MÊME
  // EXÉCUTION — un instantané pré-chargé ne peut pas le garantir, et s'en
  // servir romprait la garde anti-double-facturation du mois de transition
  // (voir le commentaire de generateInvoicesForContract). Ces biens-là
  // continuent donc de faire leur propre requête fraîche, comme avant.
  const contractsByProperty = new Map<string, typeof activeContractRows>();
  for (const row of activeContractRows) {
    const liste = contractsByProperty.get(row.contract.propertyId) ?? [];
    liste.push(row);
    contractsByProperty.set(row.contract.propertyId, liste);
  }
  const propertyIdsUnContratActif = [...contractsByProperty.entries()]
    .filter(([, rows]) => rows.length === 1)
    .map(([propertyId]) => propertyId);

  const facturesPrechargees =
    propertyIdsUnContratActif.length > 0
      ? await db
          .select({
            contractId: invoices.contractId,
            periodMonth: invoices.periodMonth,
            periodYear: invoices.periodYear,
            status: invoices.status,
            contractStart: contracts.startDate,
            contractEnd: contracts.endDate,
            propertyId: contracts.propertyId,
          })
          .from(invoices)
          .innerJoin(contracts, eq(invoices.contractId, contracts.id))
          .where(inArray(contracts.propertyId, propertyIdsUnContratActif))
      : [];

  const facturesParBien = new Map<string, FactureExistantePourGeneration[]>();
  for (const f of facturesPrechargees) {
    const liste = facturesParBien.get(f.propertyId) ?? [];
    liste.push(f);
    facturesParBien.set(f.propertyId, liste);
  }

  let interrompu = false;
  for (const { contract } of activeContractRows) {
    if (budget.epuise()) {
      interrompu = true;
      break;
    }
    await generateInvoicesForContract(contract, db, facturesParBien.get(contract.propertyId));
  }

  // 2. Recherche toutes les factures impayées du mois courant pour les contrats actifs
  //    (scopées au gestionnaire appelant si managerId est fourni)
  //
  // isNull(reminderSentAt) est indispensable : sans lui, un second
  // déclenchement le même jour (cron + clic manuel du gestionnaire depuis
  // son tableau de bord, ou double invocation du cron) renvoyait l'avis à
  // TOUS les locataires impayés une deuxième fois — les deux autres rappels
  // de ce fichier (fin de contrat, avant échéance) vérifient déjà chacun
  // leur propre champ d'idempotence, celui-ci ne le faisait pas.
  const conditions: SQL[] = [
    eq(contracts.status, "ACTIVE"),
    // Voir runContractEndingReminders : un locataire anonymisé ne reçoit plus rien.
    isNull(tenants.anonymizedAt),
    eq(invoices.periodMonth, currentMonth),
    eq(invoices.periodYear, currentYear),
    or(eq(invoices.status, "PENDING"), eq(invoices.status, "LATE"))!,
    isNull(invoices.reminderSentAt),
  ];
  if (managerId) conditions.push(eq(properties.managerId, managerId));

  const rows = await db
    .select({
      invoice: invoices,
      contract: contracts,
      tenant: tenants,
      property: properties,
    })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(and(...conditions));

  let sent = 0;
  let echecs = 0;
  let whatsappEchecs = 0;
  const details = [];
  const whatsappEchecsParManager = new Map<string, { count: number; dernierMotif: string }>();

  for (const row of rows) {
    if (budget.epuise()) {
      interrompu = true;
      break;
    }

    // Réclamation atomique AVANT l'envoi (même principe que
    // invoice.controller.ts::payInvoice / paymentAttemptStartedAt) : le
    // SELECT ci-dessus charge un instantané des factures sans rappel
    // envoyé, mais rien n'empêchait auparavant deux exécutions
    // concurrentes de cette fonction (le cron du 1er du mois ET un
    // gestionnaire cliquant "Envoyer les avis" depuis son tableau de bord
    // au même moment, ou une double invocation du cron) de charger le
    // MÊME instantané avant que l'une ou l'autre n'ait eu le temps
    // d'écrire `reminderSentAt` — chaque locataire impayé recevait alors
    // l'avis en double. Seule une des deux exécutions concurrentes peut
    // réclamer une ligne donnée ; l'autre la voit déjà marquée et passe.
    const [reclamee] = await db
      .update(invoices)
      .set({ reminderSentAt: new Date() })
      .where(and(eq(invoices.id, row.invoice.id), isNull(invoices.reminderSentAt)))
      .returning();
    if (!reclamee) continue;

    const { subject, html } = rentDueReminderEmail({
      tenantName: nomAvecCivilite(row.tenant),
      propertyTitle: row.property.title,
      amount: row.invoice.amount,
      currency: row.invoice.currency || "EUR",
      periodMonth: row.invoice.periodMonth,
      periodYear: row.invoice.periodYear,
      dueDate: new Date(row.invoice.dueDate),
      frontendUrl: env.frontendUrl,
    });

    const emailResult = await sendEmail(row.tenant.email, subject, html);

    // WhatsApp s'ajoute à l'email (ne le remplace pas) : un échec ici
    // (numéro invalide, API Meta non configurée) ne doit jamais empêcher
    // l'email — déjà parti — d'avoir eu lieu, ni bloquer le reste de la
    // boucle pour les autres locataires.
    const whatsappResult = await envoyerMessageWhatsapp(
      row.tenant.phone,
      env.whatsapp.templateNameRentDue,
      rentDueReminderWhatsappVariables({
        tenantName: nomAvecCivilite(row.tenant),
        propertyTitle: row.property.title,
        amount: row.invoice.amount,
        currency: row.invoice.currency || "EUR",
        periodMonth: row.invoice.periodMonth,
        periodYear: row.invoice.periodYear,
        frontendUrl: env.frontendUrl,
      })
    );

    if (!aEteJoint(emailResult, whatsappResult)) {
      await db.update(invoices).set({ reminderSentAt: null }).where(eq(invoices.id, row.invoice.id));
      echecs += 1;
      continue;
    }

    // Voir signalerEchecsWhatsapp : l'email a réussi (sinon on serait déjà
    // sorti via aEteJoint ci-dessus), mais WhatsApp peut avoir vraiment
    // échoué sans que ça compte comme un échec global — on le trace quand
    // même pour le journal d'activité du gestionnaire concerné.
    if (whatsappResult.error) {
      whatsappEchecs += 1;
      const managerId = row.property.managerId;
      const courant = whatsappEchecsParManager.get(managerId);
      whatsappEchecsParManager.set(managerId, {
        count: (courant?.count ?? 0) + 1,
        dernierMotif: whatsappResult.raison ?? "erreur_api",
      });
    }

    sent += 1;
    details.push({
      tenantName: nomComplet(row.tenant),
      tenantEmail: row.tenant.email,
      propertyTitle: row.property.title,
      amount: row.invoice.amount,
      simulated: emailResult.simulated,
      whatsappSimulated: whatsappResult.simulated,
      whatsappError: whatsappResult.error === true,
    });
  }

  await signalerEchecsWhatsapp(whatsappEchecsParManager, "avis d'échéance du mois");

  console.log(`[reminder] 📢 ${sent} avis d'échéance envoyé(s) aux locataires pour ${currentMonth}/${currentYear}.`);
  if (interrompu) {
    console.warn("[reminder] Budget de temps épuisé : avis d'échéance restants reportés à la prochaine exécution.");
  }
  return { sent, echecs, whatsappEchecs, details, interrompu };
}

/**
 * Envoie un rappel complémentaire quelques jours AVANT la date d'échéance
 * (`env.reminder.rentDueSoonDays`, 3 jours par défaut) pour toute facture
 * encore impayée (PENDING ou LATE) — en plus de l'avis du 1er du mois.
 * Idempotent via `dueSoonReminderSentAt` (distinct de `reminderSentAt`).
 */
export async function runUpcomingRentDueReminders(budget: BudgetTemps = SANS_LIMITE) {
  // Repasse d'abord en LATE les factures PENDING dont l'échéance est déjà
  // dépassée — sans cet appel (auparavant jamais déclenché nulle part),
  // une facture en retard ne changeait jamais de statut automatiquement et
  // le compteur d'impayés du tableau de bord sous-estimait la réalité.
  const overdueCount = await markOverdueInvoices();
  if (overdueCount > 0) {
    console.log(`[reminder] ${overdueCount} facture(s) passée(s) en retard (LATE).`);
  }

  const daysBefore = env.reminder.rentDueSoonDays;
  const now = new Date();
  // Même fenêtre glissante que runContractEndingReminders : d'aujourd'hui à
  // J+daysBefore. La borne basse reste AUJOURD'HUI et ne recule pas — un
  // impayé dont l'échéance est passée relève du rappel de retard, pas d'un
  // message annonçant « il vous reste quelques jours ».
  const targetStart = debutDeLaJournee(now);
  const targetEnd = finDeLaJournee(jourDecale(daysBefore, now));

  const rows = await db
    .select({ invoice: invoices, contract: contracts, tenant: tenants, property: properties })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(
      and(
        eq(contracts.status, "ACTIVE"),
        isNull(tenants.anonymizedAt),
        isNull(invoices.dueSoonReminderSentAt),
        or(eq(invoices.status, "PENDING"), eq(invoices.status, "LATE")),
        gte(invoices.dueDate, targetStart),
        lte(invoices.dueDate, targetEnd)
      )
    );

  let sent = 0;
  let echecs = 0;
  let whatsappEchecs = 0;
  let interrompu = false;
  const details = [];
  const whatsappEchecsParManager = new Map<string, { count: number; dernierMotif: string }>();

  for (const row of rows) {
    if (budget.epuise()) {
      interrompu = true;
      break;
    }

    // Réclamation atomique AVANT l'envoi — même course concurrentielle que
    // runRentDueReminders ci-dessus (chevauchement du cron quotidien si un
    // envoi précédent traîne encore).
    const [reclamee] = await db
      .update(invoices)
      .set({ dueSoonReminderSentAt: new Date() })
      .where(and(eq(invoices.id, row.invoice.id), isNull(invoices.dueSoonReminderSentAt)))
      .returning();
    if (!reclamee) continue;

    // Jours réellement restants pour CETTE facture (voir la fenêtre
    // glissante ci-dessus) : 0 signifie « à régler aujourd'hui ».
    const joursRestants = joursEntre(now, new Date(row.invoice.dueDate));

    const { subject, html } = rentDueSoonReminderEmail({
      tenantName: nomAvecCivilite(row.tenant),
      propertyTitle: row.property.title,
      amount: row.invoice.amount,
      currency: row.invoice.currency || "EUR",
      periodMonth: row.invoice.periodMonth,
      periodYear: row.invoice.periodYear,
      daysLeft: joursRestants,
      dueDate: new Date(row.invoice.dueDate),
      frontendUrl: env.frontendUrl,
    });

    const emailResult = await sendEmail(row.tenant.email, subject, html);

    const whatsappResult = await envoyerMessageWhatsapp(
      row.tenant.phone,
      env.whatsapp.templateNameRentDueSoon,
      rentDueSoonReminderWhatsappVariables({
        tenantName: nomAvecCivilite(row.tenant),
        propertyTitle: row.property.title,
        amount: row.invoice.amount,
        currency: row.invoice.currency || "EUR",
        periodMonth: row.invoice.periodMonth,
        periodYear: row.invoice.periodYear,
        daysLeft: joursRestants,
        frontendUrl: env.frontendUrl,
      })
    );

    // Voir runRentDueReminders : sans cette vérification (absente ici avant
    // ce correctif), un échec d'email laissait `dueSoonReminderSentAt` posé
    // en permanence — le rappel "avant échéance" de cette facture n'était
    // alors JAMAIS retenté, et la fonction se déclarait pourtant 100 %
    // réussie (sent += 1 inconditionnel).
    if (!aEteJoint(emailResult, whatsappResult)) {
      await db.update(invoices).set({ dueSoonReminderSentAt: null }).where(eq(invoices.id, row.invoice.id));
      echecs += 1;
      continue;
    }

    if (whatsappResult.error) {
      whatsappEchecs += 1;
      const managerId = row.property.managerId;
      const courant = whatsappEchecsParManager.get(managerId);
      whatsappEchecsParManager.set(managerId, {
        count: (courant?.count ?? 0) + 1,
        dernierMotif: whatsappResult.raison ?? "erreur_api",
      });
    }

    sent += 1;
    details.push({
      tenantName: nomComplet(row.tenant),
      tenantEmail: row.tenant.email,
      propertyTitle: row.property.title,
      amount: row.invoice.amount,
      simulated: emailResult.simulated,
      whatsappSimulated: whatsappResult.simulated,
      whatsappError: whatsappResult.error === true,
    });
  }

  await signalerEchecsWhatsapp(whatsappEchecsParManager, 'rappel "avant échéance"');

  if (sent > 0) {
    console.log(`[reminder] ⏰ ${sent} rappel(s) "avant échéance" (J-${daysBefore}) envoyé(s) aux locataires.`);
  }
  if (interrompu) {
    console.warn(
      `[reminder] Budget de temps épuisé : ${rows.length - sent} rappel(s) "avant échéance" reportés à la prochaine exécution.`
    );
  }
  return { sent, echecs, whatsappEchecs, details, interrompu };
}

// Fenêtre de réclamation pour l'envoi manuel d'un rappel individuel : assez
// courte pour ne bloquer qu'un double-clic ou une double requête quasi
// simultanée sur la MÊME facture, assez longue pour absorber la latence
// réelle d'un envoi SMTP. Passé ce délai, le gestionnaire peut renvoyer un
// rappel de suivi pour la même facture — contrairement à reminderSentAt
// posé par le job automatique du 1er du mois (isNull strict, permanent),
// cette réclamation-ci n'a pas vocation à empêcher un futur renvoi manuel,
// seulement les doublons d'une même action de clic. Même valeur que
// invoice.controller.ts::DUREE_RECLAMATION_MS pour le même type de garde.
const DUREE_RECLAMATION_RAPPEL_MS = 60_000;

/**
 * Envoie un rappel d'échéance pour une facture spécifique (déclenché manuellement par l'agence).
 * `managerId` : le gestionnaire à l'origine de l'appel — doit être le propriétaire
 * du bien concerné, sinon la facture est traitée comme introuvable.
 */
export async function sendSingleInvoiceReminder(invoiceId: string, managerId: string) {
  const [row] = await db
    .select({
      invoice: invoices,
      contract: contracts,
      tenant: tenants,
      property: properties,
    })
    .from(invoices)
    .innerJoin(contracts, eq(invoices.contractId, contracts.id))
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(eq(invoices.id, invoiceId));

  if (!row || row.property.managerId !== managerId) {
    throw new ApiError(404, "Facture introuvable");
  }

  // Réclamation atomique AVANT l'envoi (même principe que
  // invoice.controller.ts::payInvoice / paymentAttemptStartedAt) : sans
  // elle, un double-clic sur "Envoyer un rappel" (ou deux requêtes API
  // quasi simultanées) déclenchait deux envois pour la même facture, le
  // SELECT ci-dessus n'empêchant rien à lui seul.
  const seuilReclamationPerimee = new Date(Date.now() - DUREE_RECLAMATION_RAPPEL_MS);
  const [reclamee] = await db
    .update(invoices)
    .set({ reminderSentAt: new Date() })
    .where(
      and(
        eq(invoices.id, row.invoice.id),
        or(isNull(invoices.reminderSentAt), lt(invoices.reminderSentAt, seuilReclamationPerimee))
      )
    )
    .returning();

  if (!reclamee) {
    throw new ApiError(409, "Un rappel vient déjà d'être envoyé pour cette facture. Patientez un instant puis réessayez.");
  }

  const { subject, html } = rentDueReminderEmail({
    tenantName: nomAvecCivilite(row.tenant),
    propertyTitle: row.property.title,
    amount: row.invoice.amount,
    currency: row.invoice.currency || "EUR",
    periodMonth: row.invoice.periodMonth,
    periodYear: row.invoice.periodYear,
    dueDate: new Date(row.invoice.dueDate),
    frontendUrl: env.frontendUrl,
  });

  const emailResult = await sendEmail(row.tenant.email, subject, html);

  const whatsappResult = await envoyerMessageWhatsapp(
    row.tenant.phone,
    env.whatsapp.templateNameRentDue,
    rentDueReminderWhatsappVariables({
      tenantName: nomAvecCivilite(row.tenant),
      propertyTitle: row.property.title,
      amount: row.invoice.amount,
      currency: row.invoice.currency || "EUR",
      periodMonth: row.invoice.periodMonth,
      periodYear: row.invoice.periodYear,
      frontendUrl: env.frontendUrl,
    })
  );

  // Le rappel manuel affirmait « envoyé » quoi qu'il arrive : `success` était
  // un littéral et le verdict de sendEmail n'était jamais relu. Le
  // gestionnaire lisait « Rappel envoyé à Jean Dupont » alors que rien n'était
  // parti — et la facture, déjà marquée, était désormais ignorée par le job
  // automatique du mois. Le locataire ne recevait donc ni l'un ni l'autre.
  const joint = aEteJoint(emailResult, whatsappResult);
  if (!joint) {
    await db.update(invoices).set({ reminderSentAt: null }).where(eq(invoices.id, row.invoice.id));
  }

  // Voir signalerEchecsWhatsapp : quand l'email a réussi, `joint` est vrai
  // même si WhatsApp a vraiment échoué — sans `whatsappError`, le
  // gestionnaire n'avait aucun moyen de le savoir depuis ce rappel manuel.
  if (joint && whatsappResult.error) {
    await logActivity({
      managerId,
      action: "reminder.whatsapp_failed",
      entityType: "invoice",
      entityId: row.invoice.id,
      entityLabel: `${nomComplet(row.tenant)} — ${row.property.title}`,
      details: `Le rappel WhatsApp n'a pas été délivré (${whatsappResult.raison ?? "erreur_api"}) — l'email, lui, est bien parti.`,
    });
  }

  return {
    success: joint,
    tenantEmail: row.tenant.email,
    tenantName: nomComplet(row.tenant),
    simulated: emailResult.simulated,
    whatsappSimulated: whatsappResult.simulated,
    whatsappError: whatsappResult.error === true,
  };
}

export function scheduleContractEndingReminders() {
  console.log(`[reminder] Job fin de contrat planifié avec "${env.reminder.cron}"`);
  cron.schedule(env.reminder.cron, () => {
    runContractEndingReminders().catch((err) => console.error("[reminder] erreur fin contrat:", err));
  });

  // Quotidien, et non plus mensuel : même politique que la route /api/cron/daily
  // du déploiement serverless (voir cron.controller.ts). La génération des
  // factures ne dépend ainsi plus d'une exécution unique dont l'échec
  // coûterait un mois entier de facturation.
  const rentDueCron = "0 8 * * *";
  console.log(`[reminder] 📢 Job factures du mois + avis d'échéance planifié avec "${rentDueCron}"`);
  cron.schedule(rentDueCron, () => {
    runRentDueReminders().catch((err) => console.error("[reminder] erreur avis d'échéance:", err));
  });

  // Tâche planifiée automatique : tous les jours à 9h00, rappel complémentaire
  // quelques jours avant l'échéance pour les factures encore impayées.
  const rentDueSoonCron = "0 9 * * *";
  console.log(`[reminder] ⏰ Job rappel "avant échéance" planifié avec "${rentDueSoonCron}"`);
  cron.schedule(rentDueSoonCron, () => {
    runUpcomingRentDueReminders().catch((err) => console.error("[reminder] erreur rappel avant échéance:", err));
  });
}

