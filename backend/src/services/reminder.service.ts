import { SQL, and, desc, eq, gte, isNull, lt, lte, or } from "drizzle-orm";
import cron from "node-cron";
import { env } from "../config/env";
import { db } from "../db/client";
import { contracts, invoices, properties, tenants, users } from "../db/schema";
import { ApiError } from "../utils/asyncHandler";
import { BudgetTemps, SANS_LIMITE } from "../utils/budgetTemps";
import { debutDeLaJournee, finDeLaJournee, joursEntre, jourDecale } from "../utils/dates";
import { contractEndingReminderEmail, rentDueReminderEmail, rentDueSoonReminderEmail, sendEmail } from "./email.service";
import { generateInvoicesForContract, markOverdueInvoices } from "./invoice.service";
import { envoyerMessageWhatsapp, rentDueReminderWhatsappVariables, rentDueSoonReminderWhatsappVariables } from "./whatsapp.service";
import { nomAvecCivilite, nomComplet } from "../utils/nom";

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

    await sendEmail(row.managerEmail, subject, html);
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
  return { sent, interrompu };
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
  let interrompu = false;
  for (const { contract } of activeContractRows) {
    if (budget.epuise()) {
      interrompu = true;
      break;
    }
    await generateInvoicesForContract(contract);
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
  const details = [];

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

    sent += 1;
    details.push({
      tenantName: nomComplet(row.tenant),
      tenantEmail: row.tenant.email,
      propertyTitle: row.property.title,
      amount: row.invoice.amount,
      simulated: emailResult.simulated,
      whatsappSimulated: whatsappResult.simulated,
    });
  }

  console.log(`[reminder] 📢 ${sent} avis d'échéance envoyé(s) aux locataires pour ${currentMonth}/${currentYear}.`);
  if (interrompu) {
    console.warn("[reminder] Budget de temps épuisé : avis d'échéance restants reportés à la prochaine exécution.");
  }
  return { sent, details, interrompu };
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
  let interrompu = false;
  const details = [];

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

    sent += 1;
    details.push({
      tenantName: nomComplet(row.tenant),
      tenantEmail: row.tenant.email,
      propertyTitle: row.property.title,
      amount: row.invoice.amount,
      simulated: emailResult.simulated,
      whatsappSimulated: whatsappResult.simulated,
    });
  }

  if (sent > 0) {
    console.log(`[reminder] ⏰ ${sent} rappel(s) "avant échéance" (J-${daysBefore}) envoyé(s) aux locataires.`);
  }
  if (interrompu) {
    console.warn(
      `[reminder] Budget de temps épuisé : ${rows.length - sent} rappel(s) "avant échéance" reportés à la prochaine exécution.`
    );
  }
  return { sent, details, interrompu };
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

  return {
    success: true,
    tenantEmail: row.tenant.email,
    tenantName: nomComplet(row.tenant),
    simulated: emailResult.simulated,
    whatsappSimulated: whatsappResult.simulated,
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

