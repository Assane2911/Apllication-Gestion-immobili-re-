import { SQL, and, desc, eq, gte, isNull, lt, lte, or } from "drizzle-orm";
import cron from "node-cron";
import { env } from "../config/env";
import { db } from "../db/client";
import { contracts, invoices, properties, tenants } from "../db/schema";
import { ApiError } from "../utils/asyncHandler";
import { debutDeLaJournee, finDeLaJournee, joursEntre, jourDecale } from "../utils/dates";
import { contractEndingReminderEmail, rentDueReminderEmail, rentDueSoonReminderEmail, sendEmail } from "./email.service";
import { generateInvoicesForContract, markOverdueInvoices } from "./invoice.service";
import { envoyerMessageWhatsapp, rentDueReminderWhatsappVariables, rentDueSoonReminderWhatsappVariables } from "./whatsapp.service";

/**
 * Recherche les contrats ACTIFS dont la date de fin tombe exactement dans
 * `daysBefore` jours et qui n'ont pas encore reÃ§u de rappel, puis envoie un
 * email au gestionnaire (SMTP_USER) et marque `reminderSentAt` pour Ã©viter
 * les envois en double.
 */
export async function runContractEndingReminders() {
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
    })
    .from(contracts)
    .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
    .innerJoin(properties, eq(contracts.propertyId, properties.id))
    .where(
      and(
        eq(contracts.status, "ACTIVE"),
        isNull(contracts.reminderSentAt),
        gte(contracts.endDate, targetStart),
        lte(contracts.endDate, targetEnd)
      )
    );

  let sent = 0;
  for (const row of rows) {
    const managerEmail = env.smtp.user;
    if (!managerEmail) {
      console.warn("[reminder] SMTP_USER non configurÃ©, rappel non envoyÃ© pour le contrat", row.contract.id);
      continue;
    }

    // RÃ©clamation atomique AVANT l'envoi (mÃªme principe que
    // invoice.controller.ts::payInvoice / paymentAttemptStartedAt) : la
    // requÃªte SELECT ci-dessus charge un instantanÃ© des contrats sans
    // rappel envoyÃ©, mais rien n'empÃªchait auparavant deux exÃ©cutions
    // concurrentes de ce job (chevauchement du cron si un envoi prÃ©cÃ©dent
    // traÃ®ne, ou un futur dÃ©clenchement manuel) de charger le MÃŠME
    // instantanÃ© avant que l'une ou l'autre n'ait eu le temps d'Ã©crire
    // `reminderSentAt` â€” chacune envoyait alors son propre email pour le
    // mÃªme contrat. Seule une des deux exÃ©cutions concurrentes peut
    // rÃ©clamer une ligne donnÃ©e ; l'autre la voit dÃ©jÃ  marquÃ©e et passe.
    const [reclame] = await db
      .update(contracts)
      .set({ reminderSentAt: new Date() })
      .where(and(eq(contracts.id, row.contract.id), isNull(contracts.reminderSentAt)))
      .returning();
    if (!reclame) continue;

    const { subject, html } = contractEndingReminderEmail({
      tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
      propertyTitle: row.property.title,
      endDate: row.contract.endDate,
      // Jours réellement restants pour CE bail, et non la constante de
      // configuration : dans une fenêtre glissante, annoncer « dans 14 jours »
      // à un bail qui s'achève dans 5 serait faux.
      daysLeft: joursEntre(now, new Date(row.contract.endDate)),
    });

    await sendEmail(managerEmail, subject, html);
    sent += 1;
  }

  if (sent > 0) {
    console.log(`[reminder] ${sent} rappel(s) de fin de contrat envoyÃ©(s).`);
  }
  return sent;
}

/**
 * Envoie automatiquement un avis d'Ã©chÃ©ance / rappel de loyer aux locataires
 * le 1er de chaque mois pour leur rappeler de rÃ©gler leur loyer au plus tard
 * le 5 du mois.
 *
 * `managerId` : quand fourni (dÃ©clenchement manuel par un gestionnaire depuis
 * son tableau de bord), restreint l'envoi aux seuls locataires de ce
 * gestionnaire. LaissÃ© vide pour le job planifiÃ© (cron), qui couvre toute
 * la plateforme.
 */
export async function runRentDueReminders(managerId?: string) {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  // 1. S'assure que les factures du mois en cours sont gÃ©nÃ©rÃ©es pour les contrats actifs
  //    (scopÃ©s au gestionnaire si managerId est fourni, sinon tous les contrats actifs de la plateforme)
  const activeContractsQuery = managerId
    ? db
        .select({ contract: contracts })
        .from(contracts)
        .innerJoin(properties, eq(contracts.propertyId, properties.id))
        .where(and(eq(contracts.status, "ACTIVE"), eq(properties.managerId, managerId)))
    : db.select({ contract: contracts }).from(contracts).where(eq(contracts.status, "ACTIVE"));

  const activeContractRows = await activeContractsQuery;
  for (const { contract } of activeContractRows) {
    await generateInvoicesForContract(contract);
  }

  // 2. Recherche toutes les factures impayÃ©es du mois courant pour les contrats actifs
  //    (scopÃ©es au gestionnaire appelant si managerId est fourni)
  //
  // isNull(reminderSentAt) est indispensable : sans lui, un second
  // dÃ©clenchement le mÃªme jour (cron + clic manuel du gestionnaire depuis
  // son tableau de bord, ou double invocation du cron) renvoyait l'avis Ã 
  // TOUS les locataires impayÃ©s une deuxiÃ¨me fois â€” les deux autres rappels
  // de ce fichier (fin de contrat, avant Ã©chÃ©ance) vÃ©rifient dÃ©jÃ  chacun
  // leur propre champ d'idempotence, celui-ci ne le faisait pas.
  const conditions: SQL[] = [
    eq(contracts.status, "ACTIVE"),
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
    // RÃ©clamation atomique AVANT l'envoi (mÃªme principe que
    // invoice.controller.ts::payInvoice / paymentAttemptStartedAt) : le
    // SELECT ci-dessus charge un instantanÃ© des factures sans rappel
    // envoyÃ©, mais rien n'empÃªchait auparavant deux exÃ©cutions
    // concurrentes de cette fonction (le cron du 1er du mois ET un
    // gestionnaire cliquant "Envoyer les avis" depuis son tableau de bord
    // au mÃªme moment, ou une double invocation du cron) de charger le
    // MÃŠME instantanÃ© avant que l'une ou l'autre n'ait eu le temps
    // d'Ã©crire `reminderSentAt` â€” chaque locataire impayÃ© recevait alors
    // l'avis en double. Seule une des deux exÃ©cutions concurrentes peut
    // rÃ©clamer une ligne donnÃ©e ; l'autre la voit dÃ©jÃ  marquÃ©e et passe.
    const [reclamee] = await db
      .update(invoices)
      .set({ reminderSentAt: new Date() })
      .where(and(eq(invoices.id, row.invoice.id), isNull(invoices.reminderSentAt)))
      .returning();
    if (!reclamee) continue;

    const { subject, html } = rentDueReminderEmail({
      tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
      propertyTitle: row.property.title,
      amount: row.invoice.amount,
      currency: row.invoice.currency || "EUR",
      periodMonth: row.invoice.periodMonth,
      periodYear: row.invoice.periodYear,
      dueDate: new Date(row.invoice.dueDate),
      frontendUrl: env.frontendUrl,
    });

    const emailResult = await sendEmail(row.tenant.email, subject, html);

    // WhatsApp s'ajoute Ã  l'email (ne le remplace pas) : un Ã©chec ici
    // (numÃ©ro invalide, API Meta non configurÃ©e) ne doit jamais empÃªcher
    // l'email â€” dÃ©jÃ  parti â€” d'avoir eu lieu, ni bloquer le reste de la
    // boucle pour les autres locataires.
    const whatsappResult = await envoyerMessageWhatsapp(
      row.tenant.phone,
      env.whatsapp.templateNameRentDue,
      rentDueReminderWhatsappVariables({
        tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
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
      tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
      tenantEmail: row.tenant.email,
      propertyTitle: row.property.title,
      amount: row.invoice.amount,
      simulated: emailResult.simulated,
      whatsappSimulated: whatsappResult.simulated,
    });
  }

  console.log(`[reminder] ðŸ“¢ ${sent} avis d'Ã©chÃ©ance du 1er du mois envoyÃ©(s) aux locataires (Ã©chÃ©ance au plus tard le 5).`);
  return { sent, details };
}

/**
 * Envoie un rappel complÃ©mentaire quelques jours AVANT la date d'Ã©chÃ©ance
 * (`env.reminder.rentDueSoonDays`, 3 jours par dÃ©faut) pour toute facture
 * encore impayÃ©e (PENDING ou LATE) â€” en plus de l'avis du 1er du mois.
 * Idempotent via `dueSoonReminderSentAt` (distinct de `reminderSentAt`).
 */
export async function runUpcomingRentDueReminders() {
  // Repasse d'abord en LATE les factures PENDING dont l'Ã©chÃ©ance est dÃ©jÃ 
  // dÃ©passÃ©e â€” sans cet appel (auparavant jamais dÃ©clenchÃ© nulle part),
  // une facture en retard ne changeait jamais de statut automatiquement et
  // le compteur d'impayÃ©s du tableau de bord sous-estimait la rÃ©alitÃ©.
  const overdueCount = await markOverdueInvoices();
  if (overdueCount > 0) {
    console.log(`[reminder] ${overdueCount} facture(s) passÃ©e(s) en retard (LATE).`);
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
        isNull(invoices.dueSoonReminderSentAt),
        or(eq(invoices.status, "PENDING"), eq(invoices.status, "LATE")),
        gte(invoices.dueDate, targetStart),
        lte(invoices.dueDate, targetEnd)
      )
    );

  let sent = 0;
  const details = [];

  for (const row of rows) {
    // RÃ©clamation atomique AVANT l'envoi â€” mÃªme course concurrentielle que
    // runRentDueReminders ci-dessus (chevauchement du cron quotidien si un
    // envoi prÃ©cÃ©dent traÃ®ne encore).
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
      tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
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
        tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
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
      tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
      tenantEmail: row.tenant.email,
      propertyTitle: row.property.title,
      amount: row.invoice.amount,
      simulated: emailResult.simulated,
      whatsappSimulated: whatsappResult.simulated,
    });
  }

  if (sent > 0) {
    console.log(`[reminder] â° ${sent} rappel(s) "avant Ã©chÃ©ance" (J-${daysBefore}) envoyÃ©(s) aux locataires.`);
  }
  return { sent, details };
}

// FenÃªtre de rÃ©clamation pour l'envoi manuel d'un rappel individuel : assez
// courte pour ne bloquer qu'un double-clic ou une double requÃªte quasi
// simultanÃ©e sur la MÃŠME facture, assez longue pour absorber la latence
// rÃ©elle d'un envoi SMTP. PassÃ© ce dÃ©lai, le gestionnaire peut renvoyer un
// rappel de suivi pour la mÃªme facture â€” contrairement Ã  reminderSentAt
// posÃ© par le job automatique du 1er du mois (isNull strict, permanent),
// cette rÃ©clamation-ci n'a pas vocation Ã  empÃªcher un futur renvoi manuel,
// seulement les doublons d'une mÃªme action de clic. MÃªme valeur que
// invoice.controller.ts::DUREE_RECLAMATION_MS pour le mÃªme type de garde.
const DUREE_RECLAMATION_RAPPEL_MS = 60_000;

/**
 * Envoie un rappel d'Ã©chÃ©ance pour une facture spÃ©cifique (dÃ©clenchÃ© manuellement par l'agence).
 * `managerId` : le gestionnaire Ã  l'origine de l'appel â€” doit Ãªtre le propriÃ©taire
 * du bien concernÃ©, sinon la facture est traitÃ©e comme introuvable.
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

  // RÃ©clamation atomique AVANT l'envoi (mÃªme principe que
  // invoice.controller.ts::payInvoice / paymentAttemptStartedAt) : sans
  // elle, un double-clic sur "Envoyer un rappel" (ou deux requÃªtes API
  // quasi simultanÃ©es) dÃ©clenchait deux envois pour la mÃªme facture, le
  // SELECT ci-dessus n'empÃªchant rien Ã  lui seul.
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
    throw new ApiError(409, "Un rappel vient dÃ©jÃ  d'Ãªtre envoyÃ© pour cette facture. Patientez un instant puis rÃ©essayez.");
  }

  const { subject, html } = rentDueReminderEmail({
    tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
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
      tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
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
    tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
    simulated: emailResult.simulated,
    whatsappSimulated: whatsappResult.simulated,
  };
}

export function scheduleContractEndingReminders() {
  console.log(`[reminder] Job fin de contrat planifiÃ© avec "${env.reminder.cron}"`);
  cron.schedule(env.reminder.cron, () => {
    runContractEndingReminders().catch((err) => console.error("[reminder] erreur fin contrat:", err));
  });

  // TÃ¢che planifiÃ©e automatique : le 1er de chaque mois Ã  8h00 du matin
  const rentDueCron = "0 8 1 * *";
  console.log(`[reminder] ðŸ“¢ Job avis d'Ã©chÃ©ance du 1er du mois (date limite le 5) planifiÃ© avec "${rentDueCron}"`);
  cron.schedule(rentDueCron, () => {
    runRentDueReminders().catch((err) => console.error("[reminder] erreur avis loyer du 1er:", err));
  });

  // TÃ¢che planifiÃ©e automatique : tous les jours Ã  9h00, rappel complÃ©mentaire
  // quelques jours avant l'Ã©chÃ©ance pour les factures encore impayÃ©es.
  const rentDueSoonCron = "0 9 * * *";
  console.log(`[reminder] â° Job rappel "avant Ã©chÃ©ance" planifiÃ© avec "${rentDueSoonCron}"`);
  cron.schedule(rentDueSoonCron, () => {
    runUpcomingRentDueReminders().catch((err) => console.error("[reminder] erreur rappel avant Ã©chÃ©ance:", err));
  });
}